// src/lib/audit/send-emails.ts
import { Resend } from 'resend';
import type { AuditResults } from './types';

// Lazy initialization to prevent build-time errors
let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

interface SendEmailsOptions {
  document: Buffer;
  userEmail: string;
  userName?: string;
  adminEmail: string;
  websiteUrl: string;
  auditResults: AuditResults;
}

export async function sendAuditEmails(options: SendEmailsOptions): Promise<{ success: boolean; error?: string }> {
  const { document, userEmail, userName, adminEmail, websiteUrl, auditResults } = options;

  const documentBase64 = document.toString('base64');
  const filename = `Website-Audit-${new URL(websiteUrl).hostname}-${new Date().toISOString().split('T')[0]}.docx`;

  try {
    const client = getResendClient();

    // Send to user
    await client.emails.send({
      from: 'Enclave LLC <audits@enclavellc.net>',
      to: userEmail,
      subject: `Your Website Audit Report for ${websiteUrl} is Ready!`,
      html: generateUserEmailHtml(userName, websiteUrl, auditResults),
      attachments: [
        {
          filename,
          content: documentBase64,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      ]
    });

    // Send admin notification
    await client.emails.send({
      from: 'Enclave Audit System <audits@enclavellc.net>',
      to: adminEmail,
      subject: `New Audit Lead: ${websiteUrl}`,
      html: generateAdminEmailHtml(userEmail, userName, websiteUrl, auditResults),
      attachments: [
        {
          filename,
          content: documentBase64,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      ]
    });

    return { success: true };
  } catch (error) {
    console.error('Email sending error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send emails'
    };
  }
}

function generateUserEmailHtml(
  userName: string | undefined,
  websiteUrl: string,
  auditResults: AuditResults
): string {
  const topFindings = auditResults.criticalIssues.slice(0, 3).map(i => i.title);
  const topStrengths = auditResults.topStrengths.slice(0, 2).map(s => s.title);

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
              <p style="margin-top: 10px; color: #666666; font-size: 14px;">Overall Score</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6;">
                Hi ${userName || 'there'},
              </p>
              <p style="color: #333333; font-size: 16px; line-height: 1.6;">
                Great news! Your free website audit for <strong>${websiteUrl}</strong> is complete.
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

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 25px;">
                Your full audit report is attached to this email. It includes detailed analysis across 8 key areas, specific recommendations, and a prioritized action plan.
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

  // Find highest and lowest scoring categories
  const sortedCategories = [...categories].sort((a, b) => b.score - a.score);
  const highest = sortedCategories[0];
  const lowest = sortedCategories[sortedCategories.length - 1];

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
              <strong>Website:</strong> <a href="${websiteUrl}" style="color: #2874A6;">${websiteUrl}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <strong>User Email:</strong> <a href="mailto:${userEmail}" style="color: #2874A6;">${userEmail}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <strong>User Name:</strong> ${userName || 'Not provided'}
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
          <li><strong>Highest Score:</strong> ${highest?.name || 'N/A'} (${highest?.score || 'N/A'})</li>
          <li><strong>Lowest Score:</strong> ${lowest?.name || 'N/A'} (${lowest?.score || 'N/A'})</li>
          <li><strong>Critical Issues:</strong> ${criticalIssues.length}</li>
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
