// src/app/api/audit/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchWebsiteContent, validateUrl } from '@/lib/audit/fetch-website';
import { runAudit } from '@/lib/audit/run-audit';
import { generateAuditDocument } from '@/lib/audit/generate-document';
import { sendAuditEmails } from '@/lib/audit/send-emails';
import type { AuditResults } from '@/lib/audit/types';

// Input validation schema
const auditRequestSchema = z.object({
  websiteUrl: z.string().min(1, 'Website URL is required'),
  userEmail: z.string().email('Valid email is required'),
  userName: z.string().optional(),
  businessType: z.string().optional(),
  priorityAreas: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  // failure logs carry this id and a code, never the visitor's details
  const requestId = crypto.randomUUID().slice(0, 8);

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

    const { websiteUrl, userEmail, userName, businessType, priorityAreas } = validationResult.data;

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

    // Check for required environment variables
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Missing ANTHROPIC_API_KEY');
      return NextResponse.json(
        {
          success: false,
          error: 'CONFIG_ERROR',
          message: 'Service temporarily unavailable. Please try again later.',
        },
        { status: 500 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('Missing RESEND_API_KEY');
      return NextResponse.json(
        {
          success: false,
          error: 'CONFIG_ERROR',
          message: 'Service temporarily unavailable. Please try again later.',
        },
        { status: 500 }
      );
    }

    // Step 1: Fetch website content
    console.log(`[Audit] ${requestId} fetching site`);
    let websiteContent;
    try {
      websiteContent = await fetchWebsiteContent(siteUrl);
    } catch (fetchError) {
      console.error(`[Audit] ${requestId} fetch failed: ${errorCode(fetchError)}`);
      return NextResponse.json(
        {
          success: false,
          error: 'FETCH_FAILED',
          message: 'Unable to access the website. Please verify the URL is correct and the site is publicly accessible.',
        },
        { status: 400 }
      );
    }

    // Step 2: Run AI audit
    console.log(`[Audit] ${requestId} running analysis`);
    const auditResult = await runAudit(websiteContent, siteUrl, {
      businessType,
      priorityAreas,
    });

    if (!auditResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'AUDIT_FAILED',
          message: 'Failed to generate audit analysis. Please try again.',
        },
        { status: 500 }
      );
    }

    // Step 3: Generate document
    console.log(`[Audit] ${requestId} generating document`);
    const document = await generateAuditDocument(auditResult as AuditResults, { userName });

    // Step 4: Send emails
    console.log(`[Audit] ${requestId} sending emails`);
    const adminEmail = process.env.ADMIN_EMAIL || 'n.garrett@enclavellc.net';

    const emailResult = await sendAuditEmails({
      document,
      userEmail,
      userName,
      adminEmail,
      websiteUrl: siteUrl,
      auditResults: auditResult as AuditResults,
    });

    if (!emailResult.success) {
      // log only codes and the request id
      console.error(`[Audit] ${requestId} email failed: ${emailResult.error}`);
    }

    if (!emailResult.userSent) {
      // the audit ran but did not reach the visitor: say so
      return NextResponse.json(
        {
          success: false,
          error: 'EMAIL_FAILED',
          message: 'Your audit ran but we could not email it. Please contact n.garrett@enclavellc.net.',
          requestId,
        },
        { status: 502 }
      );
    }

    console.log(`[Audit] ${requestId} completed`);

    return NextResponse.json({
      success: true,
      message: `Your audit has been emailed to ${userEmail}. Check your inbox in 2-3 minutes.`,
      estimatedTime: '2-3 minutes',
    });

  } catch (error) {
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
    version: '1.0.0',
  });
}
