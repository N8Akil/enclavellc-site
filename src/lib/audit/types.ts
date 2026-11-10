// src/lib/audit/types.ts
// Type definitions for the website audit system
import type { AssessedKey, ScoreStatus } from './config';

export interface AuditRequest {
  websiteUrl: string;
  userEmail: string;
  userName?: string;
  businessType?: string;
  priorityAreas?: string[];
}

// Facts the code reads from the full parsed page. The model is handed these; it does not assert them.
export interface PageFacts {
  isHttps: boolean;
  title: string;
  metaDescription: string;
  h1Count: number;
  imageCount: number;
  imagesWithoutAlt: number;
  hasCanonical: boolean;
  hasViewportMeta: boolean;
  hasPhoneLink: boolean;
  hasEmailLink: boolean;
  hasSocialLinks: boolean;
  hasPrivacyLink: boolean;
  formCount: number;
}

export interface FetchedPage {
  // the URL that answered (after redirects)
  url: string;
  title: string;
  // labelled text of the page, capped; ends with the truncation marker when cut
  text: string;
  truncated: boolean;
  facts: PageFacts;
}

export interface WebsiteContent {
  // the homepage first, then the linked pages that could be read
  pages: FetchedPage[];
}

// Where a finding comes from: words copied from a page that was read, or something looked for and not found.
// `siteWide` marks an absence checked across every page read (pageUrl is then whichever page the model named).
export type Evidence =
  | { pageUrl: string; quote: string }
  | { pageUrl: string; absent: string; siteWide?: boolean };

export interface Finding {
  text: string;
  evidence: Evidence;
}

export interface AssessedCategory {
  key: AssessedKey;
  name: string;
  assessed: true;
  score: number;
  status: ScoreStatus;
  weight: number;
  findings: Finding[];
  recommendations: string[];
}

export interface UnassessedCategory {
  key?: AssessedKey;
  name: string;
  assessed: false;
  // a fixed sentence written in code (config.ts), never by the model
  reason: string;
}

export type CategoryResult = AssessedCategory | UnassessedCategory;

export interface Strength {
  title: string;
  description: string;
}

export interface CriticalIssue {
  title: string;
  description: string;
  impact: string;
  evidence: Evidence;
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
  // weighted average of the assessed areas only, computed in code
  overallScore: number;
  overallStatus: ScoreStatus;
  summary: string;
  categories: CategoryResult[];
  topStrengths: Strength[];
  criticalIssues: CriticalIssue[];
  actionPlan: ActionPlan;
  // the pages whose text was read
  pagesRead: string[];
  // findings and issues removed because their evidence did not check out
  droppedFindings: number;
}

export interface AuditError {
  success: false;
  error: string;
  message: string;
  websiteUrl: string;
}
