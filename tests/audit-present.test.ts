import { describe, expect, it } from 'vitest'
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
import type { AuditResults } from '@/lib/audit/types'
import { REPORT_SITE as SITE, reportFixture as results } from './helpers'

// The wording shared by the PDF report and the emails (present.ts). The PDF's own tests are in audit-pdf.test.ts.
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
  })
})
