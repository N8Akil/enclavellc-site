import { inspect } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import { expect, vi, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'
import { NOT_ASSESSED_SENTENCE } from '@/lib/audit/config'
import type { AuditResults } from '@/lib/audit/types'

// A visitor whose every field is easy to spot in a log line.
export const LEAD = {
  name: 'Zelda Piitest',
  email: 'zelda.piitest@example.test',
  phone: '555-0199-PII',
  message: 'PII-MESSAGE: my shop needs a new site',
  service: 'Website Rebuild',
}
export const SITE = 'https://pii-site.example.test'

// Full values plus the 10-character prefix V8 quotes from an unparseable JSON body.
const PII = [LEAD.name, LEAD.email, LEAD.phone, LEAD.message, SITE, 'pii-site.example', LEAD.email.slice(0, 10)]

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

export function spyLogs() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  }
}

export function loggedText(...spies: MockInstance[]): string {
  return spies.flatMap((s) => s.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 5 }))).join(' '))).join('\n')
}

export function expectNoPii(logs: ReturnType<typeof spyLogs>, opts: { includeLog?: boolean } = {}) {
  const text = loggedText(logs.error, logs.warn, ...(opts.includeLog ? [logs.log] : []))
  for (const needle of PII) expect(text, `log leaked "${needle}"`).not.toContain(needle)
}

export const auditFixture = {
  success: true,
  websiteUrl: SITE,
  auditDate: '2026-11-09T00:00:00.000Z',
  overallScore: 6.4,
  overallStatus: 'Needs Improvement',
  summary: 'Fixture.',
  categories: [
    {
      key: 'content_quality',
      name: 'Content Quality',
      assessed: true,
      score: 6,
      status: 'Needs Improvement',
      weight: 0.3,
      findings: [{ text: 'The offer is stated late.', evidence: { pageUrl: `${SITE}/`, quote: 'We do many things' } }],
      recommendations: ['Say what you do in the first line.'],
    },
    { name: 'Performance', assessed: false, reason: NOT_ASSESSED_SENTENCE },
  ],
  topStrengths: [{ title: 'Clear offer', description: 'Fixture.' }],
  criticalIssues: [
    { title: 'No booking path', description: 'Fixture.', impact: 'Fixture.', evidence: { pageUrl: `${SITE}/`, absent: 'a meta description' } },
  ],
  actionPlan: { quickWins: [], shortTerm: [], strategic: [] },
  pagesRead: [`${SITE}/`],
  droppedFindings: 0,
} satisfies AuditResults

// The text of a .docx's main part (word/document.xml), read straight from the zip with node:zlib.
export function docxXml(docx: Buffer): string {
  const eocd = docx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('not a zip')
  const entries = docx.readUInt16LE(eocd + 10)
  let at = docx.readUInt32LE(eocd + 16)
  for (let i = 0; i < entries; i++) {
    const method = docx.readUInt16LE(at + 10)
    const compressedSize = docx.readUInt32LE(at + 20)
    const nameLength = docx.readUInt16LE(at + 28)
    const extraLength = docx.readUInt16LE(at + 30)
    const commentLength = docx.readUInt16LE(at + 32)
    const localAt = docx.readUInt32LE(at + 42)
    const name = docx.toString('utf8', at + 46, at + 46 + nameLength)
    if (name === 'word/document.xml') {
      const dataAt = localAt + 30 + docx.readUInt16LE(localAt + 26) + docx.readUInt16LE(localAt + 28)
      const data = docx.subarray(dataAt, dataAt + compressedSize)
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8')
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  throw new Error('word/document.xml not found')
}

export const resendOk = (id = 'em_test_1') => ({ data: { id }, error: null, headers: null })
export const resendErr = (statusCode = 422, name = 'validation_error') => ({
  data: null,
  // Resend echoes the offending value back in its message; nothing may log it.
  error: { statusCode, name, message: `Invalid \`to\` field: ${LEAD.email}` },
  headers: null,
})
