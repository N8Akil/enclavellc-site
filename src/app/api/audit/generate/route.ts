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
    if (!urlValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_URL',
          message: urlValidation.error || 'Invalid URL format',
        },
        { status: 400 }
      );
    }

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
    console.log(`[Audit] Fetching content from ${websiteUrl}`);
    let websiteContent;
    try {
      websiteContent = await fetchWebsiteContent(websiteUrl);
    } catch (fetchError) {
      console.error('Website fetch error:', fetchError);
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
    console.log(`[Audit] Running AI analysis for ${websiteUrl}`);
    const auditResult = await runAudit(websiteContent, websiteUrl, {
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
    console.log(`[Audit] Generating document for ${websiteUrl}`);
    const document = await generateAuditDocument(auditResult as AuditResults, { userName });

    // Step 4: Send emails
    console.log(`[Audit] Sending emails for ${websiteUrl}`);
    const adminEmail = process.env.ADMIN_EMAIL || 'n.garrett@enclavellc.net';

    const emailResult = await sendAuditEmails({
      document,
      userEmail,
      userName,
      adminEmail,
      websiteUrl,
      auditResults: auditResult as AuditResults,
    });

    if (!emailResult.success) {
      console.error('Email sending failed:', emailResult.error);
      // Still return success to user since audit was generated
      // They can contact support if they don't receive the email
    }

    console.log(`[Audit] Completed successfully for ${websiteUrl}`);

    return NextResponse.json({
      success: true,
      message: `Your audit is being generated! Check ${userEmail} in 2-3 minutes.`,
      estimatedTime: '2-3 minutes',
    });

  } catch (error) {
    console.error('Audit API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Website Audit API',
    version: '1.0.0',
  });
}
