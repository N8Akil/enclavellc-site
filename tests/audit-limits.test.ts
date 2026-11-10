import { describe, expect, it } from 'vitest'
import { DEFAULT_DAILY_LIMIT, RATE_LIMITS } from '@/lib/audit/config'
import { clientIp, createAuditLimiter, parseDailyLimit, type DailyState } from '@/lib/audit/limits'

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
    it('prefers cf-connecting-ip, then the first x-forwarded-for entry, then "unknown"', () => {
      expect(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.5')
      expect(clientIp(new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe('198.51.100.1')
      expect(clientIp(new Headers())).toBe('unknown')
      expect(clientIp(new Headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '' }))).toBe('unknown')
    })

    it('callers with no address share one bucket', () => {
      const { limiter } = setup()
      for (let i = 0; i < 3; i++) expect(limiter.check(clientIp(new Headers()), email(i)).allowed).toBe(true)
      expect(limiter.check(clientIp(new Headers()), email(7))).toMatchObject({ allowed: false, cause: 'ip' })
    })
  })
})
