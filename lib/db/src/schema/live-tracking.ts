import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const trackingFamiliesTable = pgTable("tracking_families", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: varchar("owner_user_id", { length: 255 }).notNull(),
  familyName: varchar("family_name", { length: 120 }).notNull(),
  invitationCode: varchar("invitation_code", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tracking_families_owner_user_uq").on(table.ownerUserId),
  uniqueIndex("tracking_families_invitation_code_uq").on(table.invitationCode),
]);

export const trackingChildrenTable = pgTable("tracking_family_children", {
  id: uuid("id").defaultRandom().primaryKey(),
  familyId: uuid("family_id").notNull().references(() => trackingFamiliesTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tracking_family_children_user_uq").on(table.userId),
  index("tracking_family_children_family_idx").on(table.familyId),
]);

export const trackingJourneysTable = pgTable("tracking_journeys", {
  id: uuid("id").defaultRandom().primaryKey(),
  familyId: uuid("family_id").notNull().references(() => trackingFamiliesTable.id, { onDelete: "cascade" }),
  childId: uuid("child_id").notNull().references(() => trackingChildrenTable.id, { onDelete: "cascade" }),
  routeData: jsonb("route_data").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("awaiting_child"),
  parentApprovedAt: timestamp("parent_approved_at", { withTimezone: true }).notNull().defaultNow(),
  childOptedInAt: timestamp("child_opted_in_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  encryptedLatestLocation: text("encrypted_latest_location"),
  progressMeters: doublePrecision("progress_meters").notNull().default(0),
  arrivalAttempt: integer("arrival_attempt").notNull().default(1),
  locationHealth: varchar("location_health", { length: 16 }).notNull().default("not_started"),
  lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
  locationTokenHash: varchar("location_token_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tracking_journeys_family_status_idx").on(table.familyId, table.status),
  index("tracking_journeys_child_status_idx").on(table.childId, table.status),
]);

export const trackingJourneyEventsTable = pgTable("tracking_journey_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  journeyId: uuid("journey_id").notNull().references(() => trackingJourneysTable.id, { onDelete: "cascade" }),
  checkpointKey: varchar("checkpoint_key", { length: 120 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  subtitle: varchar("subtitle", { length: 240 }).notNull(),
  source: varchar("source", { length: 16 }).notNull(),
  corrected: boolean("corrected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tracking_journey_events_checkpoint_uq").on(table.journeyId, table.checkpointKey),
  index("tracking_journey_events_journey_created_idx").on(table.journeyId, table.createdAt),
]);

export type TrackingFamilyRow = typeof trackingFamiliesTable.$inferSelect;
export type TrackingChildRow = typeof trackingChildrenTable.$inferSelect;
export type TrackingJourneyRow = typeof trackingJourneysTable.$inferSelect;
export type TrackingJourneyEventRow = typeof trackingJourneyEventsTable.$inferSelect;