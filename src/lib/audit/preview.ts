// src/lib/audit/preview.ts
// The preview gate. While the free audit is being rebuilt, only the addresses listed in AUDIT_PREVIEW_EMAILS
// (comma-separated) get the automated report. Everyone else's request becomes a lead for a person to run by hand.
// FAIL CLOSED: an unset or empty list means nobody gets the automated report.
// BEFORE THIS GATE IS REMOVED (ruled 2026-11-10, see docs/audit-system/RUNBOOK.md): a stop signal ends an audit in
// flight with no mail to anyone. On SIGTERM the admin must be mailed the audits in flight (address and URL) before
// exit, with a test. Until that exists the gate stays.
import { escapeHtml } from '@/lib/email/escape';
import type { Niche } from './config';
import { auditSetting } from './env';
import { sendMail } from './mail';
import { nicheWords } from './notify';

export const PREVIEW_MESSAGE =
  "Thanks. We're rebuilding the free audit this week, so Nate will run yours by hand and email it to you himself.";
export const PREVIEW_LEAD_LINE = 'Audit requested while the free audit is in preview: run it by hand.';
export const CEILING_LEAD_LINE = "Audit requested after today's audit limit was reached: run it by hand.";
export const QUEUE_LEAD_LINE = 'Audit requested while as many audits as this server runs at once were already under way: run it by hand.';

export function isPreviewEmail(email: string, list: string | undefined = auditSetting('AUDIT_PREVIEW_EMAILS')): boolean {
  try {
    const wanted = email.trim().toLowerCase();
    if (!wanted || typeof list !== 'string') return false;
    return list
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .includes(wanted);
  } catch {
    return false;
  }
}

// One email to the admin address with the lead. Returns a code on failure, never the provider's message
// (it can echo the addresses).
export async function sendPreviewLead(lead: {
  userEmail: string;
  userName?: string;
  websiteUrl: string;
  niche?: Niche;
  adminEmail: string;
  // why this is a lead and not a report; one of the fixed lines above
  line?: string;
}): Promise<{ sent: true } | { sent: false; error: string }> {
  // everything below comes from the visitor: escape it
  const site = escapeHtml(lead.websiteUrl);
  const email = escapeHtml(lead.userEmail);
  const name = escapeHtml(lead.userName?.slice(0, 100) || 'Not provided');
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Audit request</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; color: #333333;">
  <p><strong>${escapeHtml(lead.line ?? PREVIEW_LEAD_LINE)}</strong></p>
  <p><strong>Website:</strong> ${site}</p>
  <p><strong>Email:</strong> ${email}</p>
  <p><strong>Name:</strong> ${name}</p>
  <p><strong>Audit written for:</strong> ${escapeHtml(nicheWords(lead.niche ?? 'general'))}</p>
</body>
</html>`.trim();

  return sendMail('admin', {
    from: 'Enclave Audit System <audits@enclavellc.net>',
    to: lead.adminEmail,
    subject: 'Audit request to run by hand',
    html,
  });
}
