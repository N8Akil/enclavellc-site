// src/lib/audit/types.ts
// Type definitions for the autonomous website audit system

export interface AuditRequest {
  websiteUrl: string;
  userEmail: string;
  userName?: string;
  businessType?: string;
  priorityAreas?: string[];
}

export interface CategoryScore {
  name: string;
  score: number;
  status: 'Critical' | 'Needs Improvement' | 'Good' | 'Excellent';
  weight: number;
  findings: string[];
  recommendations: string[];
}

export interface Strength {
  title: string;
  description: string;
}

export interface CriticalIssue {
  title: string;
  description: string;
  impact: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface ActionPlan {
  quickWins: string[];
  shortTerm: string[];
  strategic: string[];
}

export interface AuditResults {
  success: true;
  websiteUrl: string;
  auditDate: string;
  overallScore: number;
  overallStatus: string;
  summary: string;
  categories: CategoryScore[];
  topStrengths: Strength[];
  criticalIssues: CriticalIssue[];
  actionPlan: ActionPlan;
  competitiveContext: string;
}

export interface AuditError {
  success: false;
  error: string;
  message: string;
  websiteUrl: string;
}

export interface WebsiteContent {
  homepage: string;
  about?: string;
  contact?: string;
  services?: string;
}
