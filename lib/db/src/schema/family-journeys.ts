import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { familyGroupsTable } from "./accounts-families";

export const familyJourneysTable = pgTable(
  "family_journeys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyId: varchar("family_id", { length: 36 })
      .notNull()
      .references(() => familyGroupsTable.id, { onDelete: "cascade" }),
    routeData: jsonb("route_data").notNull(),
    originName: varchar("origin_name", { length: 200 }).notNull(),
    originLatitude: doublePrecision("origin_latitude").notNull(),
    originLongitude: doublePrecision("origin_longitude").notNull(),
    destinationName: varchar("destination_name", { length: 200 }).notNull(),
    destinationLatitude: doublePrecision("destination_latitude").notNull(),
    destinationLongitude: doublePrecision("destination_longitude").notNull(),
    milestoneIndex: integer("milestone_index").notNull().default(-1),
    tripUpdatedAt: timestamp("trip_updated_at", { withTimezone: true }),
    createdByUserId: varchar("created_by_user_id", { length: 255 }).notNull(),
    updatedByUserId: varchar("updated_by_user_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("family_journeys_family_id_unique").on(table.familyId)],
);

export type FamilyJourneyRow = typeof familyJourneysTable.$inferSelect;
export type NewFamilyJourneyRow = typeof familyJourneysTable.$inferInsert;