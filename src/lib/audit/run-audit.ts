// src/lib/audit/run-audit.ts
import Anthropic from '@anthropic-ai/sdk';
import type { WebsiteContent, AuditResults, AuditError } from './types';

// Load config from JSON file
import auditConfig from '../../../docs/audit-system/audit-system-config.json';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function runAudit(
  content: WebsiteContent,
  websiteUrl: string,
  options?: { businessType?: string; priorityAreas?: string[] }
): Promise<AuditResults | AuditError> {
  try {
    const userMessage = buildUserMessage(content, websiteUrl, options);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: auditConfig.system_prompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    const jsonString = jsonMatch ? jsonMatch[1] : text;

    const auditResults = JSON.parse(jsonString.trim());

    return {
      success: true,
      ...auditResults,
      websiteUrl,
      auditDate: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Audit generation error:', error);
    return {
      success: false,
      error: 'AUDIT_FAILED',
      message: 'Failed to generate audit. Please try again.',
      websiteUrl,
    };
  }
}

interface EnhancedWebsiteContent extends WebsiteContent {
  discoveredPages?: Array<{ url: string; title: string; content: string }>;
  totalPagesAnalyzed?: number;
  siteStructure?: string[];
}

function buildUserMessage(
  content: EnhancedWebsiteContent,
  websiteUrl: string,
  options?: { businessType?: string; priorityAreas?: string[] }
): string {
  // Build discovered pages section
  let discoveredPagesSection = '';
  if (content.discoveredPages && content.discoveredPages.length > 0) {
    discoveredPagesSection = content.discoveredPages
      .map((page, index) => `
---
DISCOVERED PAGE ${index + 1}: ${page.title}
URL: ${page.url}
${page.content}
`).join('\n');
  }

  return `
Perform a comprehensive website audit for the following site.

Website URL: ${websiteUrl}
Business Type: ${options?.businessType || 'Not specified'}
Priority Areas: ${options?.priorityAreas?.join(', ') || 'All areas'}
Total Pages Analyzed: ${content.totalPagesAnalyzed || 1}
Site Structure: ${content.siteStructure?.join(', ') || websiteUrl}

---
HOMEPAGE CONTENT:
${content.homepage}

---
ABOUT PAGE CONTENT:
${content.about || 'Not available or not found'}

---
CONTACT PAGE CONTENT:
${content.contact || 'Not available or not found'}

---
SERVICES PAGE CONTENT:
${content.services || 'Not available or not found'}
${discoveredPagesSection}

---

Analyze this website comprehensively based on ALL the pages provided above. Return the audit results as a JSON object following the exact structure specified in your instructions. Return ONLY valid JSON, no markdown formatting.
`.trim();
}
