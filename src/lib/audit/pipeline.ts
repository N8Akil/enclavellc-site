// src/lib/audit/pipeline.ts
// One audit, start to finish, run AFTER its request has been answered. It never throws: whatever goes wrong, the
// process carries on, the visitor gets one honest mail and the admin gets one mail with a failure code.
// Log lines carry the request id, the stage and an error code. Never the visitor's details, the site or its text.
import type { Niche } from './config';
import { fetchWebsiteContent } from './fetch-website';
import { generateAuditPdf } from './generate-pdf';
import { sendFailureMails, type Lead } from './notify';
import { runAudit } from './run-audit';
import { sendAuditEmails } from './send-emails';
import type { AuditResults, Measurements } from './types';

export interface AuditJob extends Lead {
  requestId: string;
  businessType?: string;
  niche: Niche;
}

// Nothing in this repository measures a site yet. Until something is passed in, Speed is "not measured", there is
// no screenshot, and the model is offered neither the "measure" nor the "screen" kind of evidence.
export const notMeasured = async (): Promise<Measurements> => ({ ok: false, reason: 'not_configured' });

export interface PipelineDeps {
  fetchSite?: typeof fetchWebsiteContent;
  measure?: (siteUrl: string) => Promise<Measurements>;
  audit?: typeof runAudit;
  makeDocument?: typeof generateAuditPdf;
  sendReport?: typeof sendAuditEmails;
  sendFailure?: typeof sendFailureMails;
}

type Stage = 'fetch' | 'model' | 'document' | 'email';

// An error's class name and code (e.g. "UnsafeUrlError BLOCKED_ADDRESS"), never its message, which can carry the URL
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}

class StageFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'StageFailure';
    this.code = code;
  }
}

export async function runAuditJob(job: AuditJob, deps: PipelineDeps = {}): Promise<'sent' | 'failed'> {
  const tag = `[Audit] ${job.requestId}`;
  let stage: Stage = 'fetch';
  try {
    console.log(`${tag} fetching site`);
    const content = await (deps.fetchSite ?? fetchWebsiteContent)(job.websiteUrl);

    // a measurement that fails is not a failed audit: the report says what was not measured
    let measurements: Measurements;
    try {
      measurements = await (deps.measure ?? notMeasured)(job.websiteUrl);
    } catch {
      measurements = { ok: false, reason: 'failed' };
    }

    stage = 'model';
    console.log(`${tag} running analysis`);
    const result = await (deps.audit ?? runAudit)(
      content,
      job.websiteUrl,
      { businessType: job.businessType, niche: job.niche },
      { requestId: job.requestId, measurements }
    );
    if (!result.success) throw new StageFailure(result.error);

    stage = 'document';
    console.log(`${tag} generating document`);
    const document = await (deps.makeDocument ?? generateAuditPdf)(result as AuditResults, { userName: job.userName });

    stage = 'email';
    console.log(`${tag} sending emails`);
    const mail = await (deps.sendReport ?? sendAuditEmails)({
      document,
      userEmail: job.userEmail,
      userName: job.userName,
      adminEmail: job.adminEmail,
      websiteUrl: job.websiteUrl,
      auditResults: result as AuditResults,
    });
    if (!mail.success) console.error(`${tag} email failed: ${mail.error}`);
    // the audit ran but did not reach the visitor: that is a failed audit, and the admin is told
    if (!mail.userSent) throw new StageFailure('REPORT_NOT_SENT');

    console.log(`${tag} completed`);
    return 'sent';
  } catch (error) {
    const code = `${stage}: ${errorCode(error)}`;
    console.error(`${tag} failed at ${code}`);
    try {
      // Once the report mail to the visitor has been attempted, the visitor may have it (a send can fail or time out
      // after it was delivered), so they are sent nothing more: one audit never mails a visitor both a report and a
      // failure. The admin is told, in words that say so.
      const told =
        stage === 'email'
          ? await (deps.sendFailure ?? sendFailureMails)(job, code, { visitor: false })
          : await (deps.sendFailure ?? sendFailureMails)(job, code);
      for (const problem of told.errors) console.error(`${tag} failure mail not sent: ${problem}`);
    } catch (mailError) {
      console.error(`${tag} failure mails threw: ${errorCode(mailError)}`);
    }
    return 'failed';
  }
}
