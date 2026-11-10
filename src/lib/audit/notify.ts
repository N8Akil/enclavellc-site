// src/lib/audit/notify.ts
// The short mails around an audit that runs in the background: "audit requested" to the admin when a request is
// accepted, and the two mails sent when an audit could not be finished. (The report mails are in send-emails.ts,
// the lead mail in preview.ts.) Failures come back as codes only: the provider's messages can echo the addresses.
import { escapeHtml } from '@/lib/email/escape';
import { getResendClient } from '@/lib/email/resend-client';
import type { Niche } from './config';

// What the visitor is told at once, and what they are told if the audit cannot be finished. No time is promised.
export const ACCEPT_MESSAGE = "We're on it. Your audit will be in your inbox shortly.";
export const FAILURE_MESSAGE = 'We could not finish your audit automatically. Nate has your request and will send it himself.';
export const ACCEPT_LINE = 'Audit requested. It is running now; you will get the result, or a second mail if it fails.';
export const FAILURE_LINE = 'An audit could not be finished automatically: run it by hand. The visitor has been told you will send it.';

export const nicheWords = (niche: Niche): string => (niche === 'home_care' ? 'home care agency' : 'general small business');

export interface Lead {
  userEmail: string;
  userName?: string;
  websiteUrl: string;
  niche: Niche;
  adminEmail: string;
}

type Sent = { sent: true } | { sent: false; error: string };

async function sendOne(who: 'admin' | 'user', mail: { from: string; to: string; subject: string; html: string }): Promise<Sent> {
  try {
    const { data, error } = await getResendClient().emails.send(mail);
    if (error) return { sent: false, error: `${who}: ${error.statusCode ?? '-'} ${error.name}` };
    if (!data?.id) return { sent: false, error: `${who}: no id` };
    return { sent: true };
  } catch (error) {
    return { sent: false, error: `${who}: threw ${error instanceof Error ? error.name : typeof error}` };
  }
}

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
// happened to the other.
export async function sendFailureMails(lead: Lead, code: string): Promise<{ userSent: boolean; adminSent: boolean; errors: string[] }> {
  const name = escapeHtml(lead.userName?.slice(0, 100) || 'there');
  const user = await sendOne('user', {
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
    html: leadHtml('Audit failed', FAILURE_LINE, lead, `\n  <p><strong>Failure code:</strong> ${escapeHtml(code)}</p>`),
  });
  return {
    userSent: user.sent,
    adminSent: admin.sent,
    errors: [user, admin].flatMap((result) => (result.sent ? [] : [result.error])),
  };
}
