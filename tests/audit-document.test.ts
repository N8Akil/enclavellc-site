import { describe, expect, it } from 'vitest'
import { NOT_ASSESSED_SENTENCE, UNASSESSED_CATEGORIES, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
import { generateAuditDocument } from '@/lib/audit/generate-document'
import { evidenceLine, howMadeText, scoreLine } from '@/lib/audit/present'
import type { AuditResults } from '@/lib/audit/types'
import { docxXml } from './helpers'

const SITE = 'https://doc.example.test'
const EVIL_QUOTE = 'Call now <script>alert("x")</script> & save'

const results: AuditResults = {
  success: true,
  websiteUrl: SITE,
  auditDate: '2026-11-10T00:00:00.000Z',
  overallScore: 7.2,
  overallStatus: 'Good',
  summary: 'The site says what the business does.',
  categories: [
    {
      key: 'content_quality',
      name: 'Content Quality',
      assessed: true,
      score: 8,
      status: 'Good',
      weight: 0.3,
      findings: [
        { text: 'The offer is clear.', evidence: { pageUrl: `${SITE}/`, quote: EVIL_QUOTE } },
        { text: 'No description for search.', evidence: { pageUrl: `${SITE}/about`, absent: 'a meta description' } },
        { text: 'No phone link.', evidence: { pageUrl: `${SITE}/`, absent: 'a clickable phone link (tel:)', siteWide: true } },
      ],
      recommendations: ['Add a meta description to the About page.'],
    },
    { key: 'seo', name: 'SEO Fundamentals', assessed: false, reason: UNSUPPORTED_SENTENCE },
    { key: 'structure_cta', name: 'Structure & Calls to Action', assessed: true, score: 5, status: 'Needs Improvement', weight: 0.25, findings: [{ text: 'One next step.', evidence: { pageUrl: `${SITE}/`, quote: 'Get a quote' } }], recommendations: [] },
    { key: 'trust_signals', name: 'Trust Signals', assessed: true, score: 9, status: 'Excellent', weight: 0.2, findings: [{ text: 'Address shown.', evidence: { pageUrl: `${SITE}/contact?x=1`, quote: '12 Main Street' } }], recommendations: [] },
    ...UNASSESSED_CATEGORIES.map((name) => ({ name, assessed: false as const, reason: NOT_ASSESSED_SENTENCE })),
  ],
  topStrengths: [{ title: 'Clear offer', description: 'Said in the first line.' }],
  criticalIssues: [{ title: 'No meta description', description: 'Search shows arbitrary text.', impact: 'Fewer clicks.', evidence: { pageUrl: `${SITE}/about`, absent: 'a meta description' } }],
  actionPlan: { quickWins: ['Write it.'], shortTerm: ['Review titles.'], strategic: ['Plan pages.'] },
  pagesRead: [`${SITE}/`, `${SITE}/about`, `${SITE}/contact?x=1`],
  droppedFindings: 2,
}

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

describe('the wording helpers', () => {
  it('scoreLine names how many areas the score covers', () => {
    expect(scoreLine(results)).toBe('Score for the three areas read: 7.2 of 10')
    const four: AuditResults = { ...results, categories: results.categories.map((c) => (c.key === 'seo' ? { key: 'seo', name: c.name, assessed: true, score: 7, status: 'Good', weight: 0.25, findings: [], recommendations: [] } : c)) }
    expect(scoreLine(four)).toBe('Score for the four areas read: 7.2 of 10')
  })

  it('evidenceLine shows the page path and the quote in quotation marks, or what was looked for', () => {
    expect(evidenceLine({ pageUrl: `${SITE}/about`, quote: 'Our team' })).toBe('On /about: “Our team”')
    expect(evidenceLine({ pageUrl: `${SITE}/`, quote: 'Hello' })).toBe('On /: “Hello”')
    expect(evidenceLine({ pageUrl: `${SITE}/about`, absent: 'a meta description' })).toBe('Looked for: a meta description, not found on /about')
    expect(evidenceLine({ pageUrl: `${SITE}/`, absent: 'a clickable phone link (tel:)', siteWide: true })).toBe('Looked for: a clickable phone link (tel:), not found on any page read')
  })

  it('the "how this was made" text says what was read and names everything that was not covered', () => {
    const text = howMadeText(results)
    expect(text).toContain('3 public pages')
    for (const name of UNASSESSED_CATEGORIES) expect(text).toContain(name)
    expect(text).toContain('does not compare your site with competitors')
    expect(text).not.toContain('!')
  })
})

describe('generateAuditDocument', () => {
  it('renders the new shape: scores only where assessed, evidence under findings, and model text as text only', async () => {
    const xml = docxXml(await generateAuditDocument(results, { userName: 'Zed <b>Bold</b>' }))
    const lines = paragraphs(xml)
    const all = lines.join('\n')

    // the overall score is labelled as covering the assessed areas only
    expect(lines).toContain('Score for the three areas read: 7.2 of 10.')
    expect(lines).toContain('Score for the three areas read')
    expect(lines).toContain('7.2/10')
    expect(all).not.toMatch(/overall score/i)

    // score table: a number for an assessed area, words for the rest
    const rowFor = (name: string) => {
      const at = lines.indexOf(name)
      expect(at, `row for ${name}`).toBeGreaterThan(-1)
      return lines.slice(at, at + 3)
    }
    expect(rowFor('Content Quality')).toEqual(['Content Quality', '8/10', 'Good'])
    expect(rowFor('Trust Signals')).toEqual(['Trust Signals', '9/10', 'Excellent'])
    for (const name of UNASSESSED_CATEGORIES) expect(rowFor(name)).toEqual([name, 'Not scored', 'Not assessed in the free audit'])
    expect(rowFor('SEO Fundamentals')).toEqual(['SEO Fundamentals', 'Not scored', 'Left out: findings not supported'])

    // never a zero, a blank or any number against an area that was not assessed
    expect(all).not.toMatch(/\b0(\.0)?\/10/)
    expect(all).not.toContain('undefined')
    expect(all).not.toContain('NaN')
    for (const name of [...UNASSESSED_CATEGORIES, 'SEO Fundamentals']) {
      for (const line of lines.filter((l) => l.includes(name))) expect(line, line).not.toMatch(/\d\s*\/\s*10|\d of 10/)
    }

    // detailed analysis: the fixed sentence for each unassessed area
    expect(lines.filter((l) => l === NOT_ASSESSED_SENTENCE)).toHaveLength(UNASSESSED_CATEGORIES.length)
    expect(lines.filter((l) => l === UNSUPPORTED_SENTENCE)).toHaveLength(1)
    expect(lines).toContain('Content Quality (8/10 - Good)')

    // evidence sits directly under its finding
    const finding = lines.indexOf('The offer is clear.')
    expect(lines[finding + 1]).toBe(`On /: “${EVIL_QUOTE}”`)
    expect(lines[lines.indexOf('No description for search.') + 1]).toBe('Looked for: a meta description, not found on /about')
    expect(lines[lines.indexOf('No phone link.') + 1]).toBe('Looked for: a clickable phone link (tel:), not found on any page read')
    expect(lines).toContain('On /contact?x=1: “12 Main Street”')
    // and under the priority issue
    expect(lines[lines.indexOf('No meta description: Search shows arbitrary text.') + 1]).toBe('Looked for: a meta description, not found on /about')

    // how it was made, and what it does not cover
    expect(all).toContain('How this was made and what it does not cover: ')
    expect(all).toContain(howMadeText(results))

    // untrusted text is text: escaped in the XML, never markup
    expect(xml).not.toContain('<script>')
    expect(xml).not.toContain('<b>Bold</b>')
    expect(xml).toContain('&lt;script&gt;alert(')
    expect(xml).toContain('Zed &lt;b&gt;Bold&lt;/b&gt;')

    // the old claims are gone
    expect(all).not.toMatch(/8 key|competit(?!ors, and no person)/i)
  })
})
