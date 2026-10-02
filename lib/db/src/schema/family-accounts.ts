import { pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const familyAccountsTable = pgTable("family_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerDemoSub: varchar("owner_demo_sub", { length: 120 }).notNull(),
  familyName: varchar("family_name", { length: 120 }).notNull(),
  invitationCode: varchar("invitation_code", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("family_accounts_owner_demo_sub_uq").on(table.ownerDemoSub),
  uniqueIndex("family_accounts_invitation_code_uq").on(table.invitationCode),
]);

export const familyChildrenTable = pgTable("family_children", {
  id: uuid("id").defaultRandom().primaryKey(),
  familyId: uuid("family_id").notNull().references(() => familyAccountsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  username: varchar("username", { length: 60 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("family_children_family_username_uq").on(table.familyId, table.username),
]);

export type FamilyAccountRow = typeof familyAccountsTable.$inferSelect;
export type FamilyChildRow = typeof familyChildrenTable.$inferSelect;