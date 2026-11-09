import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, expectNoPii, loggedText, postJson, resendErr, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { POST } from '@/app/api/contact/route'

const URL_ = 'http://localhost/api/contact'
const THANKS = "Thank you for reaching out! We'll get back to you within 24 hours."
const FAILURE = 'We could not send your message. Please email n.garrett@enclavellc.net or try again.'

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  vi.stubEnv('RESEND_API_KEY', 're_test_placeholder_not_a_key')
  vi.stubEnv('ADMIN_EMAIL', undefined)
  logs = spyLogs()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function expectHonestFailure(res: Response, status: number) {
  expect(res.status).toBe(status)
  const text = await res.text()
  expect(text).not.toContain('Thank you')
  const body = JSON.parse(text)
  expect(body).toMatchObject({ success: false, error: FAILURE })
  expect(body.requestId).toMatch(/^[0-9a-f]{8}$/)
  expect(loggedText(logs.error, logs.warn)).toContain(body.requestId)
  expectNoPii(logs)
}

describe('POST /api/contact', () => {
  it('sends one email through Resend and thanks the visitor once Resend returns an id', async () => {
    send.mockResolvedValue(resendOk())
    const res = await POST(postJson(URL_, LEAD))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: THANKS })
    expect(send).toHaveBeenCalledTimes(1)
    const mail = send.mock.calls[0][0]
    expect(mail.from).toBe('Enclave LLC <contact@enclavellc.net>')
    expect(mail.to).toBe('n.garrett@enclavellc.net')
    expect(mail.replyTo).toBe(LEAD.email)
    expect(mail.subject).toBe('New enquiry: Website Rebuild')
    for (const v of [LEAD.name, LEAD.email, LEAD.phone, LEAD.message]) expect(mail.html).toContain(v)
  })

  it('sends to ADMIN_EMAIL when set', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'ops@example.test')
    send.mockResolvedValue(resendOk())
    await POST(postJson(URL_, LEAD))
    expect(send.mock.calls[0][0].to).toBe('ops@example.test')
  })

  it('escapes the fields in the email body and keeps the subject on one line', async () => {
    send.mockResolvedValue(resendOk())
    await POST(postJson(URL_, { ...LEAD, name: '<img src=x onerror=alert(1)>', message: 'a & b "quoted" <script>', service: 'Other\r\nBcc: x@example.test' }))
    const mail = send.mock.calls[0][0]
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(mail.html).toContain('a &amp; b &quot;quoted&quot; &lt;script&gt;')
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it('returns 502 and no thank-you when Resend returns an error', async () => {
    send.mockResolvedValue(resendErr())
    await expectHonestFailure(await POST(postJson(URL_, LEAD)), 502)
  })

  it('returns 502 when Resend returns no id', async () => {
    send.mockResolvedValue({ data: {}, error: null, headers: null })
    await expectHonestFailure(await POST(postJson(URL_, LEAD)), 502)
  })

  it('returns 502 when the Resend call throws', async () => {
    send.mockRejectedValue(new Error(`socket hang up while sending to ${LEAD.email}`))
    await expectHonestFailure(await POST(postJson(URL_, LEAD)), 502)
  })

  it('returns 503 without calling Resend when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', undefined)
    await expectHonestFailure(await POST(postJson(URL_, LEAD)), 503)
    expect(send).not.toHaveBeenCalled()
  })

  describe('validation is unchanged, byte for byte', () => {
    const required = '{"success":false,"error":"Name, email, and message are required"}'
    it.each([
      ['name', { ...LEAD, name: '' }],
      ['email', { ...LEAD, email: undefined }],
      ['message', { ...LEAD, message: '' }],
    ])('400 when %s is missing', async (_, body) => {
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(400)
      expect(await res.text()).toBe(required)
      expect(send).not.toHaveBeenCalled()
    })
    it('400 on an invalid email', async () => {
      const res = await POST(postJson(URL_, { ...LEAD, email: 'not-an-email' }))
      expect(res.status).toBe(400)
      expect(await res.text()).toBe('{"success":false,"error":"Invalid email address"}')
      expect(send).not.toHaveBeenCalled()
    })
  })

  it('does not log the body of an unparseable request', async () => {
    const res = await POST(postJson(URL_, `${LEAD.email} is not json`))
    expect(res.status).toBe(500)
    expectNoPii(logs)
  })

  // fold 5: any mention of n8n in any case, not only the env var's literal name
  const mentionsN8n = (text: string) => /n8n/i.test(text) || /N8N_WEBHOOK/.test(text)

  it('[fold 5] the n8n matcher catches prose, code and the env var name', () => {
    expect(mentionsN8n('Sends form data to n8n webhook for processing')).toBe(true)
    expect(mentionsN8n("console.error('[Contact API] N8n failed')")).toBe(true)
    expect(mentionsN8n('const url = process.env.N8N_WEBHOOK_URL')).toBe(true)
    expect(mentionsN8n('Emails the enquiry through Resend')).toBe(false)
  })

  it('[fold 5] no file under src mentions the retired n8n webhook', () => {
    const root = process.env.N8N_SCAN_ROOT || path.resolve(__dirname, '../src')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
    const hits = walk(root).filter((f) => mentionsN8n(readFileSync(f, 'utf8'))).map((f) => path.relative(root, f))
    expect(hits).toEqual([])
  })
})
