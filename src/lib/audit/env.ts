// src/lib/audit/env.ts
// The audit's one accessor for its optional settings. GOOGLE_PAGESPEED_API_KEY is a SECRET: pagespeed.ts sends it
// in a request header and nowhere else; it is never logged, thrown or put in a report.
export type AuditSetting = 'AUDIT_DAILY_LIMIT' | 'AUDIT_PREVIEW_EMAILS' | 'GOOGLE_PAGESPEED_API_KEY';

export function auditSetting(name: AuditSetting): string | undefined {
  return process.env[name];
}
