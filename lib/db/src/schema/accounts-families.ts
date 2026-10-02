import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const accountProfilesTable = pgTable("account_profiles", {
  userId: varchar("user_id", { length: 128 }).primaryKey(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  teamName: varchar("team_name", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const familyGroupsTable = pgTable(
  "family_groups",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    familyName: varchar("family_name", { length: 100 }).notNull(),
    parentUserId: varchar("parent_user_id", { length: 128 })
      .notNull()
      .references(() => accountProfilesTable.userId, { onDelete: "cascade" }),
    invitationCode: varchar("invitation_code", { length: 24 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvalDeadline: timestamp("approval_deadline", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("family_groups_parent_user_unique").on(table.parentUserId),
    uniqueIndex("family_groups_invitation_code_unique").on(table.invitationCode),
  ],
);

export const familyMembershipsTable = pgTable(
  "family_memberships",
  {
    id: serial("id").primaryKey(),
    familyId: varchar("family_id", { length: 36 })
      .notNull()
      .references(() => familyGroupsTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => accountProfilesTable.userId, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("family_memberships_user_unique").on(table.userId),
    index("family_memberships_family_status_idx").on(table.familyId, table.status),
  ],
);

export const pathPalNotificationsTable = pgTable(
  "pathpal_notifications",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => accountProfilesTable.userId, { onDelete: "cascade" }),
    familyId: varchar("family_id", { length: 36 }).references(() => familyGroupsTable.id, {
      onDelete: "cascade",
    }),
    relatedMembershipId: integer("related_membership_id").references(
      () => familyMembershipsTable.id,
      { onDelete: "cascade" },
    ),
    type: varchar("type", { length: 40 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [index("pathpal_notifications_user_created_idx").on(table.userId, table.createdAt)],
);

export const staffInvitationsTable = pgTable(
  "staff_invitations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    teamName: varchar("team_name", { length: 120 }),
    createdBy: varchar("created_by", { length: 128 })
      .notNull()
      .references(() => accountProfilesTable.userId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedBy: varchar("accepted_by", { length: 128 }).references(() => accountProfilesTable.userId, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("staff_invitations_code_hash_unique").on(table.codeHash)],
);

export type AccountProfile = typeof accountProfilesTable.$inferSelect;
export type FamilyGroup = typeof familyGroupsTable.$inferSelect;
export type FamilyMembership = typeof familyMembershipsTable.$inferSelect;
export type PathPalNotification = typeof pathPalNotificationsTable.$inferSelect;
export type StaffInvitationRecord = typeof staffInvitationsTable.$inferSelect;