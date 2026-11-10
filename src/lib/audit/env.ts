// src/lib/audit/env.ts
// The audit's one accessor for optional, non-secret settings.
export type AuditSetting = 'AUDIT_DAILY_LIMIT' | 'AUDIT_PREVIEW_EMAILS';

export function auditSetting(name: AuditSetting): string | undefined {
  return process.env[name];
}
