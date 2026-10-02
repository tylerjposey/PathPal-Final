import { boolean, doublePrecision, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountProfilesTable, familyGroupsTable } from "./accounts-families";

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
  photoReference: text("photo_reference").notNull().default("No photo provided"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  recommendedDepartment: varchar("recommended_department", { length: 100 }).notNull(),
  priority: varchar("priority", { length: 10 }).notNull(),
  assignedTeam: varchar("assigned_team", { length: 120 }),
  awardedPoints: boolean("awarded_points").notNull().default(false),
  reporterAccountId: varchar("reporter_account_id", { length: 120 }),
  familyAccountId: varchar("family_account_id", { length: 120 }),
  reporterUserId: varchar("reporter_user_id", { length: 128 }).references(
    () => accountProfilesTable.userId,
    { onDelete: "set null" },
  ),
  familyId: varchar("family_id", { length: 36 }).references(() => familyGroupsTable.id, {
    onDelete: "set null",
  }),
  selectedCategory: varchar("selected_category", { length: 40 }),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  managerNotes: text("manager_notes"),
  routeAssignment: varchar("route_assignment", { length: 160 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const communityReportStatusEventsTable = pgTable("community_report_status_events", {
  id: serial("id").primaryKey(),
  reportId: varchar("report_id", { length: 80 }).notNull(),
  fromStatus: varchar("from_status", { length: 20 }),
  toStatus: varchar("to_status", { length: 20 }).notNull(),
  changedBy: varchar("changed_by", { length: 120 }).notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommunityReportSchema = createInsertSchema(communityReportsTable).omit({
  submittedAt: true,
});
export type InsertCommunityReport = z.infer<typeof insertCommunityReportSchema>;
export type CommunityReportRow = typeof communityReportsTable.$inferSelect;
export type CommunityReportStatusEvent = typeof communityReportStatusEventsTable.$inferSelect;