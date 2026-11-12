import { describe, expect, it } from 'vitest'
import { NOT_MEASURED_SENTENCE, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
import { generateAuditDocument } from '@/lib/audit/generate-document'
import {
  LEAD_IN_ABSENT,
  LEAD_IN_COUNTED,
  LEAD_IN_MEASURED,
  LEAD_IN_QUOTE,
  LEAD_IN_SCREEN,
  LEAD_INS,
  SCREEN_NOTE,
  effortLine,
  evidenceLine,
  howMadeText,
  scoreLine,
} from '@/lib/audit/present'
import type { AuditResults, Evidence } from '@/lib/audit/types'
import { EVIL_QUOTE, REPORT_SITE as SITE, docxXml, reportFixture as results } from './helpers'

// the visible text of the document, paragraph by paragraph, with XML entities decoded
function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) =>
    [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((t) => t[1])
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  )
}
// every piece of evidence in a report, and the claim printed just above it
const everyClaim = (r: AuditResults): Array<{ claim: string; evidence: Evidence }> => [
  ...r.working.map((w) => ({ claim: `${w.title}: ${w.line}`, evidence: w.evidence })),
  ...r.fixes.map((f) => ({ claim: `What we saw: ${f.whatWeSaw}`, evidence: f.evidence })),
  ...r.areas.flatMap((a) => (a.assessed ? a.findings.map((f) => ({ claim: f.text, evidence: f.evidence })) : [])),
]
const leadInsIn = (line: string) => LEAD_INS.filter((leadIn) => line.includes(leadIn))

describe('the wording helpers', () => {
  it('the five lead-ins are five different sentences, one per kind of evidence', () => {
    expect(LEAD_IN_QUOTE).toBe('Your page says:')
    expect(LEAD_IN_COUNTED).toBe('Counted on your pages:')
    expect(LEAD_IN_MEASURED).toBe('Measured:')
    expect(LEAD_IN_ABSENT).toBe('Looked for on the pages read, not found:')
    expect(LEAD_IN_SCREEN).toBe('Seen in the phone screenshot:')
    expect(new Set(LEAD_INS).size).toBe(5)
    // none is the start of another, so a line can be told apart by how it begins
    for (const a of LEAD_INS) for (const b of LEAD_INS) if (a !== b) expect(a.startsWith(b)).toBe(false)
    // [ruling 4] an absence always says where it was looked for: we read at most eleven pages, not the site
    expect(LEAD_IN_ABSENT).toContain('on the pages read')
  })

  it('evidenceLine prints each kind under its own lead-in, and exactly one of them', () => {
    const lines = {
      quote: evidenceLine({ kind: 'quote', pageUrl: `${SITE}/about`, quote: 'Our team has twenty years' }),
      home: evidenceLine({ kind: 'quote', pageUrl: `${SITE}/`, quote: 'Hello there, welcome in' }),
      absent: evidenceLine({ kind: 'absent', label: 'a link to a privacy policy' }),
      counted: evidenceLine({ kind: 'counted', text: '3 of the 18 links we checked on your own site answered with an error' }),
      measured: evidenceLine({ kind: 'measured', text: 'the main content appeared after 4.2 seconds' }),
      screen: evidenceLine({ kind: 'screen' }),
    }
    expect(lines.quote).toBe('Your page says: “Our team has twenty years” (on /about)')
    expect(lines.home).toBe('Your page says: “Hello there, welcome in” (on /)')
    expect(lines.absent).toBe('Looked for on the pages read, not found: a link to a privacy policy')
    expect(lines.counted).toBe('Counted on your pages: 3 of the 18 links we checked on your own site answered with an error')
    expect(lines.measured).toBe('Measured: the main content appeared after 4.2 seconds')
    expect(lines.screen).toBe(`Seen in the phone screenshot: ${SCREEN_NOTE}`)
    for (const line of Object.values(lines)) {
      expect(leadInsIn(line)).toHaveLength(1)
      expect(line.startsWith(leadInsIn(line)[0])).toBe(true)
    }
    // a quote that itself contains another lead-in's words still STARTS with its own, which is what the reader sees first
    const sly = evidenceLine({ kind: 'quote', pageUrl: `${SITE}/`, quote: 'Measured: the best in town, we promise you' })
    expect(sly.startsWith('Your page says: ')).toBe(true)
    // the screenshot kind says plainly that our software did not check it
    expect(lines.screen).toContain('our software cannot check this one')
  })

  it('scoreLine names how many areas the score covers', () => {
    expect(scoreLine(results)).toBe('Score for the three areas assessed: 7.2 of 10')
    const all: AuditResults = { ...results, areas: results.areas.map((a) => (a.assessed ? a : { key: a.key, name: a.name, assessed: true, score: 7, status: 'Good', weight: 0.2, line: 'x', findings: [] })) }
    expect(scoreLine(all)).toBe('Score for the five areas assessed: 7.2 of 10')
  })

  it('effortLine uses the three fixed labels and says whether the owner can do it', () => {
    expect(results.fixes.map(effortLine)).toEqual([
      'Effort: Ten minutes. You can do this yourself.',
      'Effort: An afternoon. You can do this yourself.',
      'Effort: A project. This one is likely to need someone who builds websites.',
    ])
  })

  it('the "how this was made" text says what was read, what was not, and makes no invitation', () => {
    const text = howMadeText(results)
    expect(text).toContain('3 public pages')
    expect(text).toContain('it reads at most eleven')
    // [P2-2] the limit, stated as it is: markup-hidden text is not read, stylesheet- or script-hidden text may be
    expect(text).toContain("Text hidden in the page's own markup is not read; text hidden by a stylesheet or a script may be.")
    // [RULE 5] said only when it happened
    expect(text).not.toContain('build their content with scripts')
    expect(howMadeText({ ...results, scriptPages: 1 })).toContain('Some pages build their content with scripts and were not read.')
    expect(text).toContain('Our software asked 18 links on your own site whether they answer; links to other sites were not checked.')
    expect(text).toContain('Loading speed was not measured, so Speed has no score.')
    expect(text).toContain('Findings marked as seen in the phone screenshot rest on the AI model reading the picture; our software cannot check those.')
    expect(text).toContain('The score covers the three areas assessed only.')
    expect(text).toContain('It does not cover your visitor numbers, where you rank in search, your competitors, or anything behind a login.')
    expect(text).not.toMatch(/!|book|reply to|call us|twenty minutes|price/i)

    // no screenshot, no links checked: it says that instead
    const plain = howMadeText({ ...results, phoneCallouts: [], linksChecked: 0, areas: results.areas.filter((a) => a.key !== 'first_impression') })
    expect(plain).toContain('No picture of your site was taken: First impression is judged from the opening text of your home page only.')
    expect(plain).toContain('Links were not checked.')
    expect(plain).not.toContain('seen in the phone screenshot')
    expect(plain).not.toContain('PageSpeed')

    // measured by Google's test: said, with what it is not (real visitors)
    const measured = howMadeText({ ...results, measured: true })
    expect(measured).toContain("Findings marked as measured come from one run of Google's PageSpeed Insights test on a simulated phone, not from your visitors; a real visit can be faster or slower.")
    // a screenshot was given but nothing printed rests on it: never "No picture of your site was taken"
    const shotUnused = howMadeText({ ...results, phoneCallouts: [], screenshotTaken: true, areas: results.areas.filter((a) => a.key !== 'first_impression') })
    expect(shotUnused).toContain("A phone screenshot of your home page, taken by Google's test, was given to the AI model with the text.")
    expect(shotUnused).not.toContain('No picture of your site was taken')
  })
})

describe('generateAuditDocument', () => {
  it('renders the five-area shape: scores only where assessed, each claim with what it rests on, model text as text only', async () => {
    const xml = docxXml(await generateAuditDocument(results, { userName: 'Zed <b>Bold</b>' }))
    const lines = paragraphs(xml)
    const all = lines.join('\n')

    // the overall score is labelled as covering the assessed areas only
    expect(lines).toContain('Score for the three areas assessed: 7.2 of 10.')
    expect(lines).toContain('Score for the three areas assessed')
    expect(lines).toContain('7.2/10')
    expect(all).not.toMatch(/overall score/i)
    expect(lines).toContain(results.whereYouStand)

    // the scorecard: all five areas in order, a number for an assessed area, words for the rest
    const rowFor = (name: string) => {
      const at = lines.indexOf(name)
      expect(at, `row for ${name}`).toBeGreaterThan(-1)
      return lines.slice(at, at + 3)
    }
    expect(rowFor('Found')).toEqual(['Found', '8/10', 'Search engines can read you; your link looks bare when shared.'])
    expect(rowFor('First impression')).toEqual(['First impression', '7/10', 'It is clear at once that this is care at home.'])
    expect(rowFor('Speed')).toEqual(['Speed', 'Not measured', NOT_MEASURED_SENTENCE])
    expect(rowFor('Two clear doors')).toEqual(['Two clear doors', '5/10', 'The door for families is open; the door for caregivers is missing.'])
    expect(rowFor('Trust')).toEqual(['Trust', 'Not assessed', UNSUPPORTED_SENTENCE])
    expect(all).not.toContain('Clear next step')

    // never a zero, a blank or any number against an area that was not assessed
    expect(all).not.toMatch(/\b0(\.0)?\/10/)
    expect(all).not.toContain('undefined')
    expect(all).not.toContain('NaN')
    for (const name of ['Speed', 'Trust']) {
      for (const line of lines.filter((l) => l === name || l.startsWith(`${name} (`))) expect(line, line).not.toMatch(/\d\s*\/\s*10|\d of 10/)
    }
    expect(lines.filter((l) => l === NOT_MEASURED_SENTENCE)).toHaveLength(2)
    expect(lines.filter((l) => l === UNSUPPORTED_SENTENCE)).toHaveLength(2)
    expect(lines).toContain('Found (8/10 - Good)')
    expect(lines).toContain('Two clear doors (5/10 - Needs Improvement)')

    // the three fixes, each in four short lines
    expect(lines).toContain('1. Give caregivers a way to apply')
    const fix = lines.indexOf('2. Say who pays for care')
    expect(lines.slice(fix, fix + 6)).toEqual([
      '2. Say who pays for care',
      'What we saw: Your services page mentions cost in one line.',
      'Your page says: “Ask us about <b>payment</b> options today” (on /services?x=1)',
      'Why it matters: A referrer needs to know what you accept before they call.',
      'The fix: List the ways care can be paid for.',
      'Effort: An afternoon. You can do this yourself.',
    ])

    // [ruling 1] EVERY claim in the report is followed by its evidence line, and that line carries exactly one lead-in
    const claims = everyClaim(results)
    expect(claims).toHaveLength(9)
    for (const { claim, evidence } of claims) {
      const at = lines.indexOf(claim)
      expect(at, claim).toBeGreaterThan(-1)
      expect(lines[at + 1]).toBe(evidenceLine(evidence))
      expect(leadInsIn(lines[at + 1]), lines[at + 1]).toHaveLength(1)
    }
    // and no other line in the document pretends to be evidence
    const evidenceLines = lines.filter((l) => LEAD_INS.some((leadIn) => l.startsWith(leadIn)))
    expect(evidenceLines.sort()).toEqual(claims.map((c) => evidenceLine(c.evidence)).sort())
    // four of the five kinds are in this report, each under its own words. No measurement was injected for it,
    // so nothing in it is printed under "Measured:": its counts are under "Counted on your pages:".
    expect(new Set(evidenceLines.map((l) => leadInsIn(l)[0]))).toEqual(new Set([LEAD_IN_QUOTE, LEAD_IN_COUNTED, LEAD_IN_ABSENT, LEAD_IN_SCREEN]))
    expect(lines).toContain('Counted on your pages: your home page title is 96 characters long')
    expect(lines.filter((l) => l.startsWith(LEAD_IN_MEASURED))).toEqual([])
    expect(lines[lines.indexOf('The photo at the top shows a caregiver with a client.') + 1]).toBe(`Seen in the phone screenshot: ${SCREEN_NOTE}`)

    // phone call-outs, because this report has them
    expect(lines).toContain('Your Site on a Phone')
    expect(lines).toContain('The number is easy to tap: It sits at the top, large enough for a thumb.')

    // how it was made, and what it does not cover
    expect(all).toContain('How this was made and what it does not cover: ')
    expect(all).toContain(howMadeText(results))

    // untrusted text is text: escaped in the XML, never markup
    expect(xml).not.toContain('<script>')
    expect(xml).not.toContain('<b>Bold</b>')
    expect(xml).not.toContain('<b>payment</b>')
    expect(xml).toContain('&lt;script&gt;alert(')
    expect(xml).toContain('Zed &lt;b&gt;Bold&lt;/b&gt;')
    expect(all).toContain(EVIL_QUOTE)

    // no plan: the old three-part action plan is gone, and nothing is printed from a field that no longer exists
    expect(all).not.toMatch(/Action Plan|Quick Wins|Short-Term|Strategic \(|8 key/i)
  })

  it('a report with no call-outs has no phone section, and one written for a general business prints "Clear next step"', async () => {
    const general: AuditResults = {
      ...results,
      niche: 'general',
      phoneCallouts: [],
      areas: results.areas.map((a) => (a.key === 'next_step' ? { ...a, name: 'Clear next step' } : a)),
    }
    const lines = paragraphs(docxXml(await generateAuditDocument(general)))
    expect(lines).not.toContain('Your Site on a Phone')
    expect(lines).toContain('Clear next step')
    expect(lines.join('\n')).not.toContain('Two clear doors')
  })
})

describe('[P3-8, P3-14] the .docx: what XML cannot hold, the name cap, and the score colour', () => {
  it('control characters in page quotes, model text and the name are removed, and the name is capped like the emails', async () => {
    const bad = `Ring${String.fromCharCode(1)} us${String.fromCharCode(0x1b)} today, any day of the week`
    const withControls: AuditResults = {
      ...results,
      whereYouStand: `Clear${String.fromCharCode(8)} offer.`,
      working: [{ ...results.working[0], evidence: { kind: 'quote', pageUrl: `${SITE}/`, quote: bad } }, results.working[1]],
    }
    const xml = docxXml(await generateAuditDocument(withControls, { userName: `Zed${String.fromCharCode(2)}${'x'.repeat(300)}` }))
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false)
    expect(xml).toContain('Ring us today, any day of the week')
    // the first 100 characters (the control character among them), then cleaned
    expect(xml).toContain(`Prepared for: Zed${'x'.repeat(96)}<`)
    expect(xml).not.toContain('x'.repeat(97))
  })

  it.each([
    [7.2, 'Good', '27AE60'],
    [5.5, 'Needs Improvement', 'F39C12'],
    [4.0, 'Critical', 'E74C3C'],
  ] as const)('a %s (%s) score is coloured %s', async (overallScore, overallStatus, colour) => {
    const xml = docxXml(await generateAuditDocument({ ...results, overallScore, overallStatus }))
    const status = xml.indexOf(`>${overallStatus}<`)
    expect(status).toBeGreaterThan(-1)
    // the colour of the run that prints the status label under the score
    const run = xml.slice(xml.lastIndexOf('<w:r>', status), status)
    expect(run).toContain(`w:val="${colour}"`)
  })
})
