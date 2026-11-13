import { inspect } from 'node:util'
import { expect, vi, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'
import { NOT_MEASURED_SENTENCE, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
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
  niche: 'general',
  overallScore: 6.4,
  overallStatus: 'Needs Improvement',
  whereYouStand: 'A clear offer that is hard to act on from a phone.',
  working: [
    { title: 'Clear offer', line: 'The first line says what you do and where.', evidence: { kind: 'quote', pageUrl: `${SITE}/`, quote: 'We fix leaks and drains across the county' } },
  ],
  fixes: [
    {
      headline: 'Give search results a description',
      whatWeSaw: 'The home page has no description for search results.',
      evidence: { kind: 'absent', label: 'a description for search results (meta description) on /' },
      whyItMatters: 'People choosing between results see nothing about you.',
      theFix: 'Write one sentence saying what you do and where.',
      effort: 'ten_minutes',
      selfServe: true,
    },
  ],
  areas: [
    {
      key: 'found',
      name: 'Found',
      assessed: true,
      score: 6,
      status: 'Needs Improvement',
      weight: 0.2,
      line: 'Search engines can read you, but your link looks bare when shared.',
      findings: [{ text: 'The offer is stated late.', evidence: { kind: 'quote', pageUrl: `${SITE}/`, quote: 'We do many things for many people' } }],
    },
    { key: 'speed', name: 'Speed', assessed: false, reason: NOT_MEASURED_SENTENCE },
  ],
  phoneCallouts: [],
  pagesRead: [`${SITE}/`],
  linksChecked: 0,
  droppedFindings: 0,
} satisfies AuditResults

// A report with every kind of evidence in it, both kinds of unassessed area, the home-care name and call-outs:
// what the PDF report and the emails must be able to render.
export const REPORT_SITE = 'https://doc.example.test'
export const EVIL_QUOTE = 'Call now <script>alert("x")</script> & save today'
export const reportFixture: AuditResults = {
  success: true,
  websiteUrl: REPORT_SITE,
  auditDate: '2026-11-10T00:00:00.000Z',
  niche: 'home_care',
  overallScore: 7.2,
  overallStatus: 'Good',
  whereYouStand: 'Families can reach you in one tap; caregivers cannot find where to apply.',
  working: [
    { title: 'A number to tap', line: 'A family on a phone can call you in one tap.', evidence: { kind: 'quote', pageUrl: `${REPORT_SITE}/`, quote: EVIL_QUOTE } },
    { title: 'Your links answer', line: 'Nothing we tried on your own site was broken.', evidence: { kind: 'counted', text: 'all 18 links we checked on your own site answered' } },
  ],
  fixes: [
    {
      headline: 'Give caregivers a way to apply',
      whatWeSaw: 'There is no careers or apply link on the pages we read.',
      evidence: { kind: 'absent', label: 'a careers or apply link' },
      whyItMatters: 'You grow only as fast as you hire.',
      theFix: 'Add an Apply link to the top of every page.',
      effort: 'ten_minutes',
      selfServe: true,
    },
    {
      headline: 'Say who pays for care',
      whatWeSaw: 'Your services page mentions cost in one line.',
      evidence: { kind: 'quote', pageUrl: `${REPORT_SITE}/services?x=1`, quote: 'Ask us about <b>payment</b> options today' },
      whyItMatters: 'A referrer needs to know what you accept before they call.',
      theFix: 'List the ways care can be paid for.',
      effort: 'an_afternoon',
      selfServe: true,
    },
    {
      headline: 'Shorten the home page title',
      whatWeSaw: 'The title is longer than search results show.',
      evidence: { kind: 'counted', text: 'your home page title is 96 characters long' },
      whyItMatters: 'The town you serve is cut off in search results.',
      theFix: 'Put the service and the town in the first 60 characters.',
      effort: 'a_project',
      selfServe: false,
    },
  ],
  areas: [
    {
      key: 'found',
      name: 'Found',
      assessed: true,
      score: 8,
      status: 'Good',
      weight: 0.2,
      line: 'Search engines can read you; your link looks bare when shared.',
      findings: [
        { text: 'No picture goes with your link when it is shared.', evidence: { kind: 'absent', label: 'a picture for when your home page is shared (Open Graph image)' } },
        { text: 'The About page names the town.', evidence: { kind: 'quote', pageUrl: `${REPORT_SITE}/about`, quote: 'Serving the county since 1998 with care' } },
      ],
    },
    {
      key: 'first_impression',
      name: 'First impression',
      assessed: true,
      score: 7,
      status: 'Good',
      weight: 0.2,
      line: 'It is clear at once that this is care at home.',
      findings: [{ text: 'The photo at the top shows a caregiver with a client.', evidence: { kind: 'screen' } }],
    },
    { key: 'speed', name: 'Speed', assessed: false, reason: NOT_MEASURED_SENTENCE },
    {
      key: 'next_step',
      name: 'Two clear doors',
      assessed: true,
      score: 5,
      status: 'Needs Improvement',
      weight: 0.25,
      line: 'The door for families is open; the door for caregivers is missing.',
      findings: [{ text: 'Some of your own links do not answer.', evidence: { kind: 'counted', text: '3 of the 18 links we checked on your own site answered with an error' } }],
    },
    { key: 'trust', name: 'Trust', assessed: false, reason: UNSUPPORTED_SENTENCE },
  ],
  phoneCallouts: [{ title: 'The number is easy to tap', line: 'It sits at the top, large enough for a thumb.' }],
  pagesRead: [`${REPORT_SITE}/`, `${REPORT_SITE}/about`, `${REPORT_SITE}/services?x=1`],
  linksChecked: 18,
  droppedFindings: 2,
}

export const resendOk = (id = 'em_test_1') => ({ data: { id }, error: null, headers: null })
export const resendErr = (statusCode = 422, name = 'validation_error') => ({
  data: null,
  // Resend echoes the offending value back in its message; nothing may log it.
  error: { statusCode, name, message: `Invalid \`to\` field: ${LEAD.email}` },
  headers: null,
})
