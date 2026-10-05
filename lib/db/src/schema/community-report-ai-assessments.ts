import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { communityReportsTable } from "./community-reports";

export type ReportAiEvidence = {
  source: "report_text" | "image";
  detail: string;
};

export type ReportAssessmentOriginal = {
  suggestedCategory: string;
  summary: string;
  suggestedSeverity: number;
  suggestedPriority: string;
  urgency: string;
  evidenceQuality: string;
  evidence: ReportAiEvidence[];
  uncertainty: string;
  conflicts: string[];
  missingFacts: string[];
  recommendedDepartment: string;
  urgentHumanReview: boolean;
};

export type ReportRuleAdjustment = {
  field: "suggestedSeverity" | "suggestedPriority" | "urgency" | "urgentHumanReview";
  source: string;
  reason: string;
  beforeValue: string | number | boolean;
  afterValue: string | number | boolean;
};

export const communityReportAiAssessmentsTable = pgTable("community_report_ai_assessments", {
  id: serial("id").primaryKey(),
  reportId: varchar("report_id", { length: 80 }).notNull().references(() => communityReportsTable.id, { onDelete: "cascade" }),
  suggestedCategory: varchar("suggested_category", { length: 40 }).notNull(),
  summary: text("summary").notNull(),
  suggestedSeverity: integer("suggested_severity").notNull(),
  suggestedPriority: varchar("suggested_priority", { length: 10 }).notNull(),
  evidence: jsonb("evidence").$type<ReportAiEvidence[]>().notNull(),
  uncertainty: text("uncertainty").notNull(),
  urgency: varchar("urgency", { length: 24 }).notNull().default("undetermined"),
  evidenceQuality: varchar("evidence_quality", { length: 20 }).notNull().default("limited"),
  imageAssessmentStatus: varchar("image_assessment_status", { length: 20 }).notNull().default("not_provided"),
  conflicts: jsonb("conflicts").$type<string[]>().notNull().default([]),
  missingFacts: jsonb("missing_facts").$type<string[]>().notNull().default([]),
  originalAssessment: jsonb("original_assessment").$type<ReportAssessmentOriginal | null>(),
  ruleAdjustments: jsonb("rule_adjustments").$type<ReportRuleAdjustment[]>().notNull().default([]),
  recommendedDepartment: varchar("recommended_department", { length: 100 }).notNull(),
  urgentHumanReview: boolean("urgent_human_review").notNull().default(false),
  model: varchar("model", { length: 120 }).notNull(),
  instructionVersion: varchar("instruction_version", { length: 80 }).notNull(),
  rubricVersion: varchar("rubric_version", { length: 80 }).notNull().default("community-hazard-triage-v1"),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityReportAiAssessmentRow = typeof communityReportAiAssessmentsTable.$inferSelect;