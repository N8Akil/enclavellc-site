import { describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { NOT_MEASURED_SENTENCE, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
import { barFill, generateAuditPdf } from '@/lib/audit/generate-pdf'
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

// ---- the phone screenshot: tiny real images (36 x 64 pixels) ----
const SHOT_CAPTION = "Your home page on a phone, as Google's test saw it."
const JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAJKADAAQAAAABAAAAQAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAQAAkAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMACQkJCQkJEAkJEBYQEBAWHhYWFhYeJh4eHh4eJi4mJiYmJiYuLi4uLi4uLjc3Nzc3N0BAQEBASEhISEhISEhISP/bAEMBCwwMEhESHxERH0szKjNLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS//dAAQAA//aAAwDAQACEQMRAD8Aw0WrSLUaLVtFr6GdU4MPIkRatotRotWkWuWdU93DyHheKXbUoXil21h7U9RSP//QoItW0Wo0WrSLXbOqeTh5EiLVtFqNFq2i1zTqnu4eQ4LxS7amC8Uu2sPanpqR/9FEWrSLUaLVtFrGdU8HDyJEWrSLTEWrSLXLOqe7h5DgvFLtqYLxS7ax9qempH//0riLVtFqNFq0i1406p8zh5EiLVtFqNFq2i1yzqnu4eQ4LxS7amC8Uu2sPanpqR//2Q=='
function makePng(width: number, height: number): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let r = 0xffffffff
    for (const x of b) r = table[(r ^ x) & 255] ^ (r >>> 8)
    return (r ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const rows: number[] = []
  for (let y = 0; y < height; y++) {
    rows.push(0)
    for (let x = 0; x < width; x++) rows.push(40 + ((x * 5) % 200), 90 + ((y * 2) % 120), 200 - ((y * 2) % 120))
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8
  head[9] = 2
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}
const JPEG_SHOT = { mediaType: 'image/jpeg', dataBase64: JPEG_BASE64 }
const PNG_SHOT = { mediaType: 'image/png', dataBase64: makePng(36, 64) }
// a PNG that says it is w x h and holds no pixels: enough to be read for its size, nothing a decoder would accept
function headerOnlyPng(width: number, height: number): string {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4)
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8
  ihdr[17] = 2
  return Buffer.concat([sig, ihdr, Buffer.from('IDAT-not-a-real-chunk')]).toString('base64')
}
// the JPEG above with its start-of-frame width set to w
function jpegWithWidth(width: number): string {
  const bytes = Buffer.from(JPEG_BASE64, 'base64')
  const at = bytes.indexOf(Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]))
  bytes.writeUInt16BE(width, at + 7)
  return bytes.toString('base64')
}
const WEBP_SHOT = { mediaType: 'image/webp', dataBase64: Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64') }

// how many picture objects the PDF holds, and the page numbers (from 1) whose resources use one
async function pictures(bytes: Uint8Array): Promise<{ count: number; pages: number[] }> {
  const doc = await PDFDocument.load(bytes)
  let count = 0
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') count++
  }
  const pages: number[] = []
  doc.getPages().forEach((page, i) => {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (xobjects && xobjects.keys().length > 0) pages.push(i + 1)
  })
  return { count, pages }
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

  it('a URL over 1,000 characters is cut on the cover, with an ellipsis, and the score block and footer stay clear of it', async () => {
    const tail = 'zz-the-very-end-of-the-address'
    const longUrl = `${SITE}/${'q'.repeat(1200)}${tail}`
    const results: AuditResults = { ...allAssessed, websiteUrl: longUrl }
    const bytes = await generateAuditPdf(results)
    const pages = await extract(bytes)
    const cover = pages[0].text
    expect(cover).not.toContain(tail)
    expect(cover).toContain(SITE)
    expect(cover).toContain('…')
    expect(pages[0].lines).toContain('6.5/10')
    expect(cover).toContain('enclavellc.net')
    // the cover's address lines all sit above the score block (higher on the page than the "Score for" label)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => 'str' in i && i.str.trim() !== '') as Array<{ str: string; transform: number[] }>
    const label = items.find((i) => i.str.includes('SCORE'))
    expect(label).toBeDefined()
    const qLines = items.filter((i) => /q{10}/.test(i.str))
    expect(qLines.length).toBeGreaterThan(0)
    for (const q of qLines) expect(q.transform[5]).toBeGreaterThan(label!.transform[5] + 100)
  })

  it('invisible characters beyond the C0/C1 controls (line and paragraph separators, variation selectors, tag characters, Mongolian and Arabic marks) take no room on the page', async () => {
    const hidden = '\u2028\u2029\uFE00\uFE0F\u180E\u061C\u{E0041}\u{E007F}'
    const plain: AuditResults = { ...allAssessed, whereYouStand: 'People who find you can reach you.' }
    const dirty: AuditResults = { ...allAssessed, whereYouStand: `People${hidden} who${hidden} find you can${hidden} reach you.${hidden}` }
    // what a reader finds: each text item's string and drawn width; a glyph kept for a hidden character shows as extra width or an extra item
    async function items(results: AuditResults, userName: string) {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const doc = await pdfjs.getDocument({ data: (await generateAuditPdf(results, { userName })).slice(), disableFontFace: true, useSystemFonts: false }).promise
      const content = await (await doc.getPage(1)).getTextContent()
      const out = content.items.filter((i) => 'str' in i && i.str !== '').map((i) => `${(i as { str: string }).str}|${Math.round((i as { width: number }).width * 100)}`)
      return out
    }
    expect(await items(dirty, `Dana${hidden} Ortiz`)).toEqual(await items(plain, 'Dana Ortiz'))
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

  // the printed text of the page of the five areas, from its heading on, squashed
  async function areasText(results: AuditResults): Promise<string> {
    const text = bodyOf(await extract(await generateAuditPdf(results)))
    return text.slice(text.indexOf(squash('FIVE QUESTIONS')))
  }
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

  it(`the "${WAITING}" slot is printed exactly once, under Speed, only when Speed was not measured`, async () => {
    const without = await areasText(reportFixture)
    expect(count(without, squash(WAITING)), 'one waiting slot').toBe(1)
    const speedAt = without.indexOf(squash('SPEED'))
    const slotAt = without.indexOf(squash(WAITING))
    const nextAt = without.indexOf(squash('TWO CLEAR DOORS'))
    expect(speedAt, 'Speed row is present').toBeGreaterThan(-1)
    expect(slotAt, 'the slot follows the Speed name').toBeGreaterThan(speedAt)
    expect(slotAt, 'the slot precedes the next area').toBeLessThan(nextAt)
    expect(without.slice(speedAt, slotAt)).toContain(squash(NOT_MEASURED_SENTENCE))
    expect(without).toContain(squash(UNSUPPORTED_SENTENCE))
    const withSpeed = bodyOf(await extract(await generateAuditPdf(allAssessed)))
    expect(withSpeed).not.toContain(squash(WAITING))
    expect(withSpeed).not.toContain(squash(NOT_MEASURED_SENTENCE))
  })

  it('Speed unassessed after Google measured (unsupported findings) prints no "waiting" slot', async () => {
    const unsupported: AuditResults = { ...reportFixture, areas: reportFixture.areas.map((a) => (a.key === 'speed' ? { key: 'speed', name: 'Speed', assessed: false, reason: UNSUPPORTED_SENTENCE } : a)) }
    const text = await areasText(unsupported)
    expect(count(text, squash(WAITING)), 'no waiting slot').toBe(0)
    expect(text).toContain(squash(UNSUPPORTED_SENTENCE))
  })

  // Every digit run on every page must be one the results hold. Only two shapes are exempt, and each is bound to its place:
  // the page footer "n / total" (n is this page's own number), and "/10" directly after a score the results hold.
  // A fix's own number is a line of its own: the n-th such line must read n, in order, and there must be as many as fixes.
  function expectNoInventedNumbers(pages: PageText[], results: AuditResults) {
    const allowed = new Set<string>(JSON.stringify(results).match(/\d+/g) ?? [])
    allowed.add(String(results.pagesRead.length))
    allowed.add(results.overallScore.toFixed(1))
    for (const n of results.overallScore.toFixed(1).match(/\d+/g) ?? []) allowed.add(n)
    let nextFix = 1
    pages.forEach((page, index) => {
      for (const line of page.lines) {
        if (line.replace(/^ENCLAVE\s*/, '') === `${index + 1} / ${pages.length}`) continue
        if (/^\d$/.test(line) && Number(line) === nextFix && nextFix <= results.fixes.length) {
          nextFix++
          continue
        }
        // any other lone digit is a number with no place in the report, whatever the results hold
        expect(/^\d$/.test(line), `lone digit line "${line}" on page ${index + 1}`).toBe(false)
        const scored = line.match(/^(\d+(?:\.\d)?)\/10$/)
        if (scored) {
          expect(allowed.has(scored[1]), `score "${line}" on page ${index + 1}`).toBe(true)
          continue
        }
        for (const n of line.match(/\d+/g) ?? []) expect(allowed.has(n), `"${n}" in "${line}" on page ${index + 1}`).toBe(true)
      }
    })
    expect(nextFix - 1, 'one number line per fix').toBe(results.fixes.length)
  }

  it.each([
    ['all assessed', allAssessed],
    ['not measured', reportFixture],
    ['long quote', homeCareLong],
  ] as const)('%s: no number is printed that is not in the results (no placeholder, no sample score)', async (_, results) => {
    expectNoInventedNumbers(await extract(await generateAuditPdf(results, { userName: 'Dana Ortiz' })), results)
  })

  // the ten-cell bars as drawn: each cell is a small filled path; filled cells are the ones not in the rule colour
  async function drawnBars(bytes: Uint8Array): Promise<number[]> {
    const doc = await PDFDocument.load(bytes)
    const rows: number[] = []
    let current: { y: string; filled: number; cells: number } | null = null
    const cellRe = /([\d.]+) ([\d.]+) ([\d.]+) rg\n0 w\n\[\] 0 d\n1 0 0 1 ([\d.]+) ([\d.]+) cm\n1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n0 0 m\n0 7 l\n8\.5 7 l\n8\.5 0 l\nh\nf\n/g
    const LINE = [0xd3, 0xc8, 0xb6].map((v) => (v / 255).toFixed(4))
    for (const page of doc.getPages()) {
      const look = doc.context.lookup(page.node.get(PDFName.of('Contents')))
      const streams = look instanceof PDFArray ? look.asArray().map((r) => doc.context.lookup(r)) : [look]
      for (const stream of streams) {
        const text = Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString('latin1')
        for (const m of text.matchAll(cellRe)) {
          const filled = [m[1], m[2], m[3]].map((v) => Number(v).toFixed(4)).join() !== LINE.join()
          if (!current || current.y !== m[5]) {
            if (current) rows.push(current.filled)
            current = { y: m[5], filled: 0, cells: 0 }
          }
          current.cells++
          if (filled) current.filled++
        }
      }
    }
    if (current) rows.push(current.filled)
    return rows
  }

  it.each([
    ['all assessed', allAssessed],
    ['not measured', reportFixture],
  ] as const)('%s: each area prints its own score beside its own name, and its bar has exactly that many filled cells', async (_, results) => {
    const bytes = await generateAuditPdf(results)
    const pages = await extract(bytes)
    const lines = pages.slice(1).flatMap((p) => p.lines)
    const start = lines.findIndex((l) => l.includes('FIVE QUESTIONS'))
    expect(start).toBeGreaterThan(-1)
    const assessed = results.areas.filter((a) => a.assessed)
    for (const area of results.areas) {
      const at = lines.findIndex((l, i) => i > start && l === area.name.toUpperCase())
      expect(at, `row of ${area.name}`).toBeGreaterThan(-1)
      if (!area.assessed) continue
      // the nearest score line above the name is this area's own
      const before = lines.slice(start, at).reverse().find((l) => /^\d+\/10$/.test(l))
      expect(before, `score printed for ${area.name}`).toBe(`${area.score}/10`)
    }
    const bars = await drawnBars(bytes)
    expect(bars, 'one bar per assessed area, in order').toEqual(assessed.map((a) => (a.assessed ? barFill(a.score) : -1)))
    expect(bars).toEqual(assessed.map((a) => (a.assessed ? Math.round(a.score) : -1)))
    // the cover's score is the results' own overall score
    expect(pages[0].lines).toContain(`${results.overallScore.toFixed(1)}/10`)
  })

  it('barFill: one cell per point, held to 0..10', () => {
    expect([0, 4, 6.4, 6.5, 10].map(barFill)).toEqual([0, 4, 6, 7, 10])
    expect([-3, 11.2].map(barFill)).toEqual([0, 10])
  })

  describe('the phone screenshot', () => {
    const withCallouts: AuditResults = { ...allAssessed, phoneCallouts: [{ title: 'The call button is below the fold', line: 'On a phone the number sits under the first screen.' }] }

    it.each([
      ['JPEG', JPEG_SHOT],
      ['PNG', PNG_SHOT],
    ] as const)('%s: the picture is in the PDF, with its caption, on the page of the five areas', async (_, shot) => {
      const bytes = await generateAuditPdf(allAssessed, { screenshot: shot })
      const found = await pictures(bytes)
      expect(found.count).toBe(1)
      expect(found.pages).toHaveLength(1)
      const pages = await extract(bytes)
      expect(squash(pages[found.pages[0] - 1].body)).toContain(squash(SHOT_CAPTION))
      expect(squash(pages[found.pages[0] - 1].body)).toContain(squash('FIVE QUESTIONS'))
    })

    it('without a screenshot there is no picture and no caption', async () => {
      const bytes = await generateAuditPdf(allAssessed)
      expect((await pictures(bytes)).count).toBe(0)
      expect(bodyOf(await extract(bytes))).not.toContain(squash(SHOT_CAPTION))
    })

    it('WEBP (which the PDF library cannot hold), and bytes that are not the type they say, give no picture, no caption and no error', async () => {
      for (const shot of [WEBP_SHOT, { mediaType: 'image/jpeg', dataBase64: Buffer.from('not a picture').toString('base64') }, { mediaType: 'image/png', dataBase64: JPEG_BASE64 }]) {
        const bytes = await generateAuditPdf(allAssessed, { screenshot: shot })
        expect((await pictures(bytes)).count).toBe(0)
        expect(bodyOf(await extract(bytes))).not.toContain(squash(SHOT_CAPTION))
      }
    })

    it('a JPEG with no width: no picture, no caption, and the report is still made', async () => {
      const bytes = await generateAuditPdf(withCallouts, { screenshot: { mediaType: 'image/jpeg', dataBase64: jpegWithWidth(0) } })
      expect((await pictures(bytes)).count).toBe(0)
      const body = bodyOf(await extract(bytes))
      expect(body).not.toContain(squash(SHOT_CAPTION))
      expect(body).toContain(squash('The call button is below the fold'))
      expect(body).toContain(squash(allAssessed.areas[0].name.toUpperCase()))
    })

    it('a picture over the size cap is refused before anything is embedded', async () => {
      const jpg = vi.spyOn(PDFDocument.prototype, 'embedJpg')
      const png = vi.spyOn(PDFDocument.prototype, 'embedPng')
      try {
        for (const shot of [
          { mediaType: 'image/png', dataBase64: headerOnlyPng(8000, 8000) },
          { mediaType: 'image/png', dataBase64: headerOnlyPng(2001, 10) },
          { mediaType: 'image/png', dataBase64: headerOnlyPng(0, 64) },
          { mediaType: 'image/jpeg', dataBase64: jpegWithWidth(65535) },
        ]) {
          const started = Date.now()
          const bytes = await generateAuditPdf(withCallouts, { screenshot: shot })
          expect(Date.now() - started).toBeLessThan(5000)
          expect((await pictures(bytes)).count).toBe(0)
          expect(bodyOf(await extract(bytes))).not.toContain(squash(SHOT_CAPTION))
        }
        expect(png, 'embedPng not attempted').not.toHaveBeenCalled()
        expect(jpg, 'embedJpg not attempted').not.toHaveBeenCalled()
      } finally {
        jpg.mockRestore()
        png.mockRestore()
      }
    })

    it('bytes whose signature disagrees with the declared type are never handed to the PDF library', async () => {
      const jpg = vi.spyOn(PDFDocument.prototype, 'embedJpg')
      const png = vi.spyOn(PDFDocument.prototype, 'embedPng')
      try {
        for (const shot of [{ mediaType: 'image/png', dataBase64: JPEG_BASE64 }, { mediaType: 'image/jpeg', dataBase64: PNG_SHOT.dataBase64 }]) {
          const bytes = await generateAuditPdf(allAssessed, { screenshot: shot })
          expect((await pictures(bytes)).count).toBe(0)
          expect(bodyOf(await extract(bytes))).not.toContain(squash(SHOT_CAPTION))
        }
        expect(png).not.toHaveBeenCalled()
        expect(jpg).not.toHaveBeenCalled()
      } finally {
        jpg.mockRestore()
        png.mockRestore()
      }
    })

    it('a picture at the cap is still drawn', async () => {
      expect((await pictures(await generateAuditPdf(allAssessed, { screenshot: { mediaType: 'image/png', dataBase64: makePng(400, 700) } }))).count).toBe(1)
    })

    it('the call-outs sit on the same page as the picture, and the picture is never split from its caption', async () => {
      const bytes = await generateAuditPdf(withCallouts, { screenshot: JPEG_SHOT })
      const found = await pictures(bytes)
      const pages = await extract(bytes)
      const page = pages[found.pages[0] - 1]
      expect(squash(page.body)).toContain(squash(SHOT_CAPTION))
      expect(squash(page.body)).toContain(squash('The call button is below the fold'))
      expect(squash(page.body)).toContain(squash('On a phone the number sits under the first screen.'))
      expect(found.count).toBe(1)
    })

    it('with call-outs but no usable picture they are still printed, as before', async () => {
      const bytes = await generateAuditPdf(withCallouts, { screenshot: WEBP_SHOT })
      expect(bodyOf(await extract(bytes))).toContain(squash('The call button is below the fold'))
    })

    it('the caption has no digit, so no number is printed that is not in the results', async () => {
      expect(/\d/.test(SHOT_CAPTION)).toBe(false)
      expectNoInventedNumbers(await extract(await generateAuditPdf(withCallouts, { userName: 'Dana Ortiz', screenshot: PNG_SHOT })), withCallouts)
    })
  })

  it('a fixed date prints the day of the audit, and the score is never shown for an area not assessed', async () => {
    const pages = await extract(await generateAuditPdf(reportFixture))
    expect(pages[0].text).toContain('10 Nov 2026')
    // reportFixture's Speed and Trust carry no score: the only "/10" lines end on the cover and the three assessed areas
    expect(pages.flatMap((p) => p.lines).filter((l) => /\/10$/.test(l))).toHaveLength(1 + 3)
  })
})
