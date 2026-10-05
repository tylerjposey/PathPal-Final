import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { communityReportsTable } from "./community-reports";

export type ReportAiEvidence = {
  source: "report_text" | "image";
  detail: string;
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
  recommendedDepartment: varchar("recommended_department", { length: 100 }).notNull(),
  urgentHumanReview: boolean("urgent_human_review").notNull().default(false),
  model: varchar("model", { length: 120 }).notNull(),
  instructionVersion: varchar("instruction_version", { length: 80 }).notNull(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityReportAiAssessmentRow = typeof communityReportAiAssessmentsTable.$inferSelect;