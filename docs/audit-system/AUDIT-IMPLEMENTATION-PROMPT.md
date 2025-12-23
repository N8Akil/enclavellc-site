# Audit System Implementation Prompt for Claude Desktop

## Context
I have three audit system files transferred to `/mnt/extreme-pro/enclavellc-site/docs/audit-system/`:
- autonomous-website-audit-template.md (complete implementation guide)
- audit-system-prompt.md (AI system prompt)
- audit-system-config.json (configuration)

Dependencies already installed: docx, resend, @anthropic-ai/sdk, cheerio, zod

## Task
Implement the complete autonomous website audit feature based on the template documentation.

## Implementation Checklist

### 1. Create Type Definitions
**File**: `src/lib/audit/types.ts`
- Define AuditRequest, AuditResults, Category Score, WebsiteContent interfaces
- Copy from the template's TypeScript interfaces section

### 2. Website Fetching Service
**File**: `src/lib/audit/fetch-website.ts`
```typescript
- fetchWebsiteContent(url): Fetch homepage + about/contact/services pages
- Use cheerio to extract text content
- Remove scripts/styles/nav
- Return WebsiteContent object
```

### 3. Claude API Integration
**File**: `src/lib/audit/run-audit.ts`
```typescript
- Load system_prompt from audit-system-config.json
- Call Anthropic Claude API with website content
- Parse JSON response
- Return AuditResults or AuditError
```

### 4. Document Generation
**File**: `src/lib/audit/generate-document.ts`
```typescript
- Use docx library
- Implement generateAuditDocument(auditResults)
- Create professional .docx with:
  - Cover page with overall score
  - Executive summary
  - Detailed category analysis
  - Action plan (quick wins, short-term, strategic)
  - Next steps/CTA section
- Use colors from audit-system-config.json
- Return Buffer
```

### 5. Email Service
**File**: `src/lib/audit/send-emails.ts`
```typescript
- Use Resend
- sendAuditEmails(document, userEmail, adminEmail, websiteUrl, userName)
- Send to user with professional template
- Send to admin (alex@enclavellc.net) with lead notification
- Attach .docx file to both emails
```

### 6. API Route
**File**: `src/app/api/audit/generate/route.ts`
```typescript
export async function POST(request: Request) {
  // 1. Validate input (websiteUrl, userEmail)
  // 2. Fetch website content
  // 3. Run Claude audit
  // 4. Generate document
  // 5. Send emails
  // 6. Return success response
  // Handle errors appropriately
}
```

### 7. Frontend Form Component
**File**: `src/components/WebsiteAuditForm.tsx`
```tsx
- Use react-hook-form with zod validation
- Fields: websiteUrl (required), userEmail (required), userName (optional)
- POST to /api/audit/generate
- Show loading state during generation
- Success message: "Check your email in 2-3 minutes"
- Error handling
- Clean, professional UI matching site design
```

### 8. Environment Variables
**File**: `.env.local`
```bash
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
ADMIN_EMAIL=alex@enclavellc.net
```

## Implementation Notes

1. **Import Config**: The audit-system-config.json contains:
   - system_prompt (use this verbatim for Claude API)
   - Colors for document branding
   - Scoring weights
   - Rate limits (implement later)

2. **Error Handling**: Return user-friendly error messages for:
   - Invalid URL
   - Site unreachable
   - Audit generation failed
   - Email delivery failed

3. **Document Styling**: Use colors from config:
   - Primary: #1B4F72
   - Secondary: #2874A6
   - Accent: #E67E22
   - Success: #27AE60
   - Warning: #F39C12
   - Danger: #C0392B

4. **Testing**: After implementation:
   - Test with a simple website first
   - Verify document generation
   - Confirm both emails are sent
   - Check formatting and content quality

## Reference Template
All implementation details, including complete code examples for document generation, are in:
`/mnt/extreme-pro/enclavellc-site/docs/audit-system/autonomous-website-audit-template.md`

Follow the template exactly, especially for:
- Document structure and styling
- Email templates
- API route error handling
- Frontend validation

## Priority
This is a high-value lead generation feature. Focus on:
1. Core functionality first (API + document + email)
2. Then polish the frontend UX
3. Test thoroughly before deploying

Please implement this systematically, file by file, and test each component as you go.
