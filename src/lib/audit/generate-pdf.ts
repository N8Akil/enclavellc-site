// src/lib/audit/generate-pdf.ts
// The audit report as a designed PDF, made in plain JavaScript (pdf-lib + fontkit; no browser, no binary, no service).
// The look follows the approved sample: a dark cover in the Night Crew colours, then paper pages printed in near-black
// ink with gold as the accent (the gold used as text is the darker "gold ink", 4.9:1 on the paper).
// Pages: 1 cover · 2 what works and the fixes · 3 the five areas · 4 how this was made, then the consultation block ·
// last, a dark page for the studio with its two office portraits (no finding sits beside a picture).
// A section that does not fit carries on onto another page; text is never shrunk below 9.5 pt and nothing is cut.
// Every word printed comes from the results, from present.ts or config.ts, or is a fixed label written here. The only
// numbers printed are the results' own (scores, the date, counts in their text) and the page and fix numbering.
import * as fs from 'fs';
import * as path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { HOW_MADE_HEADING, LEAD_INS, areasAssessedPhrase, effortLine, evidenceLine, howMadeText, notAssessedLabel } from './present';
import { NOT_MEASURED_SENTENCE, type ScoreStatus } from './config';
import type { AssessedArea, AuditResults, Evidence, UnassessedArea } from './types';

// ---------- the brand, on paper ----------
function hex(value: string): RGB {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const C = {
  night: hex('#0D0C0B'),
  nightLine: hex('#3A352E'),
  onNight: hex('#EDE6DA'),
  onNightDim: hex('#A79E90'),
  gold: hex('#E8B04B'),
  paper: hex('#F3EDE3'),
  ink: hex('#1A1714'),
  dim: hex('#5E564C'),
  line: hex('#D3C8B6'),
  goldInk: hex('#8A5D0C'),
  tally: hex('#BF2F35'),
  ok: hex('#2F6B4A'),
  boxText: hex('#D8CFC1'),
};

// US Letter, in points
const W = 612;
const H = 792;
const ML = 50;
const MR = 50;
const CW = W - ML - MR;
const CONTENT_TOP = H - 84;
const CONTENT_BOTTOM = 66;
// the smallest text in the report
const MIN = 9.5;
const BODY = 10.5;

// ---------- fonts (OFL; see docs/audit-system/PDF-LICENCES.md) ----------
const FONT_FILES = {
  black: 'BigShouldersDisplay-Black.ttf',
  xbold: 'BigShouldersDisplay-ExtraBold.ttf',
  sans: 'InstrumentSans-Regular.ttf',
  semi: 'InstrumentSans-SemiBold.ttf',
  italic: 'InstrumentSans-Italic.ttf',
  mono: 'IBMPlexMono-Regular.ttf',
  monoMed: 'IBMPlexMono-Medium.ttf',
} as const;
type FontKey = keyof typeof FONT_FILES;
type Fonts = Record<FontKey, PDFFont>;

// Read once per process. The site runs with `next start` from the repository root, as the .docx logo did.
const fontBytes = new Map<FontKey, Uint8Array>();
function fontFile(key: FontKey): Uint8Array {
  let bytes = fontBytes.get(key);
  if (!bytes) {
    bytes = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'audit', 'fonts', FONT_FILES[key]));
    fontBytes.set(key, bytes);
  }
  return bytes;
}

// ---------- pictures (see docs/audit-system/PDF-LICENCES.md) ----------
// Bundled with the site in src/lib/audit/images/ and read the same way as the fonts: nothing is fetched while a report
// is made, and nothing is taken from the audited site. scripts/build-audit-pdf-images.py makes them, each at the size it
// is drawn at. The mark is the site's own (the shape of public/night/logo-mark.png), in gold for the dark pages and in
// ink for the paper pages.
export const PICTURE_FILES = {
  markGold: 'mark-gold.png',
  markInk: 'mark-ink.png',
  markCover: 'mark-cover.png',
  isis: 'isis-office.jpg',
  osiris: 'osiris-office.jpg',
} as const;
type PictureKey = keyof typeof PICTURE_FILES;
type Pictures = Partial<Record<PictureKey, PDFImage>>;

const pictureBytes = new Map<PictureKey, Uint8Array>();
function pictureFile(key: PictureKey): Uint8Array {
  let bytes = pictureBytes.get(key);
  if (!bytes) {
    // a copy that owns its memory: pdf-lib reads a Node Buffer's whole shared pool otherwise
    bytes = Uint8Array.from(fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'audit', 'images', PICTURE_FILES[key])));
    pictureBytes.set(key, bytes);
  }
  return bytes;
}

// A picture left out is said once per process, by its file name only: never a path, never the error (whose text could
// carry anything), never anything from the site audited.
const warnedPictures = new Set<string>();
function warnPictureLeftOut(key: PictureKey) {
  const file = PICTURE_FILES[key];
  if (warnedPictures.has(file)) return;
  warnedPictures.add(file);
  console.warn(`[audit-pdf] picture left out: ${file}`);
}

// A picture that cannot be read or embedded is left out, alone: the report is made without it.
async function embedPictures(doc: PDFDocument): Promise<Pictures> {
  const out: Pictures = {};
  for (const key of Object.keys(PICTURE_FILES) as PictureKey[]) {
    try {
      const bytes = pictureFile(key);
      const image = PICTURE_FILES[key].endsWith('.png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      if (image.width > 0 && image.height > 0) out[key] = image;
      else warnPictureLeftOut(key);
    } catch {
      warnPictureLeftOut(key);
    }
  }
  return out;
}

// Draws a picture; one that fails to draw is left out, and the page carries on without it. (One that was never
// embedded was already said at embedding.)
function drawPicture(page: PDFPage, pics: Pictures, key: PictureKey, box: { x: number; y: number; width: number; height: number }): boolean {
  const image = pics[key];
  if (!image) return false;
  try {
    page.drawImage(image, box);
    return true;
  } catch {
    warnPictureLeftOut(key);
    return false;
  }
}

// ---------- text that is safe to print ----------
// Control and invisible formatting characters (zero-width and bidi marks, line and paragraph separators, variation
// selectors, the tag block) are removed (page quotes and the visitor's name can carry them);
// tabs and line breaks become spaces, because every string here is set as flowing text.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤⁦-⁩﻿￾￿\u061C\u180E\u2028\u2029\uFE00-\uFE0F]|\uDB40[\uDC00-\uDC7F]/g;
function printable(text: string): string {
  return text.replace(/[\t\n\r]+/g, ' ').replace(INVISIBLE, '');
}
function cleanDeep<T>(value: T): T {
  if (typeof value === 'string') return printable(value) as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)])) as T;
  return value;
}

const COVER_URL_MAX = 200;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "10 Nov 2026", in UTC. A date that cannot be read prints nothing rather than a made-up one.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------- wrapping ----------
interface Style {
  font: PDFFont;
  size: number;
  color: RGB;
}
interface Run extends Style {
  text: string;
}
interface Line {
  pieces: Run[];
  width: number;
  size: number;
}
const width = (text: string, s: Style) => s.font.widthOfTextAtSize(text, s.size);
const sameStyle = (a: Style, b: Style) => a.font === b.font && a.size === b.size && a.color === b.color;
// where a word too long for a line may break, after one of these, when one is in the second half of the piece
const BREAK_AFTER = '/-.?&=_,;:';

// Lays runs of styled text into lines no wider than maxWidth. Words break at spaces; a word longer than a line
// (a long URL, a run of letters) is broken between characters, so nothing runs off the page or is dropped.
function wrap(runs: Run[], maxWidth: number): Line[] {
  type Frag = { text: string; style: Style; space: boolean };
  const frags: Frag[] = [];
  let space = false;
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        space = true;
        continue;
      }
      frags.push({ text: part, style: run, space });
      space = false;
    }
  }
  const words: Frag[][] = [];
  for (const f of frags) {
    if (f.space || words.length === 0) words.push([f]);
    else words[words.length - 1].push(f);
  }

  const lines: Line[] = [];
  let cur: Run[] = [];
  let curW = 0;
  const size = Math.max(...runs.map((r) => r.size));
  const push = (text: string, style: Style) => {
    const last = cur[cur.length - 1];
    if (last && sameStyle(last, style)) last.text += text;
    else cur.push({ text, font: style.font, size: style.size, color: style.color });
    curW += width(text, style);
  };
  const flush = () => {
    if (cur.length) lines.push({ pieces: cur, width: curW, size });
    cur = [];
    curW = 0;
  };

  for (const word of words) {
    const wordW = word.reduce((sum, f) => sum + width(f.text, f.style), 0);
    const spaceW = cur.length ? width(' ', word[0].style) : 0;
    if (curW + spaceW + wordW <= maxWidth) {
      if (cur.length) push(' ', word[0].style);
      for (const f of word) push(f.text, f.style);
      continue;
    }
    if (wordW <= maxWidth) {
      flush();
      for (const f of word) push(f.text, f.style);
      continue;
    }
    // longer than a whole line: break it between characters
    if (cur.length && maxWidth - curW - spaceW < maxWidth * 0.3) flush();
    const chars = word.flatMap((f) => Array.from(f.text).map((ch) => ({ ch, style: f.style })));
    let i = 0;
    while (i < chars.length) {
      const leading = cur.length > 0;
      const avail = maxWidth - curW - (leading ? width(' ', chars[i].style) : 0);
      let j = i;
      let acc = 0;
      while (j < chars.length) {
        const cw = width(chars[j].ch, chars[j].style);
        if (acc + cw > avail && j > i) break;
        acc += cw;
        j++;
      }
      if (j < chars.length) {
        for (let k = j - 1; k > i + (j - i) / 2; k--) {
          if (BREAK_AFTER.includes(chars[k].ch)) {
            j = k + 1;
            break;
          }
        }
      }
      if (leading) push(' ', chars[i].style);
      for (const c of chars.slice(i, j)) push(c.ch, c.style);
      if (j < chars.length) flush();
      i = j;
    }
  }
  flush();
  return lines;
}

// the baseline of a line whose box starts at `top`
const baselineOf = (top: number, lineHeight: number, size: number) => top - lineHeight / 2 - size * 0.35;

function drawLine(page: PDFPage, line: Line, x: number, baseline: number, align: 'left' | 'center' = 'left', boxWidth = 0) {
  let at = align === 'center' ? x + (boxWidth - line.width) / 2 : x;
  for (const piece of line.pieces) {
    page.drawText(piece.text, { x: at, y: baseline, font: piece.font, size: piece.size, color: piece.color });
    at += width(piece.text, piece);
  }
}

function textHeight(runs: Run[], maxWidth: number, leading: number): number {
  return wrap(runs, maxWidth).reduce((h, l) => h + l.size * leading, 0);
}

// ---------- the evidence line, styled ----------
// The words are exactly present.ts's evidenceLine (one wording for the report and the emails). The lead-in is set
// in the semibold, the page's own words in italic inside their quotation marks, the page's path in the dim colour.
function evidenceRuns(evidence: Evidence, f: Fonts, size: number): Run[] {
  const line = evidenceLine(evidence);
  const leadIn = LEAD_INS.find((l) => line.startsWith(l)) ?? '';
  const rest = line.slice(leadIn.length);
  const lead: Run = { text: leadIn, font: f.semi, size, color: C.ink };
  if (evidence.kind === 'quote') {
    const close = rest.lastIndexOf('” (on ');
    if (close > -1) {
      return [
        lead,
        { text: rest.slice(0, close + 1), font: f.italic, size, color: C.ink },
        { text: rest.slice(close + 1), font: f.sans, size, color: C.dim },
      ];
    }
  }
  return [lead, { text: rest, font: f.sans, size, color: evidence.kind === 'screen' ? C.dim : C.ink }];
}

// ---------- the paper pages, as a flow ----------
class Flow {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = CONTENT_TOP;
  private title = '';

  constructor(
    private readonly doc: PDFDocument,
    private readonly f: Fonts,
    private readonly host: string
  ) {}

  section(title: string) {
    this.title = title;
    this.newPage();
  }

  newPage() {
    const page = this.doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.paper });
    // the running head: the section on the left, the site on the right when there is room for it
    const head = this.title.toUpperCase();
    page.drawText(head, { x: ML, y: H - 52, font: this.f.monoMed, size: MIN, color: C.ink });
    const headW = width(head, { font: this.f.monoMed, size: MIN, color: C.ink });
    const hostW = width(this.host, { font: this.f.mono, size: MIN, color: C.dim });
    if (headW + hostW + 24 <= CW) page.drawText(this.host, { x: W - MR - hostW, y: H - 52, font: this.f.mono, size: MIN, color: C.dim });
    page.drawLine({ start: { x: ML, y: H - 62 }, end: { x: W - MR, y: H - 62 }, thickness: 0.75, color: C.line });
    this.pages.push(page);
    this.page = page;
    this.y = CONTENT_TOP;
  }

  room(): number {
    return this.y - CONTENT_BOTTOM;
  }

  ensure(height: number) {
    if (this.y - height < CONTENT_BOTTOM) this.newPage();
  }

  gap(points: number) {
    this.y -= points;
  }

  // Sets text line by line; a line that does not fit goes to the next page, so long text flows and is never cut.
  text(runs: Run[], opts: { x?: number; width?: number; leading?: number; after?: number; align?: 'left' | 'center'; onFirstLine?: (baseline: number) => void } = {}) {
    const x = opts.x ?? ML;
    const w = opts.width ?? CW;
    const leading = opts.leading ?? 1.45;
    const lines = wrap(runs, w);
    lines.forEach((line, i) => {
      const lh = line.size * leading;
      this.ensure(lh);
      const baseline = baselineOf(this.y, lh, line.size);
      if (i === 0) opts.onFirstLine?.(baseline);
      drawLine(this.page, line, x, baseline, opts.align, w);
      this.y -= lh;
    });
    this.y -= opts.after ?? 0;
  }

  rule(color = C.line, thickness = 0.75, x = ML, w = CW) {
    // at the top of a page the running head's rule already separates it
    if (this.y >= CONTENT_TOP) return;
    this.page.drawLine({ start: { x, y: this.y }, end: { x: x + w, y: this.y }, thickness, color });
  }

  eyebrow(text: string, after = 10) {
    this.ensure(60);
    this.text([{ text: text.toUpperCase(), font: this.f.monoMed, size: MIN, color: C.goldInk }], { after });
  }
}

// The Enclave mark and the word, on one baseline. Without its picture the word stands alone.
const MARK_H = 13;
function drawMark(page: PDFPage, f: Fonts, x: number, baseline: number, pics: Pictures, key: 'markGold' | 'markInk', word: RGB) {
  const mark = pics[key];
  const w = mark ? (MARK_H * mark.width) / mark.height : 0;
  const drawn = drawPicture(page, pics, key, { x, y: baseline - 2.5, width: w, height: MARK_H });
  page.drawText('ENCLAVE', { x: drawn ? x + w + 6 : x, y: baseline, font: f.monoMed, size: MIN, color: word });
}

function drawFooter(page: PDFPage, f: Fonts, pics: Pictures, index: number, total: number) {
  page.drawLine({ start: { x: ML, y: 52 }, end: { x: W - MR, y: 52 }, thickness: 0.75, color: C.line });
  drawMark(page, f, ML, 36, pics, 'markInk', C.ink);
  const label = `${index} / ${total}`;
  const lw = width(label, { font: f.mono, size: MIN, color: C.dim });
  page.drawText(label, { x: W - MR - lw, y: 36, font: f.mono, size: MIN, color: C.dim });
}

// ---------- page 1: the cover ----------
// the stripe under the head of the dark pages
function drawStripe(page: PDFPage, stripeTop = H - 78) {
  const bar = 16;
  const skew = 4;
  for (let x = ML + skew; x + bar <= W - MR; x += bar * 2) {
    page.drawSvgPath(`M ${skew} 0 L ${bar + skew} 0 L ${bar} 9 L 0 9 Z`, { x: x - skew, y: stripeTop, color: C.onNight, opacity: 0.9 });
  }
}

function drawCover(doc: PDFDocument, f: Fonts, pics: Pictures, r: AuditResults, userName: string) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.night });

  const headA = 'WEBSITE AUDIT';
  const headB = ' · FREE EDITION';
  const date = formatDate(r.auditDate);
  // the band: the mark and the name on the left; the edition and the date stacked on the right. Without its picture
  // the name stands alone
  const markH = 26;
  const mark = pics.markCover;
  const mw = mark ? (markH * mark.width) / mark.height : 0;
  const drawn = drawPicture(page, pics, 'markCover', { x: ML, y: H - 62, width: mw, height: markH });
  page.drawText('ENCLAVE', { x: drawn ? ML + mw + 10 : ML, y: H - 61, font: f.xbold, size: 24, color: C.onNight });
  const aw = width(headA, { font: f.monoMed, size: MIN, color: C.onNight });
  const bw = width(headB, { font: f.mono, size: MIN, color: C.onNightDim });
  page.drawText(headA, { x: W - MR - aw - bw, y: H - 46, font: f.monoMed, size: MIN, color: C.onNight });
  page.drawText(headB, { x: W - MR - bw, y: H - 46, font: f.mono, size: MIN, color: C.onNightDim });
  if (date) {
    const dw = width(date, { font: f.mono, size: MIN, color: C.onNightDim });
    page.drawText(date, { x: W - MR - dw, y: H - 61, font: f.mono, size: MIN, color: C.onNightDim });
  }
  page.drawLine({ start: { x: ML, y: H - 72 }, end: { x: W - MR, y: H - 72 }, thickness: 0.75, color: C.nightLine });
  drawStripe(page, H - 86);

  // the site: its address in mono gold, its name in large type, sized down until it fits in three lines
  let y = H - 150;
  // the address is cut at 200 characters on the cover only, so a very long one cannot run into the score block
  const coverUrl = r.websiteUrl.length > COVER_URL_MAX ? `${r.websiteUrl.slice(0, COVER_URL_MAX - 1)}…` : r.websiteUrl;
  for (const line of wrap([{ text: coverUrl, font: f.mono, size: 12, color: C.gold }], CW)) {
    drawLine(page, line, ML, y);
    y -= 17;
  }
  const host = hostOf(r.websiteUrl).toUpperCase();
  let size = 64;
  let lines = wrap([{ text: host, font: f.black, size, color: C.onNight }], CW);
  while (lines.length > 3 && size > 28) {
    size -= 4;
    lines = wrap([{ text: host, font: f.black, size, color: C.onNight }], CW);
  }
  y -= size * 0.55;
  for (const line of lines) {
    y -= size * 0.92;
    drawLine(page, line, ML, y);
  }
  if (userName) {
    y -= 26;
    for (const line of wrap([
      { text: 'PREPARED FOR ', font: f.mono, size: MIN, color: C.onNightDim },
      { text: userName, font: f.monoMed, size: MIN, color: C.onNight },
    ], CW)) {
      drawLine(page, line, ML, y);
      y -= 14;
    }
  }

  // the score, large, with the scale and its status word; "where you stand" beside it
  const scoreBaseline = 150;
  const score = r.overallScore.toFixed(1);
  const scoreSize = 150;
  const scoreW = width(score, { font: f.black, size: scoreSize, color: C.gold });
  page.drawText(areasAssessedPhrase(r).replace(/^the /, 'Score for the ').toUpperCase(), { x: ML, y: scoreBaseline + scoreSize * 0.8 + 18, font: f.mono, size: MIN, color: C.onNightDim });
  page.drawText(score, { x: ML, y: scoreBaseline, font: f.black, size: scoreSize, color: C.gold });
  page.drawText('/10', { x: ML + scoreW + 6, y: scoreBaseline, font: f.xbold, size: 40, color: C.onNightDim });
  page.drawText(r.overallStatus.toUpperCase(), { x: ML, y: scoreBaseline - 36, font: f.xbold, size: 24, color: C.onNight });

  const scaleW = width('/10', { font: f.xbold, size: 40, color: C.onNightDim });
  const colX = Math.max(ML + scoreW + scaleW + 34, ML + 250);
  const colW = W - MR - colX;
  const whereRuns: Run[] = [{ text: r.whereYouStand, font: f.sans, size: 15, color: C.onNight }];
  const whereLines = wrap(whereRuns, colW);
  const lh = 15 * 1.4;
  let wy = scoreBaseline - 36 + 4 + whereLines.length * lh;
  page.drawText('WHERE YOU STAND', { x: colX, y: wy + 12, font: f.mono, size: MIN, color: C.onNightDim });
  for (const line of whereLines) {
    drawLine(page, line, colX, baselineOf(wy, lh, 15));
    wy -= lh;
  }

  page.drawLine({ start: { x: ML, y: 52 }, end: { x: W - MR, y: 52 }, thickness: 0.75, color: C.nightLine });
  drawMark(page, f, ML, 36, pics, 'markGold', C.onNight);
  const site = 'enclavellc.net';
  page.drawText(site, { x: W - MR - width(site, { font: f.mono, size: MIN, color: C.onNightDim }), y: 36, font: f.mono, size: MIN, color: C.onNightDim });
}

// ---------- page 2: what works, and the fixes ----------
function drawShortVersion(flow: Flow, f: Fonts, r: AuditResults) {
  flow.section('The short version');

  if (r.working.length > 0) {
    flow.eyebrow('What is working');
    const gap = 22;
    const colW = r.working.length > 1 ? (CW - gap) / 2 : CW;
    const blocks = r.working.map((w) => [
      { runs: [{ text: w.title, font: f.semi, size: 11.5, color: C.ink }], after: 2 },
      { runs: [{ text: w.line, font: f.sans, size: BODY, color: C.dim }], after: 4 },
      { runs: evidenceRuns(w.evidence, f, 10), after: 0 },
    ]);
    const heightOf = (block: typeof blocks[number], w: number) => 10 + block.reduce((h, p) => h + textHeight(p.runs, w, 1.42) + p.after, 0);
    const tallest = Math.max(...blocks.map((b) => heightOf(b, colW)));
    const pageRoom = CONTENT_TOP - CONTENT_BOTTOM;
    if (r.working.length <= 2 && tallest <= pageRoom) {
      // side by side
      flow.ensure(tallest);
      const top = flow.y;
      let lowest = top;
      blocks.forEach((block, i) => {
        const x = ML + i * (colW + gap);
        flow.y = top;
        flow.page.drawRectangle({ x, y: top - 2.5, width: colW, height: 2.5, color: C.ok });
        flow.gap(10);
        for (const p of block) flow.text(p.runs, { x, width: colW, leading: 1.42, after: p.after });
        lowest = Math.min(lowest, flow.y);
      });
      flow.y = lowest;
    } else {
      // too tall to sit side by side: one under the other, flowing
      for (const block of blocks) {
        flow.ensure(40);
        flow.page.drawRectangle({ x: ML, y: flow.y - 2.5, width: CW, height: 2.5, color: C.ok });
        flow.gap(10);
        for (const p of block) flow.text(p.runs, { leading: 1.42, after: p.after });
        flow.gap(12);
      }
    }
    flow.gap(26);
  }

  if (r.fixes.length > 0) {
    flow.eyebrow('The fixes that matter most', 8);
    const gutter = 46;
    const labelW = 92;
    const x = ML + gutter;
    const valueX = x + labelW;
    const valueW = CW - gutter - labelW;
    r.fixes.forEach((fix, index) => {
      const headline: Run[] = [{ text: fix.headline, font: f.semi, size: 13, color: C.ink }];
      // keep the number and headline with the first row
      flow.ensure(textHeight(headline, CW - gutter, 1.3) + 12 + 30);
      flow.rule();
      flow.gap(12);
      const top = flow.y;
      flow.page.drawText(String(index + 1), { x: ML, y: top - 30, font: f.black, size: 38, color: C.goldInk });
      flow.text(headline, { x, width: CW - gutter, leading: 1.3, after: 6 });

      const effort = effortLine(fix).replace(/^Effort: /, '');
      const firstStop = effort.indexOf('. ');
      const rows: Array<{ label: string; runs: Run[]; evidence?: Evidence }> = [
        { label: 'What we saw', runs: [{ text: fix.whatWeSaw, font: f.sans, size: BODY, color: C.ink }], evidence: fix.evidence },
        { label: 'Why it matters', runs: [{ text: fix.whyItMatters, font: f.sans, size: BODY, color: C.ink }] },
        { label: 'The fix', runs: [{ text: fix.theFix, font: f.sans, size: BODY, color: C.ink }] },
        {
          label: 'Effort',
          runs:
            firstStop > -1
              ? [
                  { text: effort.slice(0, firstStop + 1), font: f.semi, size: BODY, color: C.ink },
                  { text: effort.slice(firstStop + 1), font: f.sans, size: BODY, color: C.ink },
                ]
              : [{ text: effort, font: f.sans, size: BODY, color: C.ink }],
        },
      ];
      for (const row of rows) {
        const label = row.label.toUpperCase();
        flow.text(row.runs, {
          x: valueX,
          width: valueW,
          leading: 1.42,
          after: row.evidence ? 2 : 4,
          onFirstLine: (baseline) => flow.page.drawText(label, { x, y: baseline + 0.5, font: f.mono, size: MIN, color: C.dim }),
        });
        if (row.evidence) flow.text(evidenceRuns(row.evidence, f, 10), { x: valueX, width: valueW, leading: 1.42, after: 4 });
      }
      flow.gap(10);
    });
    flow.rule();
  }
}

// ---------- the phone screenshot ----------
// Google's phone screenshot of the home page, drawn once, in a simple phone-shaped frame. pdf-lib holds JPEG and PNG
// only; anything else (WEBP), or bytes that are not the type they say, is left out with no error and no caption.
export interface PhoneShot {
  mediaType: string;
  dataBase64: string;
}
export const PHONE_SHOT_CAPTION = "Your home page on a phone, as Google's test saw it.";

// The picture's size is read from its own bytes before anything is embedded: a picture with no width or height, or one
// large enough to cost seconds and hundreds of megabytes to decode, is left out.
const SHOT_MAX_SIDE = 2000;
const SHOT_MAX_PIXELS = 4_000_000;
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

export function readImageSize(bytes: Uint8Array, mediaType: string): { width: number; height: number } | null {
  if (mediaType === 'image/png') {
    // signature, then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4)
    if (bytes.length < 24 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
    if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mediaType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
    // walk the marker segments to the first start-of-frame: marker (2), length (2), precision (1), height (2), width (2)
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 9 > bytes.length) return null;
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

async function embedShot(doc: PDFDocument, shot: PhoneShot | undefined): Promise<PDFImage | null> {
  if (!shot || typeof shot.dataBase64 !== 'string') return null;
  try {
    // a copy that owns its memory: pdf-lib reads a Node Buffer's whole shared pool otherwise
    const bytes = Uint8Array.from(Buffer.from(shot.dataBase64, 'base64'));
    // the bytes must be the type they say, and have a size we are willing to decode
    const size = readImageSize(bytes, shot.mediaType);
    if (!size || size.width < 1 || size.height < 1) return null;
    if (size.width > SHOT_MAX_SIDE || size.height > SHOT_MAX_SIDE || size.width * size.height > SHOT_MAX_PIXELS) return null;
    const image = shot.mediaType === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    return image.width > 0 && image.height > 0 ? image : null;
  } catch {
    // a picture that cannot be read is no picture
  }
  return null;
}

// about 36% of the content width, a picture pixel being a point: never drawn larger than its own pixels
const SHOT_FRAME_W = Math.round(CW * 0.36);
const SHOT_PAD = 8;
const SHOT_MAX_IMG_H = 380;

function drawPhoneShot(flow: Flow, f: Fonts, image: PDFImage, callouts: AuditResults['phoneCallouts']) {
  let w = Math.min(SHOT_FRAME_W - SHOT_PAD * 2, image.width);
  let h = (w * image.height) / image.width;
  if (h > SHOT_MAX_IMG_H) {
    w = (w * SHOT_MAX_IMG_H) / h;
    h = SHOT_MAX_IMG_H;
  }
  const frameW = w + SHOT_PAD * 2;
  const frameH = h + SHOT_PAD * 2;
  const caption = wrap([{ text: PHONE_SHOT_CAPTION, font: f.mono, size: MIN, color: C.dim }], frameW);
  const captionH = caption.reduce((sum, line) => sum + line.size * 1.35, 0);
  const sideX = ML + frameW + 26;
  const sideW = CW - frameW - 26;
  const sideRuns = callouts.map((c) => ({ title: [{ text: c.title, font: f.semi, size: BODY, color: C.ink }] as Run[], line: [{ text: c.line, font: f.sans, size: BODY, color: C.dim }] as Run[] }));
  const sideH = sideRuns.length ? 22 + sideRuns.reduce((sum, c) => sum + textHeight(c.title, sideW, 1.42) + textHeight(c.line, sideW, 1.42) + 8, 0) : 0;
  const blockH = Math.max(frameH + 7 + captionH, sideH);

  // the picture and its caption are one piece: never split across pages
  flow.ensure(Math.min(blockH, CONTENT_TOP - CONTENT_BOTTOM));
  const page = flow.page;
  const top = flow.y;
  const r = 14;
  const outline = `M ${r} 0 H ${frameW - r} A ${r} ${r} 0 0 1 ${frameW} ${r} V ${frameH - r} A ${r} ${r} 0 0 1 ${frameW - r} ${frameH} H ${r} A ${r} ${r} 0 0 1 0 ${frameH - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(outline, { x: ML, y: top, borderColor: C.ink, borderWidth: 1, color: C.paper });
  page.drawImage(image, { x: ML + SHOT_PAD, y: top - SHOT_PAD - h, width: w, height: h });
  let baseline = top - frameH - 7;
  for (const line of caption) {
    baseline -= line.size;
    drawLine(page, line, ML, baseline, 'center', frameW);
    baseline -= line.size * 0.35;
  }

  // the call-outs sit beside the picture
  if (sideRuns.length) {
    flow.text([{ text: 'YOUR SITE ON A PHONE', font: f.monoMed, size: MIN, color: C.goldInk }], { x: sideX, width: sideW, after: 10 });
    for (const c of sideRuns) {
      flow.text(c.title, { x: sideX, width: sideW, leading: 1.42 });
      flow.text(c.line, { x: sideX, width: sideW, leading: 1.42, after: 8 });
    }
  }
  // below the taller of the two
  flow.y = Math.min(flow.y, top - blockH);
}

// ---------- page 3: the five areas ----------
function statusColor(status: ScoreStatus): RGB {
  if (status === 'Critical') return C.tally;
  return C.dim;
}
// how many of the ten cells of an area's bar are filled: one per point of its score
export function barFill(score: number): number {
  return Math.max(0, Math.min(10, Math.round(score)));
}
function barColor(status: ScoreStatus): RGB {
  if (status === 'Critical') return C.tally;
  if (status === 'Good' || status === 'Excellent') return C.goldInk;
  return C.ink;
}

function drawAreas(flow: Flow, f: Fonts, r: AuditResults, image: PDFImage | null) {
  // a picture that fails to draw costs the picture and its caption, never the report: the call-outs then print alone
  let shot = image;
  const drawShot = (): boolean => {
    if (!shot) return false;
    try {
      drawPhoneShot(flow, f, shot, r.phoneCallouts);
      return true;
    } catch {
      shot = null;
      return false;
    }
  };
  flow.section('The five areas');
  flow.text([{ text: 'FIVE QUESTIONS A CUSTOMER ASKS WITHOUT SAYING THEM.', font: f.black, size: 30, color: C.ink }], { leading: 0.98, after: 16 });

  const left = 84;
  const midX = ML + left;
  const barW = 112;
  let shotDrawn = false;
  for (const area of r.areas) {
    // the phone picture, with its call-outs beside it, sits right above the First impression area
    if (shot && !shotDrawn && area.key === 'first_impression') {
      flow.gap(10);
      shotDrawn = drawShot();
      flow.gap(18);
    }
    const assessed = area.assessed;
    const name: Run[] = [{ text: area.name.toUpperCase(), font: f.xbold, size: 20, color: C.ink }];
    flow.ensure(80);
    flow.rule();
    flow.gap(14);
    const top = flow.y;
    const rowPage = flow.page;
    let leftBottom = top;

    if (assessed) {
      const a = area as AssessedArea;
      const s = String(a.score);
      const sw = width(s, { font: f.black, size: 46, color: C.ink });
      flow.page.drawText(s, { x: ML, y: top - 36, font: f.black, size: 46, color: C.ink });
      flow.page.drawText('/10', { x: ML + sw + 3, y: top - 36, font: f.xbold, size: 14, color: C.dim });
      // the status word, wrapped inside the score column ("NEEDS / IMPROVEMENT")
      let sy = top - 52;
      for (const line of wrap([{ text: a.status.toUpperCase(), font: f.mono, size: MIN, color: statusColor(a.status) }], left - 8)) {
        drawLine(flow.page, line, ML, sy);
        sy -= 12;
      }
      leftBottom = sy - 2;
      // ten cells, one per point
      const cell = (barW - 9 * 3) / 10;
      for (let i = 0; i < 10; i++) {
        flow.page.drawRectangle({ x: W - MR - barW + i * (cell + 3), y: top - 14, width: cell, height: 7, color: i < barFill(a.score) ? barColor(a.status) : C.line });
      }
    } else {
      const u = area as UnassessedArea;
      for (const line of wrap([{ text: notAssessedLabel(u).toUpperCase(), font: f.mono, size: MIN, color: C.dim }], left - 10)) {
        drawLine(flow.page, line, ML, top - 14);
      }
      leftBottom = top - 24;
    }

    flow.text(name, { x: midX, width: CW - left, leading: 1.05, after: 3 });
    if (assessed) {
      const a = area as AssessedArea;
      flow.text([{ text: a.line, font: f.sans, size: BODY, color: C.dim }], { x: midX, width: CW - left, leading: 1.42, after: 8 });
      for (const finding of a.findings) {
        flow.text([{ text: finding.text, font: f.sans, size: BODY, color: C.ink }], { x: midX, width: CW - left, leading: 1.42, after: 1 });
        flow.text(evidenceRuns(finding.evidence, f, 10), { x: midX, width: CW - left, leading: 1.42, after: 7 });
      }
    } else {
      const u = area as UnassessedArea;
      flow.text([{ text: u.reason, font: f.sans, size: BODY, color: C.dim }], { x: midX, width: CW - left, leading: 1.42, after: 8 });
      if (u.key === 'speed' && u.reason === NOT_MEASURED_SENTENCE) {
        // Google's test gave no measurement: the place it would go, empty and saying so. Speed unassessed for any other
        // reason (measured, findings unsupported) shows its reason alone, as present.ts keys it
        flow.ensure(40);
        const label = "Waiting on Google's speed test";
        flow.page.drawRectangle({ x: midX, y: flow.y - 34, width: CW - left, height: 34, borderColor: C.dim, borderWidth: 0.9, borderDashArray: [3, 3] });
        const lw = width(label, { font: f.mono, size: MIN, color: C.dim });
        flow.page.drawText(label, { x: midX + (CW - left - lw) / 2, y: flow.y - 20.5, font: f.mono, size: MIN, color: C.dim });
        flow.gap(42);
      }
    }
    // the row is at least as tall as its score column
    if (flow.page === rowPage) flow.y = Math.min(flow.y, leftBottom);
    flow.gap(6);
  }
  flow.rule();

  // only when a phone screenshot was supplied; with its picture they sit beside it (above), alone only when the
  // picture could not be drawn
  if (shot && !shotDrawn) {
    flow.gap(10);
    shotDrawn = drawShot();
  }
  if (!shotDrawn && r.phoneCallouts.length > 0) {
    flow.gap(24);
    flow.eyebrow('Your site on a phone');
    for (const c of r.phoneCallouts) {
      flow.text([{ text: c.title, font: f.semi, size: BODY, color: C.ink }], { leading: 1.42 });
      flow.text([{ text: c.line, font: f.sans, size: BODY, color: C.dim }], { leading: 1.42, after: 8 });
    }
  }
}

// ---------- page 4: how this was made, and the consultation block ----------
function drawHowMade(flow: Flow, f: Fonts, r: AuditResults) {
  flow.section('How this was made');
  flow.text([{ text: HOW_MADE_HEADING.toUpperCase(), font: f.black, size: 28, color: C.ink }], { leading: 0.98, after: 14 });
  flow.text([{ text: howMadeText(r), font: f.sans, size: BODY, color: C.ink }], { leading: 1.5, after: 28 });

  // The consultation block, word for word as the .docx had it; ruled unchanged until the founder decides the offer pages.
  flow.ensure(120);
  flow.rule(C.ink, 1);
  flow.gap(12);
  flow.text([{ text: 'Ready to Take Action?', font: f.black, size: 26, color: C.ink }], { leading: 1.05, after: 6 });
  flow.text([{ text: 'This audit gives you a clear picture of where your website stands. The next step is turning these insights into results.', font: f.sans, size: BODY, color: C.dim }], { leading: 1.45, after: 14 });
  flow.text([{ text: 'How Enclave Development Can Help', font: f.semi, size: 12.5, color: C.ink }], { leading: 1.3, after: 6 });
  const services: Array<[string, string]> = [
    ['Website Rebuild: ', 'Modern, fast, mobile-first design that converts visitors into customers'],
    ['Automation Setup: ', 'Streamline your lead follow-up so you never miss an opportunity'],
    ['Content & SEO: ', 'Get found by the right customers with optimized content'],
    ['Ongoing Support: ', 'Maintenance, updates, and continuous improvement'],
  ];
  for (const [label, text] of services) {
    flow.text(
      [
        { text: label, font: f.semi, size: BODY, color: C.goldInk },
        { text, font: f.sans, size: BODY, color: C.ink },
      ],
      { x: ML + 14, width: CW - 14, leading: 1.45, after: 3, onFirstLine: (baseline) => flow.page.drawRectangle({ x: ML, y: baseline + 2, width: 4.5, height: 4.5, color: C.ink }) }
    );
  }
  flow.gap(16);

  // the call to action, in a dark box
  const pad = 20;
  const innerW = CW - pad * 2;
  const box: Array<{ runs: Run[]; leading: number; after: number }> = [
    { runs: [{ text: 'Schedule Your Free Consultation', font: f.black, size: 24, color: C.gold }], leading: 1.1, after: 4 },
    { runs: [{ text: "Let's discuss your audit results and create a plan tailored to your business.", font: f.sans, size: BODY, color: C.boxText }], leading: 1.45, after: 8 },
    { runs: [{ text: 'Visit: ', font: f.sans, size: BODY, color: C.boxText }, { text: 'enclavellc.net', font: f.semi, size: 11, color: C.gold }], leading: 1.45, after: 0 },
    { runs: [{ text: 'Email: ', font: f.sans, size: BODY, color: C.boxText }, { text: 'n.garrett@enclavellc.net', font: f.semi, size: BODY, color: C.gold }], leading: 1.45, after: 0 },
  ];
  const boxH = pad * 2 + box.reduce((h, p) => h + textHeight(p.runs, innerW, p.leading) + p.after, 0);
  flow.ensure(boxH);
  flow.page.drawRectangle({ x: ML, y: flow.y - boxH, width: CW, height: boxH, color: C.ink });
  flow.gap(pad);
  for (const p of box) flow.text(p.runs, { x: ML + pad, width: innerW, leading: p.leading, after: p.after });
  flow.gap(pad + 18);
  flow.text([{ text: 'Thank you for choosing Enclave Development', font: f.italic, size: BODY, color: C.dim }], { align: 'center', leading: 1.4 });
}

// ---------- the last page: the studio ----------
// A dark page after the report, set apart from every finding, so no picture can read as evidence for one. Its words
// are the site's own (the home page's line and the crew's roles); each portrait is named as an AI partner right under it.
export const STUDIO_HEADING = 'One founder, six AI partners, one studio.';
export const STUDIO_LINE = 'Your website, your follow-up and your content keep working after you close.';
export const STUDIO_PARTNERS: Array<{ key: 'isis' | 'osiris'; name: string; role: string }> = [
  { key: 'isis', name: 'Isis', role: 'Design and build' },
  { key: 'osiris', name: 'Osiris', role: 'Quality review' },
];
export const AI_PARTNER_LABEL = 'AI partner';

function drawStudio(doc: PDFDocument, f: Fonts, pics: Pictures) {
  const partners = STUDIO_PARTNERS.filter((p) => pics[p.key]);
  // the page is there for its pictures: with none of them embedded, or none of them drawn (below), there is no page
  if (partners.length === 0) return;
  const page = doc.addPage([W, H]);
  const pageIndex = doc.getPageCount() - 1;
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.night });

  const headA = 'WEBSITE AUDIT';
  const headB = ' · FREE EDITION';
  page.drawText(headA, { x: ML, y: H - 52, font: f.monoMed, size: MIN, color: C.onNight });
  page.drawText(headB, { x: ML + width(headA, { font: f.monoMed, size: MIN, color: C.onNight }), y: H - 52, font: f.mono, size: MIN, color: C.onNightDim });
  page.drawLine({ start: { x: ML, y: H - 62 }, end: { x: W - MR, y: H - 62 }, thickness: 0.75, color: C.nightLine });
  drawStripe(page);

  // the heading a phrase to a line
  let y = H - 112;
  const headSize = 44;
  for (const phrase of STUDIO_HEADING.toUpperCase().split(/(?<=,) /)) {
    for (const line of wrap([{ text: phrase, font: f.black, size: headSize, color: C.onNight }], CW)) {
      y -= headSize * 0.92;
      drawLine(page, line, ML, y);
    }
  }
  y -= 12;
  const lineSize = 14;
  const lh = lineSize * 1.4;
  for (const line of wrap([{ text: STUDIO_LINE, font: f.sans, size: lineSize, color: C.onNightDim }], CW)) {
    drawLine(page, line, ML, baselineOf(y, lh, lineSize));
    y -= lh;
  }

  // the portraits, side by side, each named under it
  const gap = 18;
  const colW = (CW - gap) / 2;
  const top = y - 24;
  let portraits = 0;
  partners.forEach((p, i) => {
    const image = pics[p.key]!;
    const x = ML + i * (colW + gap);
    const h = (colW * image.height) / image.width;
    if (!drawPicture(page, pics, p.key, { x, y: top - h, width: colW, height: h })) return;
    portraits += 1;
    let cy = top - h - 26;
    page.drawText(p.name.toUpperCase(), { x, y: cy, font: f.xbold, size: 22, color: C.onNight });
    cy -= 17;
    const label = AI_PARTNER_LABEL.toUpperCase();
    page.drawText(label, { x, y: cy, font: f.monoMed, size: MIN, color: C.gold });
    page.drawText(` · ${p.role.toUpperCase()}`, { x: x + width(label, { font: f.monoMed, size: MIN, color: C.gold }), y: cy, font: f.mono, size: MIN, color: C.onNightDim });
  });
  if (portraits === 0) {
    doc.removePage(pageIndex);
    return;
  }

  page.drawLine({ start: { x: ML, y: 52 }, end: { x: W - MR, y: 52 }, thickness: 0.75, color: C.nightLine });
  drawMark(page, f, ML, 36, pics, 'markGold', C.onNight);
  const site = 'enclavellc.net';
  page.drawText(site, { x: W - MR - width(site, { font: f.mono, size: MIN, color: C.onNightDim }), y: 36, font: f.mono, size: MIN, color: C.onNightDim });
}

// ---------- the document ----------
export async function generateAuditPdf(rawResults: AuditResults, options?: { userName?: string; screenshot?: PhoneShot }): Promise<Uint8Array> {
  const r = cleanDeep(rawResults);
  // capped like the emails, then cleaned
  const userName = printable(options?.userName?.slice(0, 100) ?? '').trim();
  const host = hostOf(r.websiteUrl);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = Object.fromEntries(
    await Promise.all((Object.keys(FONT_FILES) as FontKey[]).map(async (key) => [key, await doc.embedFont(fontFile(key), { subset: true })]))
  ) as Fonts;

  doc.setTitle(`Website audit: ${host}`);
  doc.setAuthor('Enclave');
  doc.setSubject('Free website audit');
  doc.setCreator('enclavellc.net');
  doc.setProducer('enclavellc.net audit');
  doc.setLanguage('en-US');
  const made = new Date(r.auditDate);
  if (!Number.isNaN(made.getTime())) {
    doc.setCreationDate(made);
    doc.setModificationDate(made);
  }

  const pics = await embedPictures(doc);
  drawCover(doc, fonts, pics, r, userName);
  const flow = new Flow(doc, fonts, host);
  drawShortVersion(flow, fonts, r);
  drawAreas(flow, fonts, r, await embedShot(doc, options?.screenshot));
  drawHowMade(flow, fonts, r);
  drawStudio(doc, fonts, pics);

  const total = doc.getPageCount();
  flow.pages.forEach((page, i) => drawFooter(page, fonts, pics, i + 2, total));
  return doc.save();
}
