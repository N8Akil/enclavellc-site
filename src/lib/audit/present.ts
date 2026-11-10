// src/lib/audit/present.ts
// Wording shared by the .docx report and the emails, so both say the same true things.
// These return PLAIN TEXT. The email escapes it with escapeHtml; the .docx puts it in text runs.
import { NOT_ASSESSED_LABEL, UNASSESSED_CATEGORIES } from './config';
import type { AssessedCategory, AuditResults, Evidence, UnassessedCategory } from './types';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four'];

export function assessedCategories(results: AuditResults): AssessedCategory[] {
  return results.categories.filter((c): c is AssessedCategory => c.assessed);
}

// The short label for an area with no score. An area the free audit never reads says so; an area whose
// findings could not be supported says that instead.
export function notAssessedLabel(category: UnassessedCategory): string {
  return category.key ? 'Left out: findings not supported' : NOT_ASSESSED_LABEL;
}

// "the four areas read", "the one area read"
export function areasReadPhrase(results: AuditResults): string {
  const count = assessedCategories(results).length;
  return `the ${NUMBER_WORDS[count] ?? String(count)} ${count === 1 ? 'area' : 'areas'} read`;
}

// "Score for the four areas read: 7.2 of 10"
export function scoreLine(results: AuditResults): string {
  return `Score for ${areasReadPhrase(results)}: ${results.overallScore.toFixed(1)} of 10`;
}

// The page's path on its site ("/" for the homepage). Falls back to the text given.
export function pagePath(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    return `${url.pathname || '/'}${url.search}`;
  } catch {
    return pageUrl;
  }
}

// On /about: “the words quoted”      or      Looked for: a meta description, not found on /about
// The "Looked for" line is only ever built from a fact the code computed (run-audit.ts turns a fact id into
// `absent`); the model cannot write one.
export function evidenceLine(evidence: Evidence): string {
  if ('quote' in evidence) return `On ${pagePath(evidence.pageUrl)}: “${evidence.quote}”`;
  const where = evidence.siteWide ? 'any page read' : pagePath(evidence.pageUrl);
  return `Looked for: ${evidence.absent}, not found on ${where}`;
}

export const HOW_MADE_HEADING = 'How this was made and what it does not cover';

export function howMadeText(results: AuditResults): string {
  const pages = results.pagesRead.length;
  const notCovered = UNASSESSED_CATEGORIES.join(', ');
  return (
    `This report was produced automatically. Our software read the text of ${pages} public ${pages === 1 ? 'page' : 'pages'} of your site, ` +
    'and an AI model wrote the findings from that text. Each finding, strength and priority issue shows the words from your page that it rests on, ' +
    'or what our software looked for in the page and did not find, so you can check it yourself. ' +
    'Our software removed any finding whose quoted words it could not find on the page. ' +
    'Text the page hides in its own markup is not read. ' +
    `The score covers ${areasReadPhrase(results)} only. ` +
    `It does not cover ${notCovered}: those need the page rendered in a browser, which the full review includes. ` +
    'It does not compare your site with competitors, and no person has reviewed it.'
  );
}
