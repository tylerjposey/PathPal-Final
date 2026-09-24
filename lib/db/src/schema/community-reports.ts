import { boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const communityReportsTable = pgTable("community_reports", {
  id: varchar("id", { length: 80 }).primaryKey(),
  category: varchar("category", { length: 40 }).notNull(),
  summary: text("summary").notNull(),
  description: text("description").notNull(),
  severity: integer("severity").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  location: varchar("location", { length: 80 }).notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  photoObjectKey: text("photo_object_key"),
  photoContentType: varchar("photo_content_type", { length: 40 }),
  reporterId: text("reporter_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  recommendedDepartment: varchar("recommended_department", { length: 100 }).notNull(),
  priority: varchar("priority", { length: 10 }).notNull(),
  assignedTeam: varchar("assigned_team", { length: 120 }),
  awardedPoints: boolean("awarded_points").notNull().default(false),
});

export const insertCommunityReportSchema = createInsertSchema(communityReportsTable).omit({
  submittedAt: true,
  updatedAt: true,
});
export type InsertCommunityReport = z.infer<typeof insertCommunityReportSchema>;
export type CommunityReportRow = typeof communityReportsTable.$inferSelect;