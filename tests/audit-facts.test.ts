import { describe, expect, it } from 'vitest'
import { AREA_KEYS } from '@/lib/audit/config'
import {
  ABSENT_FACTS,
  MEASURED_FACTS,
  SAYS_FACTS,
  VERDICT_WORDS,
  allFactLabels,
  computeFacts,
  factEvidence,
  factWords,
  factsBlock,
  type Fact,
} from '@/lib/audit/facts'
import { extractPage } from '@/lib/audit/fetch-website'
import { LEAD_IN_ABSENT, evidenceLine } from '@/lib/audit/present'
import type { SiteProbes, WebsiteContent } from '@/lib/audit/types'

const SITE = 'https://care.example.test'
const page = (body: string, head = '<title>Sunrise Home Care of Dayton</title>', url = `${SITE}/`) => extractPage(`<html><head>${head}</head><body>${body}</body></html>`, url)
const site = (body: string, head?: string, probes?: SiteProbes): WebsiteContent => ({ pages: [page(body, head)], probes })
const ids = (facts: Fact[]) => facts.map((f) => f.id)
const byId = (facts: Fact[], id: string) => facts.find((f) => f.id === id)
const PROBES: SiteProbes = {
  robots: { state: 'found', disallowsHome: false, rule: 'Disallow: /' },
  sitemap: { state: 'found', locCount: 12 },
  httpsRedirect: 'redirects',
  links: { checked: 18, broken: [] },
}

describe('fact labels: written once, in code, and never a verdict', () => {
  const labels = allFactLabels()

  it('there is a label for every fact in the three catalogues', () => {
    expect(labels).toHaveLength(Object.keys(ABSENT_FACTS).length + Object.keys(MEASURED_FACTS).length + Object.keys(SAYS_FACTS).length)
    // (the text-pattern absences left the catalogue under RULE 1: 42 labels now)
    expect(labels.length).toBeGreaterThan(40)
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(5)
  })

  it('the words that would make a label a verdict are the ones required', () => {
    expect([...VERDICT_WORDS]).toEqual(['law', 'legal', 'comply', 'compliance', 'hipaa', 'violat', 'required by', 'regulation'])
  })

  // [ruling 5] no label says, or hints, that anything is or is not lawful, required or allowed
  it.each(labels.map((label) => [label]))('"%s" contains none of them', (label) => {
    for (const word of VERDICT_WORDS) expect(label.toLowerCase(), `"${word}" in "${label}"`).not.toContain(word)
    // nor any other way of pronouncing on what is allowed
    expect(label).not.toMatch(/\b(illegal|unlawful|lawful|mandatory|must|not allowed|prohibited|penalt|fine[sd]?\b|liab|unlicensed|not licensed|uninsured|not insured|certif|accredit|ADA|GDPR|CCPA|statut)/i)
  })

  it('the test above can fail: each of the required words is caught in a label that has it', () => {
    const bad = ['required by law', 'a legal notice', 'does not comply', 'HIPAA compliance', 'a violation', 'state regulation', 'Required By the state']
    for (const label of bad) expect(VERDICT_WORDS.some((word) => label.toLowerCase().includes(word)), label).toBe(true)
  })

  it('every label belongs to one of the five areas, and no label ends a sentence or shouts', () => {
    for (const catalogue of [ABSENT_FACTS, MEASURED_FACTS, SAYS_FACTS]) {
      for (const entry of Object.values(catalogue)) expect(AREA_KEYS).toContain(entry.area)
    }
    for (const label of labels) {
      expect(label).not.toMatch(/[.!?]$/)
      expect(label).not.toContain('!')
    }
  })

  // [ruling 4] an absence is always "on the pages read": the lead-in says so, and no label claims more than that
  it('no absence label claims the whole site, and printed absences all carry "on the pages read"', () => {
    for (const [id, entry] of Object.entries(ABSENT_FACTS)) {
      const label = typeof entry.label === 'string' ? entry.label : entry.label('/sample-page')
      expect(label, id).not.toMatch(/anywhere|on your site|on the site|whole site|entire|any page|nowhere|never|does not exist|you do not have|you have no|you are not/i)
      const printed = evidenceLine({ kind: 'absent', label })
      expect(printed).toBe(`${LEAD_IN_ABSENT} ${label}`)
      expect(printed).toContain('on the pages read')
    }
  })

  // [ruling 2] no label may claim that links to other sites were checked
  it('the link facts speak of "your own site" only', () => {
    expect(MEASURED_FACTS.broken_links.label(3, 18)).toBe('3 of the 18 links we checked on your own site answered with an error')
    expect(MEASURED_FACTS.links_all_answer.label(18)).toBe('all 18 links we checked on your own site answered')
    // a page that redirects off the site speaks of your own site, and does not claim the other site was asked
    expect(MEASURED_FACTS.redirects_off_site.label(1, '/book')).toBe('1 linked page on your own site sends visitors to a different site and was not read: /book')
    expect(MEASURED_FACTS.redirects_off_site.label(2, '')).toBe('2 linked pages on your own site send visitors to a different site and were not read')
    for (const label of labels.filter((l) => /link/i.test(l) && /check/i.test(l))) expect(label).toContain('on your own site')
    for (const label of labels) expect(label).not.toMatch(/external|other sites?|outbound|all (of )?your links|every link/i)
  })
})

describe('computeFacts: a general site', () => {
  it('a bare page: what is missing, each in its area, with the page named by path for the reader and by number for the model', () => {
    const facts = computeFacts(site('<p>Hello and welcome to our little corner.</p>', ''), 'general')
    expect(ids(facts)).toEqual([
      'no_title@1',
      'no_meta_description@1',
      'no_h1@1',
      'no_og_title',
      'no_og_image',
      'no_local_business_data',
      'no_tel_link',
      'no_mailto_link',
      'no_form',
      'no_privacy_link',
    ])
    // [RULE 1] no "not found" from a text pattern: phone, street, hours, the area served, the copyright year are
    // never said to be missing (a pattern that did not match is no evidence)
    expect(facts.every((f) => f.family === 'absent')).toBe(true)
    expect(byId(facts, 'no_h1@1')).toEqual({ id: 'no_h1@1', area: 'found', family: 'absent', label: 'a main heading (H1) on /', hint: 'a main heading (H1) on page 1' })
    expect(factEvidence(byId(facts, 'no_form')!)).toEqual({ kind: 'absent', label: 'a form' })
  })

  it('a full page: what the code found is given as the page\'s own words, each an exact piece of the page', () => {
    const body = `<header><a href="tel:+19375550100">Call (937) 555-0100</a><a href="mailto:hello@care.example.test">hello@care.example.test</a></header>
<h1>Plumbing in Dayton</h1><p>Proudly serving Dayton, Kettering and Oakwood since 1998. Call us on 937-555-0100 any time.</p>
<p>Open Monday to Friday, 8am - 5pm. Visit us at 12 North Main Street, Dayton.</p>
<form><label>Your name</label><button>Send</button></form>
<footer><a href="/privacy">Privacy policy</a> © 2019-2024 Garrett Plumbing LLC. All rights reserved.</footer>`
    const head = `<title>Garrett Plumbing, plumbers in Dayton Ohio</title><meta name="description" content="Family plumbers serving Dayton since 1998.">
<meta property="og:title" content="Garrett Plumbing"><meta property="og:image" content="https://care.example.test/a.png"><meta property="og:site_name" content="Garrett Plumbing">
<script type="application/ld+json">{"@type":"Plumber","name":"Garrett Plumbing"}</script>`
    const content = site(body, head, PROBES)
    const facts = computeFacts(content, 'general')
    expect(ids(facts)).toEqual([
      'title_length',
      'description_length',
      'sitemap_listed',
      'phone_number',
      'street_address',
      'business_name',
      'tel_link',
      'mailto_link',
      'hours',
      'service_area',
      'copyright_year',
      'links_all_answer',
    ])
    expect(byId(facts, 'title_length')!.label).toBe('your home page title is 41 characters long')
    expect(byId(facts, 'description_length')!.label).toBe('your home page description for search results is 42 characters long')
    expect(byId(facts, 'sitemap_listed')!.label).toBe('your sitemap lists 12 addresses')
    expect(byId(facts, 'links_all_answer')!.label).toBe('all 18 links we checked on your own site answered')
    expect(byId(facts, 'tel_link')).toMatchObject({ family: 'says', pageUrl: `${SITE}/`, quote: 'Call (937) 555-0100' })
    expect(byId(facts, 'mailto_link')!.quote).toBe('hello@care.example.test')
    expect(byId(facts, 'business_name')!.quote).toBe('Garrett Plumbing')
    expect(byId(facts, 'copyright_year')!.quote).toContain('© 2019-2024')
    expect(byId(facts, 'hours')!.quote).toContain('Monday to Friday')
    // (the first place the page names its area is its description for search results)
    expect(byId(facts, 'service_area')!.quote).toBe('Family plumbers serving Dayton since 1998.')
    expect(byId(facts, 'street_address')!.quote).toContain('12 North Main Street')
    expect(byId(facts, 'phone_number')!.quote).toContain('555-0100')

    // every "says" quote is an exact piece of one segment of the page it names: the page really says it
    const says = facts.filter((f) => f.family === 'says')
    expect(says.length).toBe(8)
    for (const fact of says) {
      const from = content.pages.find((p) => p.url === fact.pageUrl)!
      const inSegment = from.segments.some((segment) => segment.value.includes(fact.quote!))
      const isLink = [from.facts.phoneLink?.text, from.facts.emailLink?.text].includes(fact.quote)
      expect(inSegment || isLink, `${fact.id}: ${fact.quote}`).toBe(true)
      expect(fact.quote!.length).toBeLessThanOrEqual(200)
      expect(factEvidence(fact)).toEqual({ kind: 'quote', pageUrl: fact.pageUrl, quote: fact.quote })
    }
    expect(factEvidence(byId(facts, 'links_all_answer')!)).toEqual({ kind: 'counted', text: 'all 18 links we checked on your own site answered' })
  })

  it.each<[string, Partial<SiteProbes>, string[], string[]]>([
    ['robots.txt keeps search engines off the home page', { robots: { state: 'found', disallowsHome: true, rule: 'Disallow: /' } }, ['robots_disallows_home'], []],
    ['robots.txt allows the home page', { robots: { state: 'found', disallowsHome: false, rule: 'Disallow: /' } }, [], ['robots_disallows_home']],
    ['no robots.txt: nothing to say', { robots: { state: 'missing' } }, [], ['robots_disallows_home']],
    ['no sitemap', { sitemap: { state: 'missing' } }, ['no_sitemap'], ['sitemap_listed']],
    ['a sitemap that could not be asked: no claim either way', { sitemap: { state: 'unknown' } }, [], ['no_sitemap', 'sitemap_listed']],
    ['http:// does not lead to https://', { httpsRedirect: 'no_redirect' }, ['no_https_redirect'], []],
    ['http:// leads to https://', { httpsRedirect: 'redirects' }, [], ['no_https_redirect']],
    ['the http:// question could not be asked: no claim', { httpsRedirect: 'unknown' }, [], ['no_https_redirect']],
    ['some links do not answer', { links: { checked: 18, broken: [{ url: `${SITE}/x`, status: 404 }, { url: `${SITE}/y`, status: 500 }] } }, ['broken_links'], ['links_all_answer']],
    ['no link was checked: no claim', { links: { checked: 0, broken: [] } }, [], ['broken_links', 'links_all_answer']],
  ])('%s', (_, probe, present, absent) => {
    const facts = ids(computeFacts(site('<p>Hello and welcome.</p>', undefined, { ...PROBES, ...probe }), 'general'))
    for (const id of present) expect(facts).toContain(id)
    for (const id of absent) expect(facts).not.toContain(id)
  })

  it('the broken-link and robots facts are printed in the code\'s words with the code\'s numbers', () => {
    const facts = computeFacts(
      site('<p>Hi</p>', undefined, { ...PROBES, robots: { state: 'found', disallowsHome: true, rule: 'Disallow: /' }, links: { checked: 18, broken: [{ url: `${SITE}/x`, status: 404 }, { url: `${SITE}/y`, status: 500 }, { url: `${SITE}/z`, status: 410 }] } }),
      'general'
    )
    expect(evidenceLine(factEvidence(byId(facts, 'broken_links')!))).toBe('Counted on your pages: 3 of the 18 links we checked on your own site answered with an error')
    expect(evidenceLine(factEvidence(byId(facts, 'robots_disallows_home')!))).toBe('Your page says: “Disallow: /” (on /robots.txt)')
  })

  describe('linked pages that redirect off the site: ONE fact for the site, a count, naming up to three paths', () => {
    const offSite = (...paths: string[]) => {
      const facts = computeFacts({ ...site('<p>Hi</p>'), offSitePages: paths.map((path) => `${SITE}${path}`) }, 'general')
      return { facts, fact: byId(facts, 'redirects_off_site')! }
    }

    it('one page: singular, its path printed, no path in the model\'s hint', () => {
      const { facts, fact } = offSite('/book')
      expect(fact).toMatchObject({
        area: 'trust',
        family: 'measured',
        label: '1 linked page on your own site sends visitors to a different site and was not read: /book',
        hint: '1 linked page on your own site sends visitors to a different site and was not read',
      })
      expect(facts.filter((f) => f.id.startsWith('redirects_off_site'))).toHaveLength(1)
      expect(evidenceLine(factEvidence(fact))).toBe('Counted on your pages: 1 linked page on your own site sends visitors to a different site and was not read: /book')
      expect(factsBlock(facts)).not.toContain('/book')
    })

    it('three pages: plural, all three named', () => {
      const { facts, fact } = offSite('/book', '/shop?x=1', '/events')
      expect(fact.label).toBe('3 linked pages on your own site send visitors to a different site and were not read: /book, /shop?x=1, /events')
      expect(fact.hint).toBe('3 linked pages on your own site send visitors to a different site and were not read')
      expect(facts.filter((f) => f.id.startsWith('redirects_off_site'))).toHaveLength(1)
    })

    it('more than three: three named, and how many more', () => {
      const { facts, fact } = offSite('/book', '/shop', '/events', '/jobs', '/news')
      expect(fact.label).toBe('5 linked pages on your own site send visitors to a different site and were not read: /book, /shop, /events and 2 more')
      expect(fact.hint).toBe('5 linked pages on your own site send visitors to a different site and were not read')
      for (const path of ['/book', '/shop', '/events', '/jobs', '/news']) expect(factsBlock(facts)).not.toContain(path)
    })

    it('none recorded: no fact', () => {
      expect(ids(computeFacts(site('<p>Hi</p>'), 'general')).some((id) => id.startsWith('redirects_off_site'))).toBe(false)
      expect(ids(computeFacts({ ...site('<p>Hi</p>'), offSitePages: [] }, 'general'))).not.toContain('redirects_off_site')
    })
  })

  it('without probes (nothing was asked) no probe fact is made at all', () => {
    const facts = ids(computeFacts(site('<p>Hi</p>'), 'general'))
    for (const id of ['no_sitemap', 'sitemap_listed', 'no_https_redirect', 'broken_links', 'links_all_answer', 'robots_disallows_home']) expect(facts).not.toContain(id)
  })

  it('page facts are per page: a second page without a heading, with two headings, with noindex', () => {
    const content: WebsiteContent = {
      pages: [
        page('<h1>Home</h1>', '<title>Home page of the site</title><meta name="description" content="d">'),
        page('<h1>One</h1><h1>Two</h1><h1>Three</h1>', '<meta name="robots" content="NOINDEX, follow">', `${SITE}/about?x=1`),
      ],
    }
    const facts = computeFacts(content, 'general')
    expect(ids(facts).filter((id) => id.includes('@'))).toEqual(['no_title@2', 'no_meta_description@2', 'multiple_h1@2', 'noindex@2'])
    expect(byId(facts, 'multiple_h1@2')).toMatchObject({ family: 'measured', label: '/about?x=1 has 3 main headings (H1)', hint: 'page 2 has 3 main headings (H1)' })
    // [P3-2] the page's own instruction exactly as written, not lower-cased by us
    expect(byId(facts, 'noindex@2')).toMatchObject({ family: 'says', pageUrl: `${SITE}/about?x=1`, quote: 'NOINDEX, follow', markup: true })
  })

  it('a contact detail on ANY page read counts: no "missing" fact because the home page lacks it', () => {
    const content: WebsiteContent = {
      pages: [page('<p>Welcome to our home page today.</p>'), page('<a href="tel:+15550100">Call us</a><a href="/privacy">Privacy</a><form><button>Go</button></form>', '<title>Contact</title>', `${SITE}/contact`)],
    }
    const facts = computeFacts(content, 'general')
    for (const id of ['no_tel_link', 'no_privacy_link', 'no_form']) expect(ids(facts)).not.toContain(id)
    expect(byId(facts, 'tel_link')).toMatchObject({ pageUrl: `${SITE}/contact`, quote: 'Call us' })
  })

  it('when a page\'s text was cut, "not found" facts that rest on the TEXT are not made; those that rest on the markup still are', () => {
    const long = page(`<p>${'word '.repeat(5000)}</p><p>Call 937-555-0100. Open 24/7.</p>`)
    expect(long.truncated).toBe(true)
    const facts = ids(computeFacts({ pages: [long] }, 'general'))
    for (const id of ['no_phone_number', 'no_street_address', 'no_hours', 'no_service_area', 'no_copyright_year']) expect(facts).not.toContain(id)
    for (const id of ['no_tel_link', 'no_mailto_link', 'no_form', 'no_privacy_link', 'no_og_image']) expect(facts).toContain(id)
  })

  it('a general audit has none of the home-care facts', () => {
    const facts = ids(computeFacts(site('<p>All our caregivers are licensed, insured and bonded. Careers.</p><a href="/careers">Careers</a>'), 'general'))
    expect(facts.filter((id) => /career|word_|payer|request_care/.test(id))).toEqual([])
  })

  it('no pages, no facts', () => {
    expect(computeFacts({ pages: [] }, 'home_care')).toEqual([])
  })
})

describe('computeFacts: home care, the two doors and the words a careful family looks for', () => {
  const HOME_CARE_IDS = /career|word_|payer|request_care/

  // [RULE 1] the words a family looks for are positive-only: a page that does not use them gets NO fact about them.
  // The one absence left is structural: no link, on any page, whose words or address name careers.
  it('a site that says none of it: only the structural careers absence, and nothing is claimed about words', () => {
    const facts = computeFacts(site('<p>We help older adults stay at home in comfort.</p>'), 'home_care').filter((f) => HOME_CARE_IDS.test(f.id))
    expect(ids(facts)).toEqual(['no_careers_link'])
    expect(facts.map((f) => evidenceLine(factEvidence(f)))).toEqual(['Looked for on the pages read, not found: a careers or apply link'])
  })

  it('a site that says all of it: each is reported as what the page says, with the page\'s own sentence', () => {
    const body = `<header><a href="/">Home</a><a href="/careers">Join our team</a></header>
<p>Sunrise is a licensed home care agency. Every caregiver is insured and bonded.</p>
<p>All caregivers pass a background check before their first visit. Our aides are trained in dementia care.</p>
<p>We accept Medicaid, private pay and long-term care insurance.</p>
<form><label>Tell us who needs care</label><button>Request care</button></form>`
    const content = site(body)
    const facts = computeFacts(content, 'home_care').filter((f) => HOME_CARE_IDS.test(f.id))
    expect(ids(facts)).toEqual(['careers_link', 'request_care_form', 'word_licensed', 'word_insured', 'word_bonded', 'word_background_check', 'word_trained', 'payer_words'])
    expect(facts.every((f) => f.family === 'says')).toBe(true)
    expect(Object.fromEntries(facts.map((f) => [f.id, f.quote]))).toEqual({
      careers_link: 'Join our team',
      // [P3-2] one real piece of the form's words, not its labels stitched together
      request_care_form: 'Request care',
      word_licensed: 'Sunrise is a licensed home care agency.',
      word_insured: 'Every caregiver is insured and bonded.',
      word_bonded: 'Every caregiver is insured and bonded.',
      word_background_check: 'All caregivers pass a background check before their first visit.',
      word_trained: 'Our aides are trained in dementia care.',
      payer_words: 'We accept Medicaid, private pay and long-term care insurance.',
    })
    // printed as the page's words, under the "your page says" lead-in: a report of words, not a finding about status
    expect(evidenceLine(factEvidence(byId(facts, 'word_licensed')!))).toBe('Your page says: “Sunrise is a licensed home care agency.” (on /)')
    for (const fact of facts) expect(`${fact.label} ${fact.hint}`).not.toMatch(/is licensed|are licensed|is insured|properly|valid|verified|confirmed/i)
  })

  it('a careers link that exists but is not among the first links of the home page is reported as both', () => {
    const filler = Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join('')
    const facts = computeFacts(site(`${filler}<footer><a href="/work-with-us">Apply to be a caregiver</a></footer>`), 'home_care')
    expect(byId(facts, 'careers_link')).toMatchObject({ family: 'says', quote: 'Apply to be a caregiver' })
    expect(byId(facts, 'no_careers_link_first')).toMatchObject({ family: 'absent', label: 'a careers or apply link among the first links of the home page' })
    expect(ids(facts)).not.toContain('no_careers_link')
  })

  it('the words are matched as words: "unlicensed" is "licensed" to nobody, and a form about a newsletter is not a care form', () => {
    const facts = ids(computeFacts(site('<p>Beware of unlicensed and uninsured providers, retrained or not.</p><form><label>Newsletter</label><button>Subscribe</button></form>'), 'home_care'))
    // positive-only: no match, no fact of either kind
    for (const id of ['word_licensed', 'word_insured', 'word_trained', 'request_care_form']) expect(facts).not.toContain(id)
    expect(facts.filter((id) => id.startsWith('no_word') || id === 'no_request_care_form')).toEqual([])
  })
})

describe('how the facts reach the model', () => {
  const body = '<a href="tel:+15550100">Call SECRET-LINK-TEXT now</a><p>We are open 24/7 for SECRET-PAGE-WORDS and more.</p>'
  const content: WebsiteContent = { pages: [page(body), page('<p>About us page.</p>', '', `${SITE}/SECRET-PATH`)] }
  const facts = computeFacts(content, 'general')

  it('the fact list is ids and the code\'s own words only: no page text, and a page is named by number, never by path', () => {
    const block = factsBlock(facts)
    expect(block).toContain('- [no_title@2] found: looked for and NOT found on the pages read: a page title on page 2')
    expect(block).toContain('- [tel_link] next_step: found: a phone number that can be tapped to call (the words are in the fact words block)')
    expect(block).toContain('- [title_length] found: counted: your home page title is 27 characters long')
    expect(block).not.toMatch(/SECRET|care\.example|https?:/)
    expect(block.split('\n')).toHaveLength(facts.length)
    expect(factsBlock([])).toBe('- none')
  })

  it('the page\'s words behind each "found" fact are handed over separately, to be put inside a data block', () => {
    const words = factWords(facts)
    expect(words.map((w) => w.id)).toEqual(facts.filter((f) => f.family === 'says').map((f) => f.id))
    expect(words.find((w) => w.id === 'tel_link')!.quote).toBe('Call SECRET-LINK-TEXT now')
    expect(words.find((w) => w.id === 'hours')!.quote).toContain('SECRET-PAGE-WORDS')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The review's rulings
// ---------------------------------------------------------------------------------------------------------------

describe('[RULE 1] "not found" comes only from structural checks; text patterns are positive-only', () => {
  // THE ALLOW-LIST. Every fact that can print under "Looked for on the pages read, not found:" is one of these, each
  // a check of the markup or of an answer a request got. Adding an absence anywhere else turns this red.
  const STRUCTURAL_ABSENCES = [
    'no_title', // no <title>
    'no_meta_description', // no <meta name="description">
    'no_h1', // no <h1>
    'no_sitemap', // /sitemap.xml answered 404 or 410 on the audited host
    'no_og_title', // no og:title tag
    'no_og_image', // no og:image tag
    'no_local_business_data', // no LocalBusiness type in JSON-LD, microdata or RDFa
    'no_tel_link', // no tel: link
    'no_mailto_link', // no mailto: link
    'no_form', // no <form> (and no frame that could hold one)
    'no_https_answer', // an https:// request to the same host failed with a connection or TLS error
    'no_https_redirect', // http:// answered without sending the visitor to https://
    'no_privacy_link', // no link whose address or words name a privacy policy
    'no_careers_link', // home care: no link, on any page, any host, whose address or words name careers
    'no_careers_link_first', // home care: none among the home page's first links
  ]

  it('the absence catalogue is exactly the allow-list of structural ids', () => {
    expect(Object.keys(ABSENT_FACTS).sort()).toEqual([...STRUCTURAL_ABSENCES].sort())
  })

  it('and only absence facts print under the "not found" lead-in: no other family can', () => {
    const many = computeFacts(site('<p>We serve Austin.</p>', '', { ...PROBES, sitemap: { state: 'missing' }, httpsRedirect: 'no_redirect', https: 'no_answer' }), 'home_care')
    for (const fact of many) {
      const printed = evidenceLine(factEvidence(fact))
      if (printed.startsWith(LEAD_IN_ABSENT)) {
        expect(fact.family).toBe('absent')
        expect(STRUCTURAL_ABSENCES).toContain(fact.id.replace(/@\d+$/, ''))
      }
    }
  })

  it.each([
    ['Service Areas', '<h2>Service Areas</h2><p>Travis and Hays counties.</p>'],
    ['Areas We Serve', '<h2>Areas We Serve</h2>'],
    ['Proudly Serving Austin', '<p>Proudly Serving Austin since 2001.</p>'],
    ['We serve Austin', '<p>We serve Austin and Round Rock.</p>'],
    ['Communities We Serve', '<h3>Communities We Serve</h3>'],
    ['Service area: Travis County', '<p>Service area: Travis County</p>'],
  ])('the area served, written as "%s", is found and quoted', (words, body) => {
    const facts = computeFacts(site(body), 'general')
    expect(byId(facts, 'service_area')?.quote, words).toContain(words.split(' ')[0])
    expect(ids(facts)).not.toContain('no_service_area')
  })

  it.each([
    ['1-800-FLOWERS', '<p>Call 1-800-FLOWERS today.</p>'],
    ['+44 20 7946 0958', '<p>London office: +44 20 7946 0958.</p>'],
    ['5125550100', '<p>Text us at 5125550100.</p>'],
    ['512/555-0100', '<p>Phone 512/555-0100.</p>'],
    ['(512) 555-0100', '<p>Phone (512) 555-0100.</p>'],
  ])('a phone number written as %s is found and quoted', (number, body) => {
    expect(byId(computeFacts(site(body), 'general'), 'phone_number')?.quote).toContain(number)
  })

  it('a page with none of the text patterns gets no fact about any of them, of either kind', () => {
    const facts = ids(computeFacts(site('<p>Hello and welcome.</p>'), 'home_care'))
    for (const id of ['phone_number', 'street_address', 'hours', 'service_area', 'copyright_year', 'business_name', 'request_care_form', 'payer_words']) {
      expect(facts).not.toContain(id)
      expect(facts).not.toContain(`no_${id}`)
    }
  })

  it('the business name matches across a curly and a straight apostrophe, and quotes the page\'s own spelling', () => {
    const facts = computeFacts(site('<p>Welcome to Bob’s Plumbing of Austin.</p>', `<title>T</title><meta property="og:site_name" content="Bob's Plumbing">`), 'general')
    expect(byId(facts, 'business_name')?.quote).toBe('Bob’s Plumbing')
  })

  it('local-business details written as microdata or RDFa count, so they are not "not found"', () => {
    const micro = site('<div itemscope itemtype="https://schema.org/Plumber"><span itemprop="name">Bob Plumbing</span></div>')
    const rdfa = site('<div vocab="https://schema.org/" typeof="LocalBusiness"><span property="name">Bob</span></div>')
    expect(ids(computeFacts(micro, 'general'))).not.toContain('no_local_business_data')
    expect(micro.pages[0].facts.schemaName).toBe('Bob Plumbing')
    expect(ids(computeFacts(rdfa, 'general'))).not.toContain('no_local_business_data')
  })
})

describe('[RULE 2] nothing about https that was not asked', () => {
  it('"not found: an answer on https://" ONLY when the https request failed with a connection or TLS error', () => {
    const http = (https: SiteProbes['https']): WebsiteContent => ({ pages: [page('<p>Hi</p>', '<title>T</title>', 'http://care.example.test/')], probes: { ...PROBES, https, httpsRedirect: 'unknown' } })
    expect(byId(computeFacts(http('no_answer'), 'general'), 'no_https_answer')).toMatchObject({
      family: 'absent',
      area: 'trust',
      label: 'an answer from your site on https:// (a secure address) when we tried it',
    })
    for (const state of ['yes', 'unknown', undefined] as const) expect(ids(computeFacts(http(state), 'general'))).not.toContain('no_https_answer')
    // a home page read over http:// is not, by itself, evidence of anything
    expect(ids(computeFacts({ pages: [page('<p>Hi</p>', '<title>T</title>', 'http://care.example.test/')] }, 'general')).filter((id) => /https/.test(id))).toEqual([])
  })
})

describe('[RULE 3] robots.txt: the file\'s own line, or a plain statement', () => {
  it('a line short enough is quoted as the file wrote it; a longer one is stated without quotation marks', () => {
    const quoted = computeFacts(site('<p>Hi</p>', undefined, { ...PROBES, robots: { state: 'found', disallowsHome: true, rule: 'disallow:/   # all of it' } }), 'general')
    expect(evidenceLine(factEvidence(byId(quoted, 'robots_disallows_home')!))).toBe('Your page says: “disallow:/   # all of it” (on /robots.txt)')
    const long = `Disallow: / # ${'x'.repeat(200)}`
    const stated = computeFacts(site('<p>Hi</p>', undefined, { ...PROBES, robots: { state: 'found', disallowsHome: true, rule: long } }), 'general')
    expect(ids(stated)).not.toContain('robots_disallows_home')
    expect(evidenceLine(factEvidence(byId(stated, 'robots_blocks_home')!))).toBe('Counted on your pages: your robots.txt file has a line telling every search engine to stay off your whole site')
  })
})

describe('[RULE 4] nothing hidden is quotable, through a fact or otherwise', () => {
  it('a hidden tel: link counts as a link (no "not found"), and its hidden words are quoted nowhere', () => {
    const hidden = page('<p>Welcome to the agency home page.</p><a href="tel:5551234" style="display:none">Licensed and bonded since 1990</a>')
    expect(hidden.facts.hasPhoneLink).toBe(true)
    expect(hidden.facts.phoneLink).toBeNull()
    const facts = computeFacts({ pages: [hidden] }, 'home_care')
    expect(ids(facts)).not.toContain('no_tel_link')
    expect(ids(facts)).not.toContain('tel_link')
    expect(JSON.stringify(facts)).not.toContain('Licensed and bonded')
    expect(JSON.stringify(hidden.facts)).not.toContain('Licensed and bonded')
  })
})

describe('[RULE 5] a page built by scripts: no fact from its text', () => {
  const app = (extra = '') =>
    page(`<div id="root"></div><script src="/app.js"></script><script>render()</script>${extra}`, '<title>Sunrise Home Care</title><meta property="og:title" content="Sunrise">')

  it('little visible text and scripts: the page is unreadable; head-level facts still made, body absences not', () => {
    const spa = app('<p>Loading</p>')
    expect(spa.textUnreadable).toBe(true)
    const facts = ids(computeFacts({ pages: [spa] }, 'home_care'))
    expect(facts).toContain('no_meta_description@1')
    expect(facts).toContain('no_og_image')
    expect(facts).toContain('title_length')
    for (const id of ['no_h1@1', 'no_form', 'no_tel_link', 'no_mailto_link', 'no_privacy_link', 'no_careers_link']) expect(facts).not.toContain(id)
    for (const id of ['phone_number', 'hours', 'service_area', 'business_name']) expect(facts).not.toContain(id)
  })

  it('a text-based fact is not made from it even when its little text matches', () => {
    const spa = app('<p>Call 512-555-0100. We serve Austin.</p>')
    expect(spa.textUnreadable).toBe(true)
    const facts = ids(computeFacts({ pages: [spa] }, 'general'))
    expect(facts).not.toContain('phone_number')
    expect(facts).not.toContain('service_area')
  })

  it('the same little text with no scripts is an ordinary page', () => {
    const plain = page('<p>Call 512-555-0100. We serve Austin.</p>')
    expect(plain.textUnreadable).toBe(false)
    expect(ids(computeFacts({ pages: [plain] }, 'general'))).toEqual(expect.arrayContaining(['phone_number', 'service_area', 'no_h1@1']))
  })

  it('a page that embeds a frame (a form may be inside it) is never "no form"', () => {
    const framed = page(`<p>${'Plenty of readable text about the agency. '.repeat(8)}</p><iframe src="https://forms.example.test/x"></iframe>`)
    expect(framed.textUnreadable).toBe(false)
    expect(ids(computeFacts({ pages: [framed] }, 'general'))).not.toContain('no_form')
    expect(ids(computeFacts({ pages: [page(`<p>${'Plenty of readable text. '.repeat(10)}</p>`)] }, 'general'))).toContain('no_form')
  })
})

describe('[RULE 6] home care: careers links on another site, and care forms that are not job forms', () => {
  it('a careers link to an applicant portal on another site is a positive fact, never "missing"', () => {
    const filler = Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join('')
    const facts = computeFacts(site(`${filler}<footer><a href="https://jobs.portal.example.org/sunrise">Apply now</a></footer>`), 'home_care')
    expect(byId(facts, 'careers_link_elsewhere')).toMatchObject({ family: 'says', quote: 'Apply now' })
    expect(evidenceLine(factEvidence(byId(facts, 'careers_link_elsewhere')!))).toBe('Your page says: “Apply now” (on /)')
    expect(ids(facts)).not.toContain('no_careers_link')
  })

  it('a caregiver job form is not a form to request care', () => {
    const facts = ids(computeFacts(site('<form><label>Caregiver application</label><label>Upload resume</label><button>Submit</button></form><form><button>Apply</button></form>'), 'home_care'))
    expect(facts).not.toContain('request_care_form')
  })

  it.each(['Request care', 'Schedule a free assessment', 'Request a consultation', 'Free in-home assessment'])('"%s" on a form is one', (words) => {
    const facts = computeFacts(site(`<form><label>Your name</label><button>${words}</button></form>`), 'home_care')
    expect(byId(facts, 'request_care_form')?.quote).toBe(words)
  })
})
