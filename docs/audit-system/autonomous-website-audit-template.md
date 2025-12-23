# Autonomous Website Audit System Template

## Overview

This template enables autonomous website audit generation triggered by a single URL input. The system fetches the target website, performs comprehensive analysis, generates a professional audit document, and delivers it via email.

---

## System Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Input    │────▶│  Audit Engine    │────▶│  Document Gen   │
│  (URL + Email)  │     │  (AI Analysis)   │     │  (.docx/.pdf)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │
                        │  Email Service   │◀─────────────┘
                        │ (Resend/SendGrid)│
                        └────────┬─────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌──────────────┐          ┌──────────────┐
            │ User Email   │          │ Admin Email  │
            │              │          │ (Enclave)    │
            └──────────────┘          └──────────────┘
```

---

## Input Schema

```typescript
interface AuditRequest {
  websiteUrl: string;        // Required: URL to audit (validated)
  userEmail: string;         // Required: Recipient email for audit
  userName?: string;         // Optional: For personalization
  businessType?: string;     // Optional: For contextual analysis
  priorityAreas?: string[];  // Optional: Focus areas (e.g., ["SEO", "Mobile"])
}
```

---

## System Prompt for AI Audit Engine

```
<system_prompt>
You are an autonomous Website Audit Specialist for Enclave LLC, a professional web development agency. You perform comprehensive website audits and generate professional reports without human intervention.

<identity>
- Company: Enclave LLC (enclavellc.net)
- Role: Automated Website Audit System
- Output: Professional audit document with actionable recommendations
</identity>

<input>
You will receive:
- website_url: The URL of the website to audit
- user_email: The email to send the completed audit
- user_name: (Optional) Name for personalization
- business_type: (Optional) Industry context
- priority_areas: (Optional) Specific focus areas
</input>

<audit_framework>
Analyze the website across these dimensions, assigning a score (1-10) and status for each:

1. VISUAL DESIGN & BRANDING
   - Logo quality and placement
   - Color palette consistency and psychology
   - Typography hierarchy and readability
   - Imagery quality and relevance
   - Overall aesthetic and professionalism
   - White space and visual balance

2. USER EXPERIENCE (UX)
   - Navigation clarity and structure
   - Information architecture
   - Call-to-action effectiveness
   - User flow and conversion paths
   - Form usability
   - Error handling and feedback

3. MOBILE RESPONSIVENESS
   - Responsive breakpoints
   - Touch target sizes (minimum 48px)
   - Mobile navigation patterns
   - Content prioritization on mobile
   - Font scaling and readability
   - Mobile-specific features (click-to-call, etc.)

4. CONTENT QUALITY
   - Clarity and readability (Flesch-Kincaid)
   - Value proposition communication
   - Trust signals (testimonials, credentials)
   - Content freshness and relevance
   - Spelling and grammar
   - Tone consistency

5. SEO FUNDAMENTALS
   - Title tags and meta descriptions
   - Heading hierarchy (H1-H6)
   - Image alt text
   - URL structure
   - Internal linking
   - Structured data/Schema.org

6. PERFORMANCE (Estimated)
   - Page load indicators
   - Image optimization
   - Code efficiency signals
   - Third-party script impact
   - Caching indicators

7. ACCESSIBILITY (WCAG 2.2)
   - Color contrast compliance
   - Keyboard navigation
   - Screen reader compatibility
   - Form labels and ARIA
   - Focus states visibility

8. SECURITY & TRUST
   - HTTPS implementation
   - Privacy policy presence
   - Contact information visibility
   - Trust badges/certifications
   - Form security indicators
</audit_framework>

<scoring_system>
For each category, assign:
- Score: 1-10 (10 = excellent)
- Status: Critical | Needs Improvement | Good | Excellent
- Top 3 specific issues found
- Top 3 actionable recommendations

Overall Score = Weighted average:
- Visual Design: 15%
- UX: 20%
- Mobile: 15%
- Content: 15%
- SEO: 15%
- Performance: 10%
- Accessibility: 5%
- Security: 5%
</scoring_system>

<output_requirements>
Generate a professional audit document containing:

1. COVER PAGE
   - "Website Audit Report" title
   - Audited URL
   - Date generated
   - "Prepared by Enclave LLC"
   - Overall score prominently displayed

2. EXECUTIVE SUMMARY
   - Overall score with visual indicator
   - Top 3 strengths
   - Top 3 critical issues
   - Recommended priority actions

3. DETAILED ANALYSIS
   - Each category with:
     - Score and status
     - What we found (specific observations)
     - Why it matters (business impact)
     - How to fix it (actionable steps)

4. PRIORITIZED ACTION PLAN
   - Quick wins (< 1 week)
   - Short-term improvements (1-4 weeks)
   - Strategic enhancements (1-3 months)

5. COMPETITIVE CONTEXT
   - How the site compares to industry standards
   - Opportunities for differentiation

6. NEXT STEPS WITH ENCLAVE LLC
   - Brief service introduction
   - Consultation offer
   - Contact information
</output_requirements>

<execution_rules>
1. AUTONOMOUS OPERATION: Complete the entire audit without requesting clarification. Make reasonable assumptions when data is ambiguous.

2. EVIDENCE-BASED: Only report what you can verify from the fetched content. Use phrases like "based on visible elements" or "from available content" when appropriate.

3. PROFESSIONAL TONE: Write for business owners and decision-makers. Avoid jargon; explain technical concepts simply.

4. ACTIONABLE FOCUS: Every issue identified must have a corresponding recommendation. Prioritize by business impact.

5. BALANCED ASSESSMENT: Highlight strengths alongside weaknesses. Be constructive, not critical.

6. DISCLAIMER: Include a note that this is an automated analysis and a comprehensive audit may reveal additional findings.

7. ERROR HANDLING: If the website cannot be fetched or analyzed:
   - Return an error report explaining the issue
   - Suggest the user verify the URL
   - Offer to retry or contact support
</execution_rules>

<branding>
Document styling:
- Primary Color: Use professional blue (#1B4F72) for headers
- Secondary Color: (#2874A6) for subheaders
- Accent: (#E67E22) for highlights and CTAs
- Font: Arial throughout
- Include Enclave LLC branding in header/footer
</branding>
</system_prompt>
```

---

## API Endpoint Specification

```typescript
// POST /api/audit/generate
// Content-Type: application/json

// Request Body
{
  "websiteUrl": "https://example.com",
  "userEmail": "user@example.com",
  "userName": "John Smith",           // optional
  "businessType": "healthcare",       // optional
  "priorityAreas": ["mobile", "seo"]  // optional
}

// Response (Success)
{
  "success": true,
  "auditId": "aud_abc123xyz",
  "status": "processing",
  "estimatedTime": "2-3 minutes",
  "message": "Your audit is being generated. You will receive it at user@example.com"
}

// Response (Error)
{
  "success": false,
  "error": "INVALID_URL",
  "message": "The provided URL could not be accessed. Please verify and try again."
}
```

---

## Processing Pipeline

```typescript
// Pseudocode for the audit pipeline

async function processAuditRequest(request: AuditRequest): Promise<void> {
  const auditId = generateAuditId();
  
  try {
    // Step 1: Validate and normalize URL
    const normalizedUrl = validateAndNormalizeUrl(request.websiteUrl);
    
    // Step 2: Fetch website content
    const siteContent = await fetchWebsiteContent(normalizedUrl);
    // Fetch: homepage, about, contact, services (if discoverable)
    
    // Step 3: Run AI analysis
    const auditResults = await runAIAudit({
      content: siteContent,
      url: normalizedUrl,
      businessType: request.businessType,
      priorityAreas: request.priorityAreas
    });
    
    // Step 4: Generate document
    const document = await generateAuditDocument(auditResults, {
      websiteUrl: normalizedUrl,
      userName: request.userName,
      generatedDate: new Date()
    });
    
    // Step 5: Send emails
    await sendAuditEmails({
      document,
      userEmail: request.userEmail,
      userName: request.userName,
      adminEmail: process.env.ADMIN_EMAIL, // Your email
      websiteUrl: normalizedUrl
    });
    
    // Step 6: Log for analytics
    await logAuditCompletion(auditId, normalizedUrl, request.userEmail);
    
  } catch (error) {
    await handleAuditError(auditId, error, request.userEmail);
  }
}
```

---

## Document Generation Template (docx)

```javascript
// audit-document-generator.js
// This generates the .docx audit report

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat, HeadingLevel, 
        BorderStyle, WidthType, ShadingType, PageNumber, PageBreak } = require('docx');

function generateAuditDocument(auditData) {
  const { 
    websiteUrl, 
    overallScore, 
    categories, 
    strengths, 
    criticalIssues,
    actionPlan,
    generatedDate,
    userName 
  } = auditData;

  // Color constants
  const PRIMARY = "1B4F72";
  const SECONDARY = "2874A6";
  const ACCENT = "E67E22";
  const SUCCESS = "27AE60";
  const WARNING = "F39C12";
  const DANGER = "C0392B";

  // Helper: Get score color
  const getScoreColor = (score) => {
    if (score >= 8) return SUCCESS;
    if (score >= 6) return WARNING;
    return DANGER;
  };

  // Helper: Get status color
  const getStatusColor = (status) => {
    const colors = {
      'Excellent': SUCCESS,
      'Good': SUCCESS,
      'Needs Improvement': WARNING,
      'Critical': DANGER
    };
    return colors[status] || "000000";
  };

  // Table styling
  const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };
  const headerShading = { fill: PRIMARY, type: ShadingType.CLEAR };

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", 
          run: { size: 56, bold: true, color: PRIMARY, font: "Arial" }, 
          paragraph: { spacing: { before: 0, after: 240 }, alignment: AlignmentType.CENTER } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 32, bold: true, color: PRIMARY, font: "Arial" }, 
          paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, color: SECONDARY, font: "Arial" }, 
          paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, color: "34495E", font: "Arial" }, 
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
      ]
    },
    numbering: {
      config: [
        { reference: "bullet-list", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", 
          alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbered-list", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", 
          alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ]
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { 
        default: new Header({ 
          children: [new Paragraph({ 
            alignment: AlignmentType.RIGHT, 
            children: [new TextRun({ text: "Website Audit Report | Enclave LLC", italics: true, size: 18, color: "666666" })] 
          })] 
        }) 
      },
      footers: { 
        default: new Footer({ 
          children: [new Paragraph({ 
            alignment: AlignmentType.CENTER, 
            children: [
              new TextRun({ text: "Page ", size: 18 }), 
              new TextRun({ children: [PageNumber.CURRENT], size: 18 }), 
              new TextRun({ text: " | enclavellc.net | ", size: 18 }),
              new TextRun({ text: "Free Consultation: (XXX) XXX-XXXX", size: 18, color: SECONDARY })
            ] 
          })] 
        }) 
      },
      children: [
        // === COVER PAGE ===
        new Paragraph({ spacing: { before: 1800 } }),
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("WEBSITE AUDIT REPORT")] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, 
          children: [new TextRun({ text: websiteUrl, size: 28, color: SECONDARY })] }),
        
        // Overall Score Display
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480 }, 
          children: [new TextRun({ text: "OVERALL SCORE", size: 24, bold: true, color: "666666" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, 
          children: [new TextRun({ text: `${overallScore}/10`, size: 72, bold: true, color: getScoreColor(overallScore) })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, 
          children: [new TextRun({ text: getScoreLabel(overallScore), size: 28, color: getScoreColor(overallScore) })] }),
        
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 960 }, 
          children: [new TextRun({ text: `Prepared for: ${userName || 'Website Owner'}`, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, 
          children: [new TextRun({ text: `Generated: ${formatDate(generatedDate)}`, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, 
          children: [new TextRun({ text: "Prepared by Enclave LLC", size: 24, bold: true, color: PRIMARY })] }),
        
        new Paragraph({ children: [new PageBreak()] }),

        // === EXECUTIVE SUMMARY ===
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Executive Summary")] }),
        new Paragraph({ spacing: { after: 200 }, 
          children: [new TextRun(`This automated audit analyzed ${websiteUrl} across 8 key dimensions including visual design, user experience, mobile responsiveness, content quality, SEO, performance, accessibility, and security.`)] }),
        
        // Score Summary Table
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Score Breakdown")] }),
        generateScoreTable(categories, cellBorders, headerShading),
        
        // Top Strengths
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Top Strengths")] }),
        ...strengths.map(s => new Paragraph({ 
          numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun({ text: s.title + ": ", bold: true }), new TextRun(s.description)] 
        })),
        
        // Critical Issues
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Priority Issues to Address")] }),
        ...criticalIssues.map(issue => new Paragraph({ 
          numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun({ text: issue.title + ": ", bold: true, color: DANGER }), new TextRun(issue.description)] 
        })),
        
        new Paragraph({ children: [new PageBreak()] }),

        // === DETAILED ANALYSIS (for each category) ===
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Detailed Analysis")] }),
        ...generateCategoryAnalysis(categories, cellBorders),
        
        new Paragraph({ children: [new PageBreak()] }),

        // === ACTION PLAN ===
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Prioritized Action Plan")] }),
        
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Quick Wins (This Week)")] }),
        ...actionPlan.quickWins.map(item => new Paragraph({ 
          numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun(item)] 
        })),
        
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Short-Term (1-4 Weeks)")] }),
        ...actionPlan.shortTerm.map(item => new Paragraph({ 
          numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun(item)] 
        })),
        
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Strategic (1-3 Months)")] }),
        ...actionPlan.strategic.map(item => new Paragraph({ 
          numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun(item)] 
        })),
        
        new Paragraph({ children: [new PageBreak()] }),

        // === NEXT STEPS ===
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Next Steps with Enclave LLC")] }),
        new Paragraph({ spacing: { after: 200 }, 
          children: [new TextRun("This automated audit provides a snapshot of your website's current state. For a comprehensive analysis and custom implementation plan, we offer:")] }),
        
        new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun({ text: "Free 30-Minute Consultation: ", bold: true }), new TextRun("Discuss your audit results and business goals")] }),
        new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun({ text: "Custom Redesign Proposal: ", bold: true }), new TextRun("Detailed scope, timeline, and investment for a complete website transformation")] }),
        new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, 
          children: [new TextRun({ text: "Ongoing Support: ", bold: true }), new TextRun("Maintenance, updates, and continuous improvement packages")] }),
        
        new Paragraph({ spacing: { before: 360, after: 120 }, alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Ready to transform your online presence?", size: 28, bold: true, color: PRIMARY })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
          children: [new TextRun({ text: "Schedule your free consultation at enclavellc.net", size: 24, color: SECONDARY })] }),
        new Paragraph({ alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Or reply directly to this email", size: 22 })] }),
        
        // Disclaimer
        new Paragraph({ spacing: { before: 720 }, 
          children: [new TextRun({ text: "Disclaimer: ", bold: true, size: 18, color: "666666" }), 
            new TextRun({ text: "This is an automated analysis based on publicly accessible content. A comprehensive manual audit may reveal additional findings. Scores are relative assessments and should be considered alongside your specific business context and goals.", size: 18, color: "666666", italics: true })] }),
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

// Helper functions
function getScoreLabel(score) {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Needs Improvement";
  return "Critical Attention Required";
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  }).format(date);
}

function generateScoreTable(categories, cellBorders, headerShading) {
  // Returns a Table component with category scores
  // Implementation details...
}

function generateCategoryAnalysis(categories, cellBorders) {
  // Returns array of Paragraph/Table components for detailed analysis
  // Implementation details...
}

module.exports = { generateAuditDocument };
```

---

## Email Templates

### User Email Template

```html
Subject: Your Website Audit Report for {{websiteUrl}} is Ready!

Hi {{userName || "there"}},

Great news! Your free website audit for {{websiteUrl}} is complete.

📊 **Overall Score: {{overallScore}}/10**

**Key Findings:**
{{#each topFindings}}
• {{this}}
{{/each}}

Your full audit report is attached to this email. It includes:
✓ Detailed analysis across 8 key areas
✓ Specific issues identified with screenshots
✓ Prioritized action plan
✓ Quick wins you can implement today

**Ready to take the next step?**
Schedule a free 30-minute consultation to discuss your results and explore how we can help transform your online presence.

[Schedule Consultation](https://enclavellc.net/contact)

Best regards,
The Enclave LLC Team

---
Enclave LLC | Professional Web Development
enclavellc.net | {{contactEmail}} | {{contactPhone}}
```

### Admin Notification Email

```html
Subject: New Audit Generated: {{websiteUrl}}

**New Website Audit Lead**

Website: {{websiteUrl}}
User Email: {{userEmail}}
User Name: {{userName || "Not provided"}}
Overall Score: {{overallScore}}/10
Generated: {{timestamp}}

**Quick Stats:**
- Highest Score: {{highestCategory}} ({{highestScore}})
- Lowest Score: {{lowestCategory}} ({{lowestScore}})
- Critical Issues: {{criticalIssueCount}}

Full audit report attached.

---
Lead Tracking ID: {{auditId}}
```

---

## Frontend Integration (React Component)

```tsx
// components/WebsiteAuditForm.tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const auditSchema = z.object({
  websiteUrl: z.string()
    .url('Please enter a valid URL')
    .refine(url => url.startsWith('http'), 'URL must start with http:// or https://'),
  userEmail: z.string().email('Please enter a valid email address'),
  userName: z.string().optional(),
});

type AuditFormData = z.infer<typeof auditSchema>;

export function WebsiteAuditForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<AuditFormData>({
    resolver: zodResolver(auditSchema)
  });

  const onSubmit = async (data: AuditFormData) => {
    setStatus('loading');
    
    try {
      const response = await fetch('/api/audit/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setStatus('success');
        setMessage(`Your audit is being generated! Check ${data.userEmail} in 2-3 minutes.`);
        reset();
      } else {
        setStatus('error');
        setMessage(result.message || 'Something went wrong. Please try again.');
      }
    } catch (error) {
      setStatus('error');
      setMessage('Unable to process your request. Please try again later.');
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Free Website Audit</h2>
      <p className="text-gray-600 mb-6">
        Get a comprehensive analysis of your website delivered to your inbox in minutes.
      </p>
      
      {status === 'success' ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800">{message}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-700 mb-1">
              Website URL *
            </label>
            <input
              {...register('websiteUrl')}
              type="url"
              placeholder="https://yourwebsite.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            {errors.websiteUrl && (
              <p className="mt-1 text-sm text-red-600">{errors.websiteUrl.message}</p>
            )}
          </div>
          
          <div>
            <label htmlFor="userEmail" className="block text-sm font-medium text-gray-700 mb-1">
              Your Email *
            </label>
            <input
              {...register('userEmail')}
              type="email"
              placeholder="you@example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            {errors.userEmail && (
              <p className="mt-1 text-sm text-red-600">{errors.userEmail.message}</p>
            )}
          </div>
          
          <div>
            <label htmlFor="userName" className="block text-sm font-medium text-gray-700 mb-1">
              Your Name (optional)
            </label>
            <input
              {...register('userName')}
              type="text"
              placeholder="John Smith"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:bg-blue-400"
          >
            {status === 'loading' ? 'Generating Audit...' : 'Get Free Audit'}
          </button>
          
          {status === 'error' && (
            <p className="text-sm text-red-600 text-center">{message}</p>
          )}
        </form>
      )}
      
      <p className="mt-4 text-xs text-gray-500 text-center">
        Your audit will be delivered within 2-3 minutes. We respect your privacy.
      </p>
    </div>
  );
}
```

---

## Environment Variables Required

```bash
# .env.local

# AI Provider (for audit analysis)
ANTHROPIC_API_KEY=sk-ant-...

# Email Service (Resend recommended)
RESEND_API_KEY=re_...

# Admin notifications
ADMIN_EMAIL=alex@enclavellc.net

# Optional: Rate limiting
UPSTASH_REDIS_URL=...
UPSTASH_REDIS_TOKEN=...
```

---

## Rate Limiting & Abuse Prevention

```typescript
// Recommended protections
const auditRateLimits = {
  perIP: {
    requests: 3,
    window: '1h'  // 3 audits per hour per IP
  },
  perEmail: {
    requests: 5,
    window: '24h' // 5 audits per day per email
  },
  global: {
    requests: 100,
    window: '1h'  // 100 total audits per hour
  }
};

// Validation checks
const validationRules = [
  'URL must be publicly accessible',
  'URL must not be on blocklist (competitors, malicious sites)',
  'Email must not be disposable/temporary',
  'Basic bot detection (honeypot field, timing)'
];
```

---

## Implementation Checklist for Claude Code

- [ ] Create API route `/api/audit/generate`
- [ ] Implement URL validation and normalization
- [ ] Set up web scraping/fetching for target sites
- [ ] Integrate Claude API for analysis
- [ ] Create document generation service
- [ ] Set up email service (Resend/SendGrid)
- [ ] Build frontend form component
- [ ] Add rate limiting middleware
- [ ] Create admin dashboard for lead tracking (optional)
- [ ] Set up error monitoring (Sentry recommended)
- [ ] Add analytics tracking for conversions

---

## Notes for Claude Code / Opus

1. **AI Integration**: This template assumes using Anthropic's Claude API for the analysis. The system prompt above should be passed as the system message, with the fetched website content as the user message.

2. **Document Generation**: The docx generation code uses the `docx` npm package. Install with `npm install docx`.

3. **Email Delivery**: Resend is recommended for simplicity. Alternative: SendGrid, Postmark, or AWS SES.

4. **Background Processing**: For production, consider using a queue (Vercel's built-in, or BullMQ with Redis) to handle audit generation asynchronously.

5. **Caching**: Consider caching audits for the same URL within a time window to reduce API costs.

6. **PDF Alternative**: If PDF is preferred over DOCX, use `@react-pdf/renderer` or `puppeteer` with HTML-to-PDF conversion.

---

*Template Version: 1.0*
*Created for: Enclave LLC (enclavellc.net)*
*Last Updated: December 2024*
