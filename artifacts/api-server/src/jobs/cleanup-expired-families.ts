import { clerkClient } from "@clerk/express";
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  accountProfilesTable,
  communityReportsTable,
  communityReportStatusEventsTable,
  db,
  familyGroupsTable,
  familyMembershipsTable,
  pathPalNotificationsTable,
} from "@workspace/db";
import {
  reportObjectStorage,
  resolveReportStorageLocation,
} from "../lib/report-storage";

export async function cleanupExpiredFamilies(now = new Date()) {
  const expiredFamilies = await db.select().from(familyGroupsTable)
    .where(lte(familyGroupsTable.approvalDeadline, now));
  const cleaned: { familyId: string; deletedReports: number; retainedCases: number }[] = [];

  for (const family of expiredFamilies) {
    const [approvedChild] = await db.select({ id: familyMembershipsTable.id })
      .from(familyMembershipsTable).where(and(
        eq(familyMembershipsTable.familyId, family.id),
        eq(familyMembershipsTable.role, "child"),
        eq(familyMembershipsTable.status, "approved"),
        lte(familyMembershipsTable.approvedAt, family.approvalDeadline),
      )).limit(1);
    if (approvedChild) continue;

    const memberships = await db.select({ userId: familyMembershipsTable.userId })
      .from(familyMembershipsTable)
      .where(eq(familyMembershipsTable.familyId, family.id));
    const userIds = [...new Set([family.parentUserId, ...memberships.map(({ userId }) => userId)])];
    const reports = await db.select({
      id: communityReportsTable.id,
      photoObjectKey: communityReportsTable.photoObjectKey,
      assignedTeam: communityReportsTable.assignedTeam,
      routeAssignment: communityReportsTable.routeAssignment,
    }).from(communityReportsTable)
      .where(eq(communityReportsTable.familyId, family.id));

    const photoKeys = [...new Set(reports.flatMap((report) => report.photoObjectKey ? [report.photoObjectKey] : []))];
    if (photoKeys.length) {
      const { bucket } = resolveReportStorageLocation();
      for (const key of photoKeys) {
        await reportObjectStorage.bucket(bucket).file(key).delete({ ignoreNotFound: true });
      }
    }

    for (const userId of userIds) {
      try {
        await clerkClient.users.deleteUser(userId);
      } catch (error) {
        const status = typeof error === "object" && error !== null && "status" in error
          ? error.status
          : typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;
        if (status !== 404) throw error;
      }
    }

    const retained = reports.filter((report) => report.assignedTeam || report.routeAssignment);
    const toDelete = reports.filter((report) => !report.assignedTeam && !report.routeAssignment);
    await db.transaction(async (tx) => {
      if (toDelete.length) {
        const reportIds = toDelete.map(({ id }) => id);
        await tx.delete(communityReportStatusEventsTable)
          .where(inArray(communityReportStatusEventsTable.reportId, reportIds));
        await tx.delete(communityReportsTable)
          .where(inArray(communityReportsTable.id, reportIds));
      }
      if (retained.length) {
        await tx.update(communityReportsTable).set({
          summary: "Reporter account removed",
          description: "This assigned case was retained for operational follow-up after account cleanup.",
          reporterAccountId: null,
          familyAccountId: null,
          reporterUserId: null,
          familyId: null,
          photoObjectKey: null,
          photoContentType: null,
          photoReference: "No photo provided",
          managerNotes: null,
          updatedAt: now,
        }).where(inArray(communityReportsTable.id, retained.map(({ id }) => id)));
      }
      if (userIds.length && retained.length) {
        await tx.update(communityReportStatusEventsTable).set({ changedBy: "system:account-cleanup" })
          .where(and(
            inArray(communityReportStatusEventsTable.reportId, retained.map(({ id }) => id)),
            inArray(communityReportStatusEventsTable.changedBy, userIds),
          ));
      }
      await tx.delete(pathPalNotificationsTable)
        .where(eq(pathPalNotificationsTable.familyId, family.id));
      await tx.delete(familyGroupsTable).where(eq(familyGroupsTable.id, family.id));
      if (userIds.length) {
        await tx.delete(accountProfilesTable)
          .where(inArray(accountProfilesTable.userId, userIds));
      }
    });

    cleaned.push({
      familyId: family.id,
      deletedReports: toDelete.length,
      retainedCases: retained.length,
    });
  }
  return cleaned;
}

try {
  const result = await cleanupExpiredFamilies();
  console.info(JSON.stringify({
    job: "cleanup-expired-families",
    completedAt: new Date().toISOString(),
    familiesCleaned: result.length,
    result,
  }));
} catch (error) {
  console.error("Expired family cleanup failed.", error);
  process.exitCode = 1;
}