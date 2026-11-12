// src/lib/audit/queue.ts
// How many audits this process works on at once. An audit runs after its request has been answered, so nothing
// outside holds the work back: this does. At most QUEUE_MAX_RUNNING run, at most QUEUE_MAX_WAITING wait their
// turn, and a request that finds both full is not accepted (the route passes it on as a lead instead).
//
// In memory and PER PROCESS, like the limits: a restart forgets what was waiting (the admin already has each
// lead from the accept mail), and a PM2 cluster worker refuses outright, because every worker would otherwise
// keep its own count and the cap would multiply.
import cluster from 'node:cluster';
import { QUEUE_MAX_RUNNING, QUEUE_MAX_WAITING } from './config';

export interface AuditQueueOptions {
  maxRunning?: number;
  maxWaiting?: number;
  // true when this process is one of several workers sharing the port; injectable for tests
  isClusterWorker?: () => boolean;
}

export function createAuditQueue(options: AuditQueueOptions = {}) {
  const maxRunning = options.maxRunning ?? QUEUE_MAX_RUNNING;
  const maxWaiting = options.maxWaiting ?? QUEUE_MAX_WAITING;
  const isClusterWorker = options.isClusterWorker ?? (() => cluster.isWorker);
  // places taken: every reserved audit until it has finished, whether it is running or waiting
  let held = 0;
  let running = 0;
  const waiting: Array<() => void> = [];

  return {
    // Takes a place (to run now or to wait) and says whether there was one. A place that was taken MUST be
    // given back, by run() finishing or by release().
    reserve(): boolean {
      try {
        if (isClusterWorker()) return false;
        if (held >= maxRunning + maxWaiting) return false;
        held += 1;
        return true;
      } catch {
        // fail closed
        return false;
      }
    },
    // Gives back a place that will not be used after all (the request was not accepted).
    release(): void {
      held = Math.max(0, held - 1);
    },
    // Runs the work in a reserved place, waiting first if maxRunning audits are already running. Whatever the
    // work does (returns, throws), the place is given back and the next one waiting starts.
    async run<T>(work: () => Promise<T>): Promise<T> {
      // a finishing audit hands its running slot straight to the next in line, so nobody can slip in between
      if (running < maxRunning) running += 1;
      else await new Promise<void>((start) => waiting.push(start));
      try {
        return await work();
      } finally {
        held = Math.max(0, held - 1);
        const next = waiting.shift();
        if (next) next();
        else running -= 1;
      }
    },
    stats() {
      return { held, running, waiting: waiting.length };
    },
    // for tests
    reset() {
      held = 0;
      running = 0;
      waiting.length = 0;
    },
  };
}

// The one queue the route uses.
export const auditQueue = createAuditQueue();
