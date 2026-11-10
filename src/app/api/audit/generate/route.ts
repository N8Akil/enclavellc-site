// src/app/api/audit/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scheduleAfterResponse } from '@/lib/audit/background';
import { NICHES } from '@/lib/audit/config';
import { validateUrl } from '@/lib/audit/fetch-website';
import { auditLimiter, CEILING_LEAD_MESSAGE, clientIp, RATE_LIMIT_MESSAGES } from '@/lib/audit/limits';
import { ACCEPT_MESSAGE, sendAcceptMail } from '@/lib/audit/notify';
import { runAuditJob } from '@/lib/audit/pipeline';
import {
  CEILING_LEAD_LINE,
  isPreviewEmail,
  PREVIEW_LEAD_LINE,
  PREVIEW_MESSAGE,
  QUEUE_LEAD_LINE,
  sendPreviewLead,
} from '@/lib/audit/preview';
import { auditQueue } from '@/lib/audit/queue';

// Input validation schema
const auditRequestSchema = z.object({
  websiteUrl: z.string().min(1, 'Website URL is required'),
  userEmail: z.string().email('Valid email is required'),
  userName: z.string().optional(),
  businessType: z.string().optional(),
  // who the audit is written for; left out means "general", anything else is refused
  niche: z.enum(NICHES, { message: 'Unknown audit type' }).default('general'),
});

const CONFIG_ERROR_MESSAGE = 'Service temporarily unavailable. Please contact n.garrett@enclavellc.net or try again later.';
const NOT_PASSED_ON_MESSAGE = 'We could not pass your request on. Please contact n.garrett@enclavellc.net.';

// The order, which is the point of this file:
//   validate the body -> URL rules -> limits (counted) -> preview gate -> ACCEPT.
// At accept, before any work: one "audit requested" mail to the admin, then the visitor is answered at once (202).
// The audit itself (pages, model, document, mails) runs after the response, in this same process, at most two at a
// time. Stated limit: a restart loses audits in flight; the visitor then hears nothing more, but the admin already
// has the lead from the accept mail.
export async function POST(request: NextRequest) {
  // failure logs carry this id and a code, never the visitor's details
  const requestId = crypto.randomUUID().slice(0, 8);

  // What this request holds until its audit is admitted: one of the day's audit slots and a place in the queue.
  // An audit that is NOT admitted (it becomes a lead, it fails, or something throws) gives back whatever it holds,
  // so no slot and no place is ever left taken with no audit behind it. Once the work is handed to the queue, the
  // queue gives the place back when the audit ends; the slot stays spent.
  let holdsSlot = false;
  let holdsPlace = false;
  const giveBack = () => {
    if (holdsPlace) {
      holdsPlace = false;
      auditQueue.release();
    }
    if (holdsSlot) {
      holdsSlot = false;
      auditLimiter.returnAuditSlot();
    }
  };

  try {
    // Parse request body
    const body = await request.json();

    // Validate input
    const validationResult = auditRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'VALIDATION_ERROR',
          message: validationResult.error.issues[0]?.message || 'Invalid input',
        },
        { status: 400 }
      );
    }

    const { websiteUrl, userEmail, userName, businessType, niche } = validationResult.data;

    // Validate URL format
    const urlValidation = validateUrl(websiteUrl);
    if (!urlValidation.valid || !urlValidation.url) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_URL',
          message: urlValidation.error || 'Invalid URL format',
        },
        { status: 400 }
      );
    }
    // from here on only the server's normalised URL is used, and it is never logged
    const siteUrl = urlValidation.url;
    const adminEmail = process.env.ADMIN_EMAIL || 'n.garrett@enclavellc.net';

    // Limits come BEFORE anything that costs: no page is requested and no model is called for a refused
    // request. An allowed attempt is counted here against the per-person and hourly limits, so a request that fails
    // later still used its turn. Those limits apply to every request. The day's AUDIT ceiling is taken only by a
    // request that would actually run an audit (an address on the preview list), and that slot is given back
    // (giveBack) if the audit is not admitted after all: a lead, including one made because the queue is full, spends none.
    const listed = isPreviewEmail(userEmail);
    const limit = auditLimiter.check(clientIp(request.headers), userEmail, { audit: listed });
    // an allowed check of a listed address took one of the day's audit slots; it is given back unless the audit is admitted
    holdsSlot = listed && limit.allowed;
    // the audit ceiling is used up (or the limiter failed closed): the request becomes a lead, below
    const ceilingHit = !limit.allowed && limit.cause === 'daily';
    if (!limit.allowed && !ceilingHit) {
      // the cause is a fixed word; nothing about the caller is logged
      console.warn(`[Audit] ${requestId} rate limited: ${limit.cause}`);
      return NextResponse.json(
        {
          success: false,
          error: 'RATE_LIMITED',
          message: RATE_LIMIT_MESSAGES[limit.cause],
        },
        {
          status: 429,
          headers: limit.retryAfterSeconds ? { 'Retry-After': String(limit.retryAfterSeconds) } : undefined,
        }
      );
    }
    const retryAfter = !limit.allowed && limit.retryAfterSeconds ? { 'Retry-After': String(limit.retryAfterSeconds) } : undefined;

    const configMissing = (name: string) => {
      giveBack();
      console.error(`[Audit] ${requestId} config missing: ${name}`);
      return NextResponse.json({ success: false, error: 'CONFIG_ERROR', message: CONFIG_ERROR_MESSAGE, requestId }, { status: 500 });
    };

    // Why this request will NOT be run automatically, if it will not:
    //   preview  the address is not on the preview list (an unset or empty list means nobody is)
    //   ceiling  a listed address, but today's audit ceiling is used up
    //   queue    a listed address, but as many audits as this process takes on are already running and waiting
    // In each case nothing automated runs: no page is requested, no model is called, no document is made. The
    // request becomes a lead for a person to run by hand. That path needs the email key only.
    let leadReason: 'preview' | 'ceiling' | 'queue' | null = !listed ? 'preview' : ceilingHit ? 'ceiling' : null;

    if (!leadReason) {
      // a request that will be run needs both keys before it is accepted
      if (!process.env.ANTHROPIC_API_KEY) return configMissing('ANTHROPIC_API_KEY');
      if (!process.env.RESEND_API_KEY) return configMissing('RESEND_API_KEY');
      // a place to run or to wait; none left (or a cluster worker): the request is passed on as a lead
      if (auditQueue.reserve()) holdsPlace = true;
      else leadReason = 'queue';
    }

    if (leadReason) {
      // a lead is not an audit: it spends none of the day's audit slots (a queue lead gives back the one it took)
      giveBack();
      // lead emails have their own daily cap (limits.ts takeLead), so the form cannot flood an inbox
      if (!auditLimiter.takeLead()) {
        console.warn(`[Audit] ${requestId} rate limited: lead cap`);
        return NextResponse.json(
          { success: false, error: 'RATE_LIMITED', message: RATE_LIMIT_MESSAGES.daily },
          { status: 429, headers: retryAfter }
        );
      }
      if (!process.env.RESEND_API_KEY) return configMissing('RESEND_API_KEY');
      console.log(`[Audit] ${requestId} ${leadReason}: sending lead`);
      const lead = await sendPreviewLead({
        userEmail,
        userName,
        websiteUrl: siteUrl,
        niche,
        line: leadReason === 'ceiling' ? CEILING_LEAD_LINE : leadReason === 'queue' ? QUEUE_LEAD_LINE : PREVIEW_LEAD_LINE,
        adminEmail,
      });
      if (!lead.sent) {
        // nobody knows the visitor asked: say so, and give them the address
        console.error(`[Audit] ${requestId} preview lead failed: ${lead.error}`);
        return NextResponse.json({ success: false, error: 'EMAIL_FAILED', message: NOT_PASSED_ON_MESSAGE, requestId }, { status: 502 });
      }
      if (leadReason === 'ceiling') {
        // not run today, and the visitor is told so; the lead is with a person, so they need do nothing more
        console.warn(`[Audit] ${requestId} rate limited: daily (lead passed on)`);
        return NextResponse.json(
          { success: false, error: 'RATE_LIMITED', leadSent: true, message: CEILING_LEAD_MESSAGE },
          { status: 429, headers: retryAfter }
        );
      }
      return NextResponse.json({ success: true, preview: true, message: PREVIEW_MESSAGE }, { status: 202 });
    }

    // ACCEPT. First the admin is told who asked: after this point the audit lives only in this process's memory,
    // and if it is lost the lead must not be. If that mail cannot be sent the request is NOT accepted, because
    // then nobody would know the visitor asked.
    const lead = { userEmail, userName, websiteUrl: siteUrl, niche, adminEmail };
    const told = await sendAcceptMail(lead);
    if (!told.sent) {
      giveBack();
      console.error(`[Audit] ${requestId} accept mail failed: ${told.error}`);
      return NextResponse.json({ success: false, error: 'EMAIL_FAILED', message: NOT_PASSED_ON_MESSAGE, requestId }, { status: 502 });
    }

    // The work, after the response. runAuditJob never throws; the queue gives the place back whatever happens.
    console.log(`[Audit] ${requestId} accepted`);
    scheduleAfterResponse(async () => {
      await auditQueue.run(() => runAuditJob({ ...lead, requestId, businessType }));
    });
    // admitted: the place is now the queue's to give back, and the slot is spent
    holdsPlace = false;
    holdsSlot = false;

    // answered at once, with no time promised
    return NextResponse.json({ success: true, accepted: true, message: ACCEPT_MESSAGE }, { status: 202 });
  } catch (error) {
    giveBack();
    console.error(`[Audit] ${requestId} error: ${errorCode(error)}`);
    return NextResponse.json(
      {
        success: false,
        error: 'SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
        requestId,
      },
      { status: 500 }
    );
  }
}

// An error's class name and code (e.g. "TypeError ERR_INVALID_URL"), never its message, which can carry the URL or address
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Website Audit API',
    version: '3.0.0',
  });
}
