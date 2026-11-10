// src/lib/audit/notify.ts
// The short mails around an audit that runs in the background: "audit requested" to the admin when a request is
// accepted, and the two mails sent when an audit could not be finished. (The report mails are in send-emails.ts,
// the lead mail in preview.ts.) Failures come back as codes only: the provider's messages can echo the addresses.
import { escapeHtml } from '@/lib/email/escape';
import type { Niche } from './config';
import { sendMail, type Mail } from './mail';

// What the visitor is told at once, and what they are told if the audit cannot be finished. No time is promised.
export const ACCEPT_MESSAGE = "We're on it. Your audit will be in your inbox shortly.";
export const FAILURE_MESSAGE = 'We could not finish your audit automatically. Nate has your request and will send it himself.';
export const ACCEPT_LINE = 'Audit requested. It is running now; you will get the result, or a second mail if it fails.';
export const FAILURE_LINE = 'An audit could not be finished automatically: run it by hand. The visitor has been told you will send it.';
// when the report mail to the visitor was attempted and not confirmed: they may have it, so they are told nothing
export const REPORT_UNCONFIRMED_LINE =
  'An audit finished, but its report mail to the visitor was not confirmed (it may or may not have arrived). The visitor has NOT been told anything: check with them, and send the report by hand if they do not have it.';
// the request was accepted (the accept mail went out) but its work could not be started
export const NOT_STARTED_CODE = 'start: accepted, then could not be started';

export const nicheWords = (niche: Niche): string => (niche === 'home_care' ? 'home care agency' : 'general small business');

export interface Lead {
  userEmail: string;
  userName?: string;
  websiteUrl: string;
  niche: Niche;
  adminEmail: string;
}

type Sent = { sent: true } | { sent: false; error: string };

// one send, with the time limit of sendMail
const sendOne = (who: 'admin' | 'user', mail: Mail): Promise<Sent> => sendMail(who, mail);

// The lead as the admin reads it. Everything in it comes from the visitor: escaped, and the address is text, not a link.
function leadHtml(title: string, line: string, lead: Lead, extra = ''): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; color: #333333;">
  <p><strong>${escapeHtml(line)}</strong></p>
  <p><strong>Website:</strong> ${escapeHtml(lead.websiteUrl)}</p>
  <p><strong>Email:</strong> ${escapeHtml(lead.userEmail)}</p>
  <p><strong>Name:</strong> ${escapeHtml(lead.userName?.slice(0, 100) || 'Not provided')}</p>
  <p><strong>Audit written for:</strong> ${escapeHtml(nicheWords(lead.niche))}</p>${extra}
</body>
</html>`.trim();
}

// Sent BEFORE the visitor is answered and before any work: if the audit is lost later (a restart), the admin
// still knows who asked.
export function sendAcceptMail(lead: Lead): Promise<Sent> {
  return sendOne('admin', {
    from: 'Enclave Audit System <audits@enclavellc.net>',
    to: lead.adminEmail,
    subject: 'Audit requested',
    html: leadHtml('Audit requested', ACCEPT_LINE, lead),
  });
}

// One honest mail to the visitor and one to the admin with the failure code. Each is attempted whatever
// happened to the other. With visitor: false (the report mail to the visitor was already attempted, so they may
// have it) only the admin is written to, and told that the visitor was told nothing: one audit never sends the
// visitor both a report and a failure mail.
export async function sendFailureMails(
  lead: Lead,
  code: string,
  options: { visitor?: boolean } = {}
): Promise<{ userSent: boolean; adminSent: boolean; errors: string[] }> {
  const toVisitor = options.visitor !== false;
  const name = escapeHtml(lead.userName?.slice(0, 100) || 'there');
  const user: Sent = !toVisitor ? { sent: false, error: 'user: not sent (report mail already attempted)' } : await sendOne('user', {
    from: 'Enclave LLC <audits@enclavellc.net>',
    to: lead.userEmail,
    subject: 'About your website audit',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>About your website audit</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; color: #333333; font-size: 16px; line-height: 1.6;">
  <p>Hi ${name},</p>
  <p>${escapeHtml(FAILURE_MESSAGE)}</p>
  <p>Enclave LLC</p>
</body>
</html>`.trim(),
  });
  const admin = await sendOne('admin', {
    from: 'Enclave Audit System <audits@enclavellc.net>',
    to: lead.adminEmail,
    subject: 'Audit failed: run it by hand',
    html: leadHtml('Audit failed', toVisitor ? FAILURE_LINE : REPORT_UNCONFIRMED_LINE, lead, `\n  <p><strong>Failure code:</strong> ${escapeHtml(code)}</p>`),
  });
  return {
    userSent: user.sent,
    adminSent: admin.sent,
    errors: (toVisitor ? [user, admin] : [admin]).flatMap((result) => (result.sent ? [] : [result.error])),
  };
}
