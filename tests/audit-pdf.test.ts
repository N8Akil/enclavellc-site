import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { NOT_MEASURED_SENTENCE, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
import { generateAuditPdf } from '@/lib/audit/generate-pdf'
import { howMadeText } from '@/lib/audit/present'
import type { AuditResults, Evidence } from '@/lib/audit/types'
import { REPORT_SITE, reportFixture } from './helpers'

// The lead-ins, written out here on purpose rather than imported: if the report's mapping from evidence kind to
// lead-in breaks (in present.ts or in the PDF code), these tests go red.
const EXPECTED_LEAD_IN: Record<Evidence['kind'], string> = {
  quote: 'Your page says:',
  counted: 'Counted on your pages:',
  measured: 'Measured:',
  absent: 'Looked for on the pages read, not found:',
  screen: 'Seen in the phone screenshot:',
}
const WAITING = "Waiting on Google's speed test"

interface PageText {
  // the printed lines, top to bottom: items on one baseline, left to right
  lines: string[]
  // every line, joined
  text: string
  // the lines between the running head and the footer (all of the cover)
  body: string
}

// The text of every page, as a PDF reader extracts it (pdfjs-dist reads the fonts' ToUnicode maps).
async function extract(bytes: Uint8Array): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false })
  const doc = await task.promise
  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    // in the order the page draws them (the order a reader copies text in): consecutive items on one baseline are a line
    const rows: Array<{ y: number; text: string }> = []
    for (const item of content.items) {
      if (!('str' in item) || item.str === '') continue
      const y = Math.round(item.transform[5])
      const last = rows[rows.length - 1]
      if (last && last.y === y) last.text += item.str
      else rows.push({ y, text: item.str })
    }
    for (const row of rows) row.text = row.text.trim()
    const lines = rows.map((r) => r.text)
    const body = rows.filter((r) => i === 1 || (r.y < 792 - 70 && r.y > 60)).map((r) => r.text)
    pages.push({ lines, text: lines.join(' '), body: body.join(' ') })
  }
  await task.destroy()
  return pages
}
const bodyOf = (pages: PageText[]) => squash(pages.map((p) => p.body).join(' '))
// whitespace is where a line wrapped, so it is left out of every comparison
const squash = (s: string) => s.replace(/\s+/g, '')

// what each piece of evidence must read as, with the lead-in this test expects for its kind
function expectedEvidence(evidence: Evidence): string {
  const lead = EXPECTED_LEAD_IN[evidence.kind]
  switch (evidence.kind) {
    case 'quote': {
      let path = evidence.pageUrl
      try {
        const u = new URL(evidence.pageUrl)
        path = `${u.pathname || '/'}${u.search}`
      } catch {}
      return `${lead} “${evidence.quote}” (on ${path})`
    }
    case 'counted':
    case 'measured':
      return `${lead} ${evidence.text}`
    case 'absent':
      return `${lead} ${evidence.label}`
    case 'screen':
      return lead
  }
}

function everyEvidence(r: AuditResults): Array<{ claim: string; evidence: Evidence }> {
  return [
    ...r.working.map((w) => ({ claim: w.line, evidence: w.evidence })),
    ...r.fixes.map((f) => ({ claim: f.whatWeSaw, evidence: f.evidence })),
    ...r.areas.flatMap((a) => (a.assessed ? a.findings.map((f) => ({ claim: f.text, evidence: f.evidence })) : [])),
  ]
}

// The base names of the fonts embedded with their glyph programs (FontFile2).
function embeddedFonts(doc: PDFDocument): string[] {
  const names: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    if (obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue
    if (!(obj.lookup(PDFName.of('FontFile2')) instanceof PDFRawStream)) continue
    names.push(String(obj.get(PDFName.of('FontName'))))
  }
  return names
}

const SITE = 'https://riverside-care.example.test'
const LONG_URL_PATH = `/${'a'.repeat(59)}` // 60 characters, no break in them
const LONG_QUOTE = Array.from({ length: 120 }, (_, i) => `sentence number ${i} of our long welcome says we care about your family`).join(' ')

// a general business, all five areas assessed, a measurement injected for Speed
const allAssessed: AuditResults = {
  success: true,
  websiteUrl: SITE,
  auditDate: '2026-11-10T15:42:00.000Z',
  niche: 'general',
  overallScore: 6.5,
  overallStatus: 'Needs Improvement',
  whereYouStand: 'People who find you can reach you. On a phone, most of them wait too long to see anything.',
  working: [
    { title: 'Your phone number is one tap away', line: 'It is a tappable link at the top of every page we read.', evidence: { kind: 'counted', text: 'a tappable phone link on 4 of the 4 pages read' } },
    { title: 'You say what you do', line: 'The first line of your home page says it plainly.', evidence: { kind: 'quote', pageUrl: `${SITE}/`, quote: 'Weekly mowing and seasonal clean-ups in Riverbend and Oak Hollow' } },
  ],
  fixes: [
    {
      headline: 'Your home page is slow to show on a phone',
      whatWeSaw: 'The main content appears late on a phone.',
      evidence: { kind: 'measured', text: 'the main content appeared after 7.8 seconds' },
      whyItMatters: 'Someone searching on their lunch break goes back to the list.',
      theFix: 'Resize the top photo to the width it is shown at.',
      effort: 'an_afternoon',
      selfServe: false,
    },
    {
      headline: 'Search results show your page without a description',
      whatWeSaw: 'The home page has no description for search results.',
      evidence: { kind: 'absent', label: 'a description for search results (meta description) on /' },
      whyItMatters: 'Google writes its own summary, often a stray sentence.',
      theFix: 'Add one sentence naming the service and the towns.',
      effort: 'ten_minutes',
      selfServe: true,
    },
    {
      headline: 'Nothing shows that customers trust you',
      whatWeSaw: 'The About page stops after one line about the family.',
      evidence: { kind: 'quote', pageUrl: `${SITE}${LONG_URL_PATH}?q=1`, quote: 'family owned since 2009' },
      whyItMatters: 'A careful customer compares two or three companies.',
      theFix: 'Put three short reviews, with first name and town, on the home page.',
      effort: 'an_afternoon',
      selfServe: true,
    },
  ],
  areas: [
    { key: 'found', name: 'Found', assessed: true, score: 7, status: 'Good', weight: 0.2, line: 'Your pages can be found and have clear titles.', findings: [{ text: 'The home page has no description.', evidence: { kind: 'absent', label: 'a description for search results (meta description) on /' } }] },
    { key: 'first_impression', name: 'First impression', assessed: true, score: 6, status: 'Needs Improvement', weight: 0.2, line: 'It is clear what you do.', findings: [{ text: 'The first line says what you do.', evidence: { kind: 'quote', pageUrl: `${SITE}/`, quote: 'Weekly mowing and seasonal clean-ups in Riverbend and Oak Hollow' } }] },
    { key: 'speed', name: 'Speed', assessed: true, score: 4, status: 'Critical', weight: 0.2, line: 'The main content takes long to show on a phone.', findings: [{ text: 'Main content shows late.', evidence: { kind: 'measured', text: 'the main content appeared after 7.8 seconds' } }] },
    { key: 'next_step', name: 'Clear next step', assessed: true, score: 8, status: 'Good', weight: 0.25, line: 'Phone, quote form and service area all say the same thing.', findings: [{ text: 'There is a quote form.', evidence: { kind: 'counted', text: '1 form on the pages read' } }] },
    { key: 'trust', name: 'Trust', assessed: true, score: 9, status: 'Excellent', weight: 0.15, line: 'Secure connection and a real address.', findings: [{ text: 'The address is on the contact page.', evidence: { kind: 'quote', pageUrl: `${SITE}/contact`, quote: '12 Mill Road, Riverbend' } }] },
  ],
  phoneCallouts: [],
  pagesRead: [`${SITE}/`, `${SITE}/about`, `${SITE}/contact`, `${SITE}${LONG_URL_PATH}?q=1`],
  linksChecked: 14,
  droppedFindings: 0,
}

const CTRL = (c: number) => String.fromCharCode(c)

// home care, Speed not measured, Trust unsupported, a very long quote, control characters in the name and text
const homeCareLong: AuditResults = {
  ...reportFixture,
  whereYouStand: `Families can reach you${CTRL(1)} in one tap;${CTRL(0x1b)} caregivers cannot find where to apply.`,
  fixes: reportFixture.fixes.map((f, i) => (i === 1 ? { ...f, evidence: { kind: 'quote', pageUrl: `${REPORT_SITE}/welcome`, quote: LONG_QUOTE } } : f)),
}

describe('generateAuditPdf', () => {
  it('makes a valid PDF that pdf-lib can read, with the brand fonts embedded and a sane page count', async () => {
    for (const results of [allAssessed, reportFixture]) {
      const bytes = await generateAuditPdf(results)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
      const doc = await PDFDocument.load(bytes)
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(4)
      expect(doc.getPageCount()).toBeLessThanOrEqual(6)
      for (const page of doc.getPages()) {
        expect(page.getWidth()).toBe(612)
        expect(page.getHeight()).toBe(792)
      }
      const fonts = embeddedFonts(doc).join(' ')
      for (const family of ['BigShouldersDisplay', 'InstrumentSans', 'IBMPlexMono']) expect(fonts).toContain(family)
    }
  })

  it.each([
    ['general, all five assessed', allAssessed],
    ['home care, Speed not measured, Trust unsupported', reportFixture],
    ['home care with a very long quote and control characters', homeCareLong],
  ] as const)('%s: every claim and its evidence is printed whole, under the lead-in for its kind', async (_, results) => {
    const pages = await extract(await generateAuditPdf(results, { userName: `Dana${CTRL(2)} Ortiz${CTRL(0x7f)}` }))
    const all = bodyOf(pages)
    const clean = (s: string) => squash(s.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''))

    for (const { claim, evidence } of everyEvidence(results)) {
      expect(all, claim).toContain(clean(claim))
      expect(all, `evidence for: ${claim}`).toContain(clean(expectedEvidence(evidence)))
    }
    for (const fix of results.fixes) for (const text of [fix.headline, fix.whyItMatters, fix.theFix]) expect(all).toContain(clean(text))
    for (const area of results.areas) {
      expect(all).toContain(clean(area.name.toUpperCase()))
      if (area.assessed) {
        expect(all).toContain(clean(area.line))
        expect(all).toContain(clean(area.status.toUpperCase()))
      } else {
        expect(all).toContain(clean(area.reason))
      }
    }
    expect(all).toContain(clean(results.whereYouStand))
    expect(all).toContain(squash(howMadeText(results)))
    // the static consultation block, unchanged until the founder decides the offer pages
    for (const line of [
      'Ready to Take Action?',
      'This audit gives you a clear picture of where your website stands. The next step is turning these insights into results.',
      'How Enclave Development Can Help',
      'Website Rebuild:',
      'Modern, fast, mobile-first design that converts visitors into customers',
      'Automation Setup:',
      'Streamline your lead follow-up so you never miss an opportunity',
      'Content & SEO:',
      'Get found by the right customers with optimized content',
      'Ongoing Support:',
      'Maintenance, updates, and continuous improvement',
      'Schedule Your Free Consultation',
      "Let's discuss your audit results and create a plan tailored to your business.",
      'Visit: enclavellc.net',
      'Email: n.garrett@enclavellc.net',
      'Thank you for choosing Enclave Development',
    ])
      expect(all).toContain(squash(line))
    // the cover
    expect(pages[0].text).toContain(`${results.overallScore.toFixed(1)}`)
    expect(squash(pages[0].text)).toContain('/10')
    expect(squash(pages[0].text)).toContain(squash(results.overallStatus.toUpperCase()))
    expect(squash(pages[0].text)).toContain('DanaOrtiz')
  })

  it('a very long quote flows onto further pages and is never cut', async () => {
    const short = await PDFDocument.load(await generateAuditPdf(reportFixture))
    const long = await PDFDocument.load(await generateAuditPdf(homeCareLong))
    expect(long.getPageCount()).toBeGreaterThan(short.getPageCount())
    expect(long.getPageCount()).toBeLessThanOrEqual(8)
    const pages = await extract(await generateAuditPdf(homeCareLong))
    expect(bodyOf(pages)).toContain(squash(`“${LONG_QUOTE}”`))
  })

  it('a 60-character URL with no break in it is printed whole', async () => {
    const pages = await extract(await generateAuditPdf(allAssessed))
    expect(bodyOf(pages)).toContain(`(on${LONG_URL_PATH}?q=1)`)
  })

  it('no control character reaches the page text', async () => {
    const pages = await extract(await generateAuditPdf(homeCareLong, { userName: `Dana${CTRL(2)}${CTRL(0x1b)} Ortiz` }))
    for (const p of pages) expect(/[\u0000-\u001F\u007F-\u009F]/.test(p.lines.join(''))).toBe(false)
    expect(bodyOf(pages)).toContain(squash('Families can reach you in one tap; caregivers cannot find where to apply.'))
  })

  it(`the "${WAITING}" slot is printed if and only if Speed is not assessed, beside the not-measured sentence`, async () => {
    const without = bodyOf(await extract(await generateAuditPdf(reportFixture)))
    expect(without).toContain(squash(WAITING))
    expect(without).toContain(squash(NOT_MEASURED_SENTENCE))
    expect(without).toContain(squash(UNSUPPORTED_SENTENCE))
    const withSpeed = bodyOf(await extract(await generateAuditPdf(allAssessed)))
    expect(withSpeed).not.toContain(squash(WAITING))
    expect(withSpeed).not.toContain(squash(NOT_MEASURED_SENTENCE))
    // Speed not assessed for a reason other than a missing measurement still waits on the speed test
    const unsupported: AuditResults = { ...reportFixture, areas: reportFixture.areas.map((a) => (a.key === 'speed' ? { key: 'speed', name: 'Speed', assessed: false, reason: UNSUPPORTED_SENTENCE } : a)) }
    expect(bodyOf(await extract(await generateAuditPdf(unsupported)))).toContain(squash(WAITING))
  })

  it.each([
    ['all assessed', allAssessed],
    ['not measured', reportFixture],
    ['long quote', homeCareLong],
  ] as const)('%s: no number is printed that is not in the results (no placeholder, no sample score)', async (_, results) => {
    const pages = await extract(await generateAuditPdf(results, { userName: 'Dana Ortiz' }))
    // the numbers the results hold: their own text, the scores, the dates, the counts present.ts states
    const allowed = new Set<string>(JSON.stringify(results).match(/\d+/g) ?? [])
    allowed.add(String(results.pagesRead.length))
    allowed.add(results.overallScore.toFixed(1))
    for (const n of results.overallScore.toFixed(1).match(/\d+/g) ?? []) allowed.add(n)
    pages.forEach((page, index) => {
      for (const line of page.lines) {
        // structure, not content: the page footer "2 / 5" and a fix's own number, each a line of its own
        if (line.replace(/^ENCLAVE\s*/, '') === `${index + 1} / ${pages.length}`) continue
        if (/^[1-9]$/.test(line) && Number(line) <= results.fixes.length) continue
        // a score on the scale: the score must be the results' own, the "/10" is the scale
        const scored = line.match(/^(\d+(?:\.\d)?)\s*\/10$/)
        if (scored) {
          expect(allowed.has(scored[1]), `score "${line}" on page ${index + 1}`).toBe(true)
          continue
        }
        for (const n of line.match(/\d+/g) ?? []) expect(allowed.has(n), `"${n}" in "${line}" on page ${index + 1}`).toBe(true)
      }
    })
  })

  it('a fixed date prints the day of the audit, and the score is never shown for an area not assessed', async () => {
    const pages = await extract(await generateAuditPdf(reportFixture))
    expect(pages[0].text).toContain('10 Nov 2026')
    // reportFixture's Speed and Trust carry no score: the only "/10" lines end on the cover and the three assessed areas
    expect(pages.flatMap((p) => p.lines).filter((l) => /\/10$/.test(l))).toHaveLength(1 + 3)
  })
})
