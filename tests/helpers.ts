import { inspect } from 'node:util'
import { expect, vi, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'
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

export function postJson(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  categories: [{ name: 'Speed', score: 6, status: 'Needs Improvement', weight: 1, findings: [], recommendations: [] }],
  topStrengths: [{ title: 'Clear offer', description: 'Fixture.' }],
  criticalIssues: [{ title: 'No booking path', description: 'Fixture.', impact: 'Fixture.' }],
  actionPlan: { quickWins: [], shortTerm: [], strategic: [] },
  competitiveContext: 'Fixture.',
} satisfies AuditResults

export const resendOk = (id = 'em_test_1') => ({ data: { id }, error: null, headers: null })
export const resendErr = (statusCode = 422, name = 'validation_error') => ({
  data: null,
  // Resend echoes the offending value back in its message; nothing may log it.
  error: { statusCode, name, message: `Invalid \`to\` field: ${LEAD.email}` },
  headers: null,
})
