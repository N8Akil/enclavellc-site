// src/lib/audit/background.ts
// Work that runs after the visitor has been answered. In production this is Next's `after`: the response goes
// out, then the work runs in the same process. Tests swap it for a function that runs (or holds) the work
// themselves, so they can see what happens before, between and after.
import { after } from 'next/server';

export type RunLater = (work: () => Promise<void>) => void;

const viaNext: RunLater = (work) => after(work);
let runLater: RunLater = viaNext;

export function scheduleAfterResponse(work: () => Promise<void>): void {
  runLater(work);
}

// For tests only. Pass nothing to put Next's `after` back.
export function setRunLater(replacement?: RunLater): void {
  runLater = replacement ?? viaNext;
}
