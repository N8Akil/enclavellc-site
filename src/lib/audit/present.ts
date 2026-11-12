// src/lib/audit/present.ts
// Wording shared by the PDF report and the emails, so both say the same true things.
// These return PLAIN TEXT. The email escapes it with escapeHtml; the PDF sets it as text.
import { EFFORT_LABELS, NOT_ASSESSED_LABEL, NOT_MEASURED_SENTENCE } from './config';
import type { AssessedArea, AuditResults, Evidence, Fix, UnassessedArea } from './types';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];

export function assessedAreas(results: AuditResults): AssessedArea[] {
  return results.areas.filter((a): a is AssessedArea => a.assessed);
}

// The short label for an area with no score.
export function notAssessedLabel(area: UnassessedArea): string {
  return area.reason === NOT_MEASURED_SENTENCE ? 'Not measured' : NOT_ASSESSED_LABEL;
}

// "the four areas assessed", "the one area assessed"
export function areasAssessedPhrase(results: AuditResults): string {
  const count = assessedAreas(results).length;
  return `the ${NUMBER_WORDS[count] ?? String(count)} ${count === 1 ? 'area' : 'areas'} assessed`;
}

// "Score for the four areas assessed: 7.2 of 10"
export function scoreLine(results: AuditResults): string {
  return `Score for ${areasAssessedPhrase(results)}: ${results.overallScore.toFixed(1)} of 10`;
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

// THE FIVE LEAD-INS. Every finding, strength and fix in a report is printed with exactly one of these, so the
// reader knows what kind of support it has: the page's own words, a count or length our software computed from the
// pages it read, a measurement taken outside our software and given to it, something our software looked for and
// did not find, or the AI model's reading of a screenshot (the one kind our software cannot check). Which one is
// printed follows the evidence's kind, which the verifying code sets; "Measured:" is for an injected measurement only.
export const LEAD_IN_QUOTE = 'Your page says:';
export const LEAD_IN_COUNTED = 'Counted on your pages:';
export const LEAD_IN_MEASURED = 'Measured:';
export const LEAD_IN_ABSENT = 'Looked for on the pages read, not found:';
export const LEAD_IN_SCREEN = 'Seen in the phone screenshot:';
export const LEAD_INS = [LEAD_IN_QUOTE, LEAD_IN_COUNTED, LEAD_IN_MEASURED, LEAD_IN_ABSENT, LEAD_IN_SCREEN] as const;
// what follows the screenshot lead-in: written here, because there is nothing of the model's to check and print
export const SCREEN_NOTE = 'our software cannot check this one; it rests on the AI model reading the picture.';

// Your page says: “the words quoted” (on /about)
// Counted on your pages: 3 of the 18 links we checked on your own site answered with an error
// Measured: the main content appeared after 4.2 seconds (words of an injected measurement)
// Looked for on the pages read, not found: a link to a privacy policy
// Seen in the phone screenshot: our software cannot check this one; ...
// The words after the "not found" and "Counted" lead-ins are written by our code (facts.ts); the words after
// "Measured" come from a measurement that was passed in. The model cannot write any of them.
export function evidenceLine(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'quote':
      return `${LEAD_IN_QUOTE} “${evidence.quote}” (on ${pagePath(evidence.pageUrl)})`;
    case 'counted':
      return `${LEAD_IN_COUNTED} ${evidence.text}`;
    case 'measured':
      return `${LEAD_IN_MEASURED} ${evidence.text}`;
    case 'absent':
      return `${LEAD_IN_ABSENT} ${evidence.label}`;
    case 'screen':
      return `${LEAD_IN_SCREEN} ${SCREEN_NOTE}`;
  }
}

// "Effort: An afternoon. You can do this yourself."
export function effortLine(fix: Fix): string {
  return `Effort: ${EFFORT_LABELS[fix.effort]}. ${fix.selfServe ? 'You can do this yourself.' : 'This one is likely to need someone who builds websites.'}`;
}

export const HOW_MADE_HEADING = 'How this was made and what it does not cover';

export function howMadeText(results: AuditResults): string {
  const pages = results.pagesRead.length;
  const speed = results.areas.find((a) => a.key === 'speed');
  const hasScreen = results.phoneCallouts.length > 0 || results.areas.some((a) => a.assessed && a.findings.some((f) => f.evidence.kind === 'screen'));
  return (
    `This report was produced automatically. Our software read the text of ${pages} public ${pages === 1 ? 'page' : 'pages'} of your site (it reads at most eleven), ` +
    'and an AI model wrote the findings from that text. Each finding, fix and strength says what it rests on: your page\'s own words, ' +
    'something our software counted, or something our software looked for on the pages read and did not find, so you can check it yourself. ' +
    'Our software removed any finding whose quoted words it could not find on the page. ' +
    "Text hidden in the page's own markup is not read; text hidden by a stylesheet or a script may be. " +
    ((results.scriptPages ?? 0) > 0 ? 'Some pages build their content with scripts and were not read. ' : '') +
    (results.linksChecked > 0
      ? `Our software asked ${results.linksChecked} ${results.linksChecked === 1 ? 'link' : 'links'} on your own site whether ${results.linksChecked === 1 ? 'it answers' : 'they answer'}; links to other sites were not checked. `
      : 'Links were not checked. ') +
    (speed && !speed.assessed && speed.reason === NOT_MEASURED_SENTENCE ? 'Loading speed was not measured, so Speed has no score. ' : '') +
    (results.measured
      ? "Findings marked as measured come from one run of Google's PageSpeed Insights test on a simulated phone, not from your visitors; a real visit can be faster or slower. "
      : '') +
    (hasScreen
      ? 'Findings marked as seen in the phone screenshot rest on the AI model reading the picture; our software cannot check those. '
      : results.screenshotTaken
        ? "A phone screenshot of your home page, taken by Google's test, was given to the AI model with the text. "
        : 'No picture of your site was taken: First impression is judged from the opening text of your home page only. ') +
    `The score covers ${areasAssessedPhrase(results)} only. ` +
    'It does not cover your visitor numbers, where you rank in search, your competitors, or anything behind a login. No person has reviewed it.'
  );
}
