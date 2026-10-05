import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { communityReportAiAssessmentsTable } from "./community-report-ai-assessments";
import { communityReportsTable } from "./community-reports";

export const communityReportAiReviewsTable = pgTable("community_report_ai_reviews", {
  id: serial("id").primaryKey(),
  reportId: varchar("report_id", { length: 80 }).notNull().references(() => communityReportsTable.id, { onDelete: "cascade" }),
  assessmentId: integer("assessment_id").notNull().references(() => communityReportAiAssessmentsTable.id, { onDelete: "cascade" }),
  decision: varchar("decision", { length: 20 }).notNull(),
  reason: text("reason").notNull(),
  finalCategory: varchar("final_category", { length: 40 }).notNull(),
  finalSeverity: integer("final_severity").notNull(),
  finalPriority: varchar("final_priority", { length: 10 }).notNull(),
  finalUrgency: varchar("final_urgency", { length: 24 }),
  finalDepartment: varchar("final_department", { length: 100 }).notNull(),
  reviewedBy: varchar("reviewed_by", { length: 120 }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityReportAiReviewRow = typeof communityReportAiReviewsTable.$inferSelect;