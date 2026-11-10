import { describe, expect, it } from 'vitest'
import { DEFAULT_DAILY_LIMIT, RATE_LIMITS } from '@/lib/audit/config'
import { clientIp, createAuditLimiter, emailBucket, ipBucket, parseDailyLimit, type DailyState } from '@/lib/audit/limits'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// 2026-11-10T00:00:00Z, a UTC midnight
const MIDNIGHT = Date.UTC(2026, 10, 10)

function setup(start = MIDNIGHT + 9 * HOUR, dailyLimit = 1_000_000) {
  const clock = { t: start }
  const limiter = createAuditLimiter({ now: () => clock.t, dailyLimit: () => dailyLimit })
  return { clock, limiter }
}
// distinct callers, so one limit can be reached without touching the others
const ip = (n: number) => `198.51.100.${n % 250}-${n}`
const email = (n: number) => `visitor${n}@example.test`

describe('audit limits', () => {
  it('per IP: the 4th request in an hour is refused, and allowed again once the window has passed', () => {
    const { clock, limiter } = setup()
    expect(RATE_LIMITS.per_ip_hourly).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(limiter.check('203.0.113.9', email(i))).toEqual({ allowed: true })
      clock.t += 60_000
    }
    const refused = limiter.check('203.0.113.9', email(99))
    expect(refused).toMatchObject({ allowed: false, cause: 'ip' })
    // the first hit was 3 minutes ago: 57 minutes until it leaves the window
    expect(refused).toHaveProperty('retryAfterSeconds', 57 * 60)
    // another address is not affected
    expect(limiter.check('203.0.113.10', email(100))).toEqual({ allowed: true })

    clock.t += 57 * 60_000 - 1
    expect(limiter.check('203.0.113.9', email(101))).toMatchObject({ allowed: false, cause: 'ip' })
    clock.t += 1
    expect(limiter.check('203.0.113.9', email(101))).toEqual({ allowed: true })
  })

  it('per email: the 6th request in a day is refused whatever the IP or letter case, and allowed after 24 hours', () => {
    const { clock, limiter } = setup()
    expect(RATE_LIMITS.per_email_daily).toBe(5)
    for (let i = 0; i < 5; i++) {
      expect(limiter.check(ip(i), i % 2 ? 'Zed@Example.test' : ' zed@example.test ')).toEqual({ allowed: true })
      clock.t += HOUR
    }
    expect(limiter.check(ip(50), 'ZED@EXAMPLE.TEST')).toMatchObject({ allowed: false, cause: 'email', retryAfterSeconds: 19 * 3600 })
    clock.t += 19 * HOUR - 1
    expect(limiter.check(ip(51), 'zed@example.test')).toMatchObject({ allowed: false, cause: 'email' })
    clock.t += 1
    expect(limiter.check(ip(52), 'zed@example.test')).toEqual({ allowed: true })
  })

  describe('[3b] what a client and an email address are counted as', () => {
    it.each([
      ['203.0.113.9', '203.0.113.9'],
      [' 203.0.113.9 ', '203.0.113.9'],
      ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
      ['2001:db8:abcd:12::1', '2001:db8:abcd:12::/64'],
      ['2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff', '2001:db8:abcd:12::/64'],
      ['2001:0db8:abcd:0012:0000:0000:0000:0001', '2001:db8:abcd:12::/64'],
      // a naive split on ":" gets these wrong: the groups are only known after expansion
      ['2001:db8::1', '2001:db8:0:0::/64'],
      ['2001:db8::12:0:0:0:1', '2001:db8:0:12::/64'],
      ['2606:4700::1111', '2606:4700:0:0::/64'],
      ['::1', '0:0:0:0::/64'],
      // the neighbouring /64 is someone else
      ['2001:db8:abcd:13::1', '2001:db8:abcd:13::/64'],
      // an IPv4 address written inside IPv6 is that IPv4 client
      ['::ffff:203.0.113.9', '203.0.113.9'],
      ['::ffff:cb00:7109', '203.0.113.9'],
      // not an address: counted as the text it is
      ['unknown', 'unknown'],
      ['fe80::1%eth0', 'fe80::1%eth0'],
      ['not-an-ip', 'not-an-ip'],
    ])('ipBucket(%j) is %j', (input, bucket) => {
      expect(ipBucket(input)).toBe(bucket)
    })

    it('an IPv6 client that takes a new address from its /64 for every request is still one client', () => {
      const { clock, limiter } = setup()
      for (let i = 0; i < 3; i++) {
        expect(limiter.check(`2001:db8:abcd:12:${(i + 1).toString(16)}:${(i * 7919).toString(16)}::${i + 1}`, email(i))).toEqual({ allowed: true })
        clock.t += 1000
      }
      expect(limiter.check('2001:db8:abcd:12:dead:beef:cafe:f00d', email(50))).toMatchObject({ allowed: false, cause: 'ip' })
      expect(limiter.check('2001:DB8:ABCD:0012::9', email(51))).toMatchObject({ allowed: false, cause: 'ip' })
      // the next /64 along, and an IPv4 client, are not affected
      expect(limiter.check('2001:db8:abcd:13::1', email(52))).toEqual({ allowed: true })
      expect(limiter.check('203.0.113.9', email(53))).toEqual({ allowed: true })
      expect(limiter.size().ips).toBe(3)
    })

    it.each([
      ['zed@example.test', 'zed@example.test'],
      ['  Zed@Example.TEST ', 'zed@example.test'],
      ['zed+audit1@example.test', 'zed@example.test'],
      ['Zed+a+b+c@example.test', 'zed@example.test'],
      ['zed+@example.test', 'zed@example.test'],
      // dots stay: they are only ignored by some providers
      ['z.e.d@example.test', 'z.e.d@example.test'],
      ['z.e.d+tag@example.test', 'z.e.d@example.test'],
      // a plus in the domain or at the very start is not a tag
      ['zed@ex+ample.test', 'zed@ex+ample.test'],
      ['+zed@example.test', '+zed@example.test'],
    ])('emailBucket(%j) is %j', (input, bucket) => {
      expect(emailBucket(input)).toBe(bucket)
    })

    it('plus-tags do not buy more turns: the 6th request for name+anything@ in a day is refused', () => {
      const { clock, limiter } = setup()
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(ip(i), `zed+audit${i}@example.test`)).toEqual({ allowed: true })
        clock.t += 1000
      }
      expect(limiter.check(ip(60), 'zed+another@example.test')).toMatchObject({ allowed: false, cause: 'email' })
      expect(limiter.check(ip(61), 'ZED@example.test')).toMatchObject({ allowed: false, cause: 'email' })
      // a different person is not affected, dots and all
      expect(limiter.check(ip(62), 'z.ed@example.test')).toEqual({ allowed: true })
      expect(limiter.size().emails).toBe(2)
    })
  })

  it('[3d] the hourly limit is what bounds LEADS: 100 requests that use no audit slot trip it, and the day\'s audit ceiling is untouched', () => {
    const { clock, limiter } = setup(MIDNIGHT + 9 * HOUR, 30)
    for (let i = 0; i < 100; i++) {
      expect(limiter.check(ip(i), email(i), { audit: false })).toEqual({ allowed: true })
      clock.t += 1000
    }
    // the 101st lead in the hour is refused by the hourly limit; nothing else would have stopped it
    expect(limiter.check(ip(500), email(500), { audit: false })).toMatchObject({ allowed: false, cause: 'global' })
    // and an audit request is held by the same hourly limit, not by the ceiling
    expect(limiter.check(ip(501), email(501))).toMatchObject({ allowed: false, cause: 'global' })

    // an hour on, all 30 of the day's audit slots are still there: the 100 leads used none of them
    clock.t += HOUR
    for (let i = 0; i < 30; i++) expect(limiter.check(ip(1000 + i), email(1000 + i))).toEqual({ allowed: true })
    expect(limiter.check(ip(2000), email(2000))).toMatchObject({ allowed: false, cause: 'daily' })
  })

  it('global: the 101st request in an hour is refused, and allowed again once the window has passed', () => {
    const { clock, limiter } = setup()
    expect(RATE_LIMITS.global_hourly).toBe(100)
    for (let i = 0; i < 100; i++) {
      expect(limiter.check(ip(i), email(i))).toEqual({ allowed: true })
      clock.t += 1000
    }
    expect(limiter.check(ip(500), email(500))).toMatchObject({ allowed: false, cause: 'global', retryAfterSeconds: 3600 - 100 })
    clock.t += (3600 - 100) * 1000
    expect(limiter.check(ip(501), email(501))).toEqual({ allowed: true })
  })

  it('daily ceiling: trips at its number and resets at the UTC day change, not 24 hours later', () => {
    const { clock, limiter } = setup(MIDNIGHT + 22 * HOUR, 30)
    for (let i = 0; i < 30; i++) {
      expect(limiter.check(ip(i), email(i))).toEqual({ allowed: true })
      clock.t += 1000
    }
    const refused = limiter.check(ip(900), email(900))
    expect(refused).toMatchObject({ allowed: false, cause: 'daily' })
    // 30 s past 22:00 UTC: 2 hours less 30 s to midnight
    expect(refused).toHaveProperty('retryAfterSeconds', 2 * 3600 - 30)

    clock.t = MIDNIGHT + DAY - 1
    expect(limiter.check(ip(901), email(901))).toMatchObject({ allowed: false, cause: 'daily' })
    clock.t = MIDNIGHT + DAY
    expect(limiter.check(ip(902), email(902))).toEqual({ allowed: true })
  })

  it('a refused request is not counted, so being refused does not extend the wait', () => {
    const { clock, limiter } = setup()
    for (let i = 0; i < 3; i++) limiter.check('203.0.113.9', email(i))
    for (let i = 0; i < 20; i++) expect(limiter.check('203.0.113.9', email(i)).allowed).toBe(false)
    clock.t += HOUR
    expect(limiter.check('203.0.113.9', email(1))).toEqual({ allowed: true })
  })

  it('keeps nothing past its window: keys are dropped, and what is held is a hash, not the address', () => {
    const { clock, limiter } = setup()
    limiter.check('203.0.113.9', 'zed@example.test')
    expect(limiter.size()).toEqual({ ips: 1, emails: 1, global: 1 })
    clock.t += HOUR
    limiter.check('203.0.113.77', 'other@example.test')
    // the first IP and its global hit are gone after an hour; its email key lives for the day
    expect(limiter.size()).toEqual({ ips: 1, emails: 2, global: 1 })
    clock.t += DAY
    limiter.check('203.0.113.78', 'third@example.test')
    expect(limiter.size()).toEqual({ ips: 1, emails: 1, global: 1 })
  })

  describe('fails closed', () => {
    const DAILY = { allowed: false, cause: 'daily' }
    it('a clock that returns NaN or Infinity refuses the request', () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        const limiter = createAuditLimiter({ now: () => bad, dailyLimit: () => 30 })
        expect(limiter.check('203.0.113.9', 'zed@example.test')).toEqual(DAILY)
      }
    })

    it('a clock that throws refuses the request', () => {
      const limiter = createAuditLimiter({
        now: () => {
          throw new Error('clock broke')
        },
      })
      expect(limiter.check('203.0.113.9', 'zed@example.test')).toEqual(DAILY)
    })

    it('a limit that cannot be read, or is not a positive whole number, refuses the request', () => {
      const throwing = createAuditLimiter({
        now: () => MIDNIGHT,
        dailyLimit: () => {
          throw new Error('cannot read')
        },
      })
      expect(throwing.check('203.0.113.9', 'zed@example.test')).toEqual(DAILY)
      for (const bad of [NaN, 0, -3, 2.5, Infinity]) {
        const limiter = createAuditLimiter({ now: () => MIDNIGHT, dailyLimit: () => bad })
        expect(limiter.check('203.0.113.9', 'zed@example.test')).toEqual(DAILY)
      }
    })

    it.each<[string, DailyState]>([
      ['a NaN count', { day: Math.floor(MIDNIGHT / DAY), count: NaN }],
      ['an infinite count', { day: Math.floor(MIDNIGHT / DAY), count: Infinity }],
      ['a negative count', { day: Math.floor(MIDNIGHT / DAY), count: -1 }],
      ['a fractional count', { day: Math.floor(MIDNIGHT / DAY), count: 1.5 }],
      ['a count that is not a number', { day: Math.floor(MIDNIGHT / DAY), count: '3' as unknown as number }],
      ['a NaN day', { day: NaN, count: 0 }],
      ['a NaN day and count', { day: NaN, count: NaN }],
    ])('a daily counter in an unexpected state (%s) refuses, and keeps refusing the next day', (_, dailyState) => {
      const clock = { t: MIDNIGHT + HOUR }
      const limiter = createAuditLimiter({ now: () => clock.t, dailyLimit: () => 30, dailyState })
      expect(limiter.check('203.0.113.9', 'zed@example.test')).toEqual(DAILY)
      clock.t += DAY
      expect(limiter.check('203.0.113.10', 'other@example.test')).toEqual(DAILY)
    })

    it('a clock that steps back over midnight does not hand out a fresh day', () => {
      const { clock, limiter } = setup(MIDNIGHT + 5, 2)
      expect(limiter.check(ip(1), email(1)).allowed).toBe(true)
      expect(limiter.check(ip(2), email(2)).allowed).toBe(true)
      clock.t = MIDNIGHT - 5
      expect(limiter.check(ip(3), email(3))).toMatchObject({ allowed: false, cause: 'daily' })
    })

    it('a refused-closed request is not counted against anyone', () => {
      let t = NaN
      const limiter = createAuditLimiter({ now: () => t, dailyLimit: () => 30 })
      for (let i = 0; i < 10; i++) limiter.check('203.0.113.9', 'zed@example.test')
      t = MIDNIGHT
      expect(limiter.check('203.0.113.9', 'zed@example.test')).toEqual({ allowed: true })
    })
  })

  describe('the daily ceiling setting', () => {
    it.each([
      [undefined, DEFAULT_DAILY_LIMIT],
      ['', DEFAULT_DAILY_LIMIT],
      ['0', DEFAULT_DAILY_LIMIT],
      ['-5', DEFAULT_DAILY_LIMIT],
      ['2.5', DEFAULT_DAILY_LIMIT],
      ['ten', DEFAULT_DAILY_LIMIT],
      ['1e3', DEFAULT_DAILY_LIMIT],
      ['12abc', DEFAULT_DAILY_LIMIT],
      ['99999999999999999999', DEFAULT_DAILY_LIMIT],
      ['1', 1],
      ['45', 45],
      [' 60 ', 60],
    ])('%j -> %i', (raw, expected) => {
      expect(DEFAULT_DAILY_LIMIT).toBe(30)
      expect(parseDailyLimit(raw)).toBe(expected)
    })
  })

  describe('clientIp', () => {
    it('[3c] reads cf-connecting-ip ONLY: x-forwarded-for is never used, so a direct caller cannot pick its own bucket', () => {
      expect(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.5')
      expect(clientIp(new Headers({ 'cf-connecting-ip': ' 203.0.113.5 ' }))).toBe('203.0.113.5')
      expect(clientIp(new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe('unknown')
      expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', forwarded: 'for=198.51.100.3', 'true-client-ip': '198.51.100.4' }))).toBe('unknown')
      expect(clientIp(new Headers())).toBe('unknown')
      expect(clientIp(new Headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '198.51.100.1' }))).toBe('unknown')
    })

    it('[3c] a caller that rotates x-forwarded-for stays in the one "unknown" bucket', () => {
      const { limiter } = setup()
      for (let i = 0; i < 3; i++) expect(limiter.check(clientIp(new Headers({ 'x-forwarded-for': `198.51.100.${i}` })), email(i)).allowed).toBe(true)
      expect(limiter.check(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.77' })), email(7))).toMatchObject({ allowed: false, cause: 'ip' })
    })

    it('callers with no address share one bucket', () => {
      const { limiter } = setup()
      for (let i = 0; i < 3; i++) expect(limiter.check(clientIp(new Headers()), email(i)).allowed).toBe(true)
      expect(limiter.check(clientIp(new Headers()), email(7))).toMatchObject({ allowed: false, cause: 'ip' })
    })
  })
})

describe('more than one process', () => {
  it('a cluster worker refuses every request with the site-wide message, and counts nothing (the limits are per process)', () => {
    let worker = true
    const limiter = createAuditLimiter({ now: () => Date.UTC(2026, 10, 10, 12), isClusterWorker: () => worker })
    expect(limiter.check('203.0.113.9', 'a@example.com')).toEqual({ allowed: false, cause: 'daily' })
    expect(limiter.size()).toEqual({ ips: 0, emails: 0, global: 0 })
    // separating control: the same limiter, same request, in a single process, is allowed and counted
    worker = false
    expect(limiter.check('203.0.113.9', 'a@example.com')).toEqual({ allowed: true })
    expect(limiter.size()).toEqual({ ips: 1, emails: 1, global: 1 })
  })
  it('this test process is not a cluster worker, so the default limiter counts normally', () => {
    const limiter = createAuditLimiter({ now: () => Date.UTC(2026, 10, 10, 12) })
    expect(limiter.check('203.0.113.10', 'b@example.com')).toEqual({ allowed: true })
  })
})

describe('requests that are not run automatically, and the lead cap', () => {
  const at = Date.UTC(2026, 10, 10, 12)
  it('check(…, { audit: false }) passes the per-person and hourly limits but never uses the audit ceiling', () => {
    const limiter = createAuditLimiter({ now: () => at, dailyLimit: () => 1 })
    for (let i = 0; i < 10; i++) expect(limiter.check(`203.0.113.${i}`, `v${i}@example.com`, { audit: false })).toEqual({ allowed: true })
    // the one audit slot of the day is still there
    expect(limiter.check('203.0.113.100', 'a@example.com')).toEqual({ allowed: true })
    expect(limiter.check('203.0.113.101', 'b@example.com')).toMatchObject({ allowed: false, cause: 'daily' })
    // and a non-audit request is still allowed after the ceiling is used up
    expect(limiter.check('203.0.113.102', 'c@example.com', { audit: false })).toEqual({ allowed: true })
    // the per-IP limit still binds it (3 an hour)
    for (let i = 0; i < 2; i++) limiter.check('203.0.113.200', `w${i}@example.com`, { audit: false })
    limiter.check('203.0.113.200', 'w2@example.com', { audit: false })
    expect(limiter.check('203.0.113.200', 'w3@example.com', { audit: false })).toMatchObject({ allowed: false, cause: 'ip' })
  })
  it('takeLead allows exactly the cap per UTC day and comes back the next day', () => {
    let t = at
    const limiter = createAuditLimiter({ now: () => t, leadLimit: 3 })
    expect([limiter.takeLead(), limiter.takeLead(), limiter.takeLead(), limiter.takeLead()]).toEqual([true, true, true, false])
    t = Date.UTC(2026, 10, 11, 0, 0, 1)
    expect(limiter.takeLead()).toBe(true)
  })
  it('takeLead fails closed: a bad clock, a counter this code did not write, a bad cap, or a cluster worker all refuse', () => {
    expect(createAuditLimiter({ now: () => NaN }).takeLead()).toBe(false)
    expect(createAuditLimiter({ now: () => at, leadState: { day: 1.5, count: 0 } }).takeLead()).toBe(false)
    expect(createAuditLimiter({ now: () => at, leadState: { day: -1, count: -4 } }).takeLead()).toBe(false)
    expect(createAuditLimiter({ now: () => at, leadLimit: 0 }).takeLead()).toBe(false)
    expect(createAuditLimiter({ now: () => at, isClusterWorker: () => true }).takeLead()).toBe(false)
    expect(createAuditLimiter({ now: () => { throw new Error('clock') } }).takeLead()).toBe(false)
    // control: the same call with nothing wrong is allowed
    expect(createAuditLimiter({ now: () => at }).takeLead()).toBe(true)
  })
})

