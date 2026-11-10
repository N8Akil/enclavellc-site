// src/lib/audit/send-emails.ts
import { escapeHtml } from '@/lib/email/escape';
import { getResendClient } from '@/lib/email/resend-client';
import { HOW_MADE_HEADING, areasReadPhrase, assessedCategories, evidenceLine, howMadeText, scoreLine } from './present';
import type { AuditResults } from './types';

interface SendEmailsOptions {
  document: Buffer;
  userEmail: string;
  userName?: string;
  adminEmail: string;
  websiteUrl: string;
  auditResults: AuditResults;
}

export interface SendEmailsResult {
  success: boolean;
  userSent: boolean;
  adminSent: boolean;
  error?: string;
}

export async function sendAuditEmails(options: SendEmailsOptions): Promise<SendEmailsResult> {
  const { document, userEmail, adminEmail, websiteUrl, auditResults } = options;
  const userName = options.userName?.slice(0, 100);

  const documentBase64 = document.toString('base64');
  const filename = `Website-Audit-${new URL(websiteUrl).hostname}-${new Date().toISOString().split('T')[0]}.docx`;

  const client = getResendClient();
  const attachments = [
    {
      filename,
      content: documentBase64,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
  ];

  // Resend returns { data, error } instead of throwing on API errors, so both results are checked.
  // The admin send is attempted even if the visitor's failed, so the lead still reaches the inbox.
  // Failures are reported as codes only: Resend's messages can echo the addresses.
  const failures: string[] = [];
  const attempt = async (who: 'user' | 'admin', send: () => ReturnType<typeof client.emails.send>): Promise<boolean> => {
    try {
      const { data, error } = await send();
      if (error) failures.push(`${who}: ${error.statusCode ?? '-'} ${error.name}`);
      else if (!data?.id) failures.push(`${who}: no id`);
      else return true;
    } catch (error) {
      failures.push(`${who}: threw ${error instanceof Error ? error.name : typeof error}`);
    }
    return false;
  };

  // Send to user
  const userSent = await attempt('user', () => client.emails.send({
    from: 'Enclave LLC <audits@enclavellc.net>',
    to: userEmail,
    subject: `Your Website Audit Report for ${websiteUrl} is Ready!`,
    html: generateUserEmailHtml(userName, websiteUrl, auditResults),
    attachments
  }));

  // Send admin notification
  const adminSent = await attempt('admin', () => client.emails.send({
    from: 'Enclave Audit System <audits@enclavellc.net>',
    to: adminEmail,
    subject: `New Audit Lead: ${websiteUrl}`,
    html: generateAdminEmailHtml(userEmail, userName, websiteUrl, auditResults),
    attachments
  }));

  return failures.length
    ? { success: false, userSent, adminSent, error: failures.join('; ') }
    : { success: true, userSent, adminSent };
}

function generateUserEmailHtml(
  userName: string | undefined,
  websiteUrl: string,
  auditResults: AuditResults
): string {
  // everything below comes from the visitor or from their site: escape it
  // (model text and quotes from the site are untrusted: nothing reaches the HTML unescaped)
  const topFindings = auditResults.criticalIssues.slice(0, 3).map(i =>
    `${escapeHtml(i.title)}<br><span style="color: #666666; font-size: 13px;">${escapeHtml(evidenceLine(i.evidence))}</span>`
  );
  // every area, with a score only where one was assessed
  const areaRows = auditResults.categories.map(c =>
    c.assessed
      ? `<li><strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(c.score)} of 10</li>`
      : `<li><strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(c.reason)}</li>`
  );
  const topStrengths = auditResults.topStrengths.slice(0, 2).map(s => escapeHtml(s.title));
  const name = escapeHtml(userName || 'there');
  const site = escapeHtml(websiteUrl);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Website Audit Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #1B4F72; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Your Website Audit is Ready!</h1>
            </td>
          </tr>

          <!-- Score Badge -->
          <tr>
            <td style="padding: 30px 40px; text-align: center;">
              <div style="display: inline-block; background-color: ${getScoreColor(auditResults.overallScore)}; color: white; font-size: 48px; font-weight: bold; padding: 20px 40px; border-radius: 8px;">
                ${auditResults.overallScore.toFixed(1)}/10
              </div>
              <p style="margin-top: 10px; color: #666666; font-size: 14px;">${escapeHtml(scoreLine(auditResults))}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6;">
                Hi ${name},
              </p>
              <p style="color: #333333; font-size: 16px; line-height: 1.6;">
                Great news! Your free website audit for <strong>${site}</strong> is complete.
              </p>

              ${topStrengths.length > 0 ? `
              <h3 style="color: #27AE60; margin-top: 25px;">✓ Top Strengths</h3>
              <ul style="color: #333333; font-size: 14px; line-height: 1.8;">
                ${topStrengths.map(s => `<li>${s}</li>`).join('')}
              </ul>
              ` : ''}

              ${topFindings.length > 0 ? `
              <h3 style="color: #C0392B; margin-top: 25px;">⚠ Priority Issues</h3>
              <ul style="color: #333333; font-size: 14px; line-height: 1.8;">
                ${topFindings.map(f => `<li>${f}</li>`).join('')}
              </ul>
              ` : ''}

              <h3 style="color: #333333; margin-top: 25px;">Area by area</h3>
              <ul style="color: #333333; font-size: 14px; line-height: 1.8;">
                ${areaRows.join('')}
              </ul>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 25px;">
                Your full audit report is attached to this email. It covers ${escapeHtml(areasReadPhrase(auditResults))}, with the evidence behind each finding, specific recommendations, and a prioritized action plan.
              </p>

              <p style="color: #666666; font-size: 13px; line-height: 1.6; margin-top: 25px;">
                <strong>${escapeHtml(HOW_MADE_HEADING)}.</strong> ${escapeHtml(howMadeText(auditResults))}
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 20px 40px 40px; text-align: center;">
              <a href="https://enclavellc.net/#contact" style="display: inline-block; background-color: #E67E22; color: #ffffff; text-decoration: none; padding: 15px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
                Schedule Free Consultation
              </a>
              <p style="margin-top: 15px; color: #666666; font-size: 12px;">
                Let's discuss your results and next steps
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #f8f8f8; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="margin: 0; color: #666666; font-size: 12px;">
                Enclave LLC | Professional Web Development<br>
                <a href="https://enclavellc.net" style="color: #2874A6;">enclavellc.net</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateAdminEmailHtml(
  userEmail: string,
  userName: string | undefined,
  websiteUrl: string,
  auditResults: AuditResults
): string {
  const { categories, overallScore, criticalIssues } = auditResults;

  // Find highest and lowest scoring categories, among the areas that were assessed
  const sortedCategories = assessedCategories(auditResults).sort((a, b) => b.score - a.score);
  const notAssessed = categories.filter(c => !c.assessed).map(c => c.name);
  const highest = sortedCategories[0];
  const lowest = sortedCategories[sortedCategories.length - 1];

  // everything below comes from the visitor or from their site: escape it
  const site = escapeHtml(websiteUrl);
  const email = escapeHtml(userEmail);
  const name = escapeHtml(userName || 'Not provided');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Audit Lead</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

    <tr>
      <td style="padding: 30px; background-color: #1B4F72; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; color: #ffffff; font-size: 20px;">🎯 New Website Audit Lead</h1>
      </td>
    </tr>

    <tr>
      <td style="padding: 30px;">
        <table role="presentation" style="width: 100%;">
          <tr>
            <td style="padding: 10px 0;">
              <strong>Website:</strong> <a href="${site}" style="color: #2874A6;">${site}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <strong>User Email:</strong> <a href="mailto:${email}" style="color: #2874A6;">${email}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <strong>User Name:</strong> ${name}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <strong>Overall Score:</strong>
              <span style="color: ${getScoreColor(overallScore)}; font-weight: bold; font-size: 18px;">
                ${overallScore.toFixed(1)}/10
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <strong>Generated:</strong> ${new Date().toLocaleString()}
            </td>
          </tr>
        </table>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">

        <h3 style="color: #333333; margin-bottom: 15px;">Quick Stats</h3>
        <ul style="color: #333333; font-size: 14px; line-height: 1.8; padding-left: 20px;">
          <li><strong>Highest Score:</strong> ${escapeHtml(highest?.name || 'N/A')} (${escapeHtml(highest?.score || 'N/A')})</li>
          <li><strong>Lowest Score:</strong> ${escapeHtml(lowest?.name || 'N/A')} (${escapeHtml(lowest?.score || 'N/A')})</li>
          <li><strong>Critical Issues:</strong> ${criticalIssues.length}</li>
          <li><strong>Score covers:</strong> ${escapeHtml(areasReadPhrase(auditResults))}</li>
          <li><strong>Not assessed:</strong> ${escapeHtml(notAssessed.join(', ') || 'none')}</li>
          <li><strong>Pages read:</strong> ${auditResults.pagesRead.length}</li>
          <li><strong>Findings removed (evidence did not check out):</strong> ${escapeHtml(auditResults.droppedFindings)}</li>
        </ul>

        <p style="color: #666666; font-size: 12px; margin-top: 25px;">
          Full audit report attached. Follow up within 24-48 hours for best conversion.
        </p>
      </td>
    </tr>

  </table>
</body>
</html>
  `.trim();
}

function getScoreColor(score: number): string {
  if (score >= 8) return '#27AE60';
  if (score >= 6) return '#F39C12';
  return '#C0392B';
}
