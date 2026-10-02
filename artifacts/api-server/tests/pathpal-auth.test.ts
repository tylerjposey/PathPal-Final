import assert from "node:assert/strict";
import test from "node:test";
import type { CommunityReportRow } from "@workspace/db";
import {
  assertCanUpdateReport,
  canViewReport,
  HttpError,
  requireApprovedFamilyMember,
  type PathPalPrincipal,
} from "../src/lib/pathpal-auth";

function principal(
  role: PathPalPrincipal["role"],
  values: Partial<PathPalPrincipal> = {},
): PathPalPrincipal {
  return {
    userId: `${role}-user`,
    displayName: role,
    role,
    familyId: null,
    membershipStatus: null,
    teamName: null,
    ...values,
  };
}

function report(
  id: string,
  familyId: string | null,
  assignedTeam: string | null = null,
): CommunityReportRow {
  return { id, familyId, assignedTeam } as CommunityReportRow;
}

function isHttpStatus(status: number) {
  return (error: unknown) => error instanceof HttpError && error.status === status;
}

test("two families cannot see each other's reports", () => {
  const familyAReport = report("family-a-report", "family-a");
  const familyBReport = report("family-b-report", "family-b");
  const parentA = principal("parent", { familyId: "family-a", membershipStatus: "approved" });
  const childA = principal("child", { familyId: "family-a", membershipStatus: "approved" });
  const parentB = principal("parent", { familyId: "family-b", membershipStatus: "approved" });

  assert.equal(canViewReport(parentA, familyAReport), true);
  assert.equal(canViewReport(childA, familyAReport), true);
  assert.equal(canViewReport(parentA, familyBReport), false);
  assert.equal(canViewReport(childA, familyBReport), false);
  assert.equal(canViewReport(parentB, familyAReport), false);
  assert.equal(canViewReport(parentB, familyBReport), true);
});

test("pending children receive no family access, even if a row has a family id", () => {
  const pendingChild = principal("child", {
    familyId: null,
    membershipStatus: "pending",
  });
  assert.equal(canViewReport(pendingChild, report("private", "family-a")), false);
  assert.throws(() => requireApprovedFamilyMember(pendingChild), isHttpStatus(403));
});

test("only approved family members resolve their own family journey id", () => {
  const parent = principal("parent", { familyId: "family-a", membershipStatus: "approved" });
  const child = principal("child", { familyId: "family-b", membershipStatus: "approved" });
  const pendingChild = principal("child", { familyId: "family-a", membershipStatus: "pending" });

  assert.equal(requireApprovedFamilyMember(parent), "family-a");
  assert.equal(requireApprovedFamilyMember(child), "family-b");
  assert.throws(() => requireApprovedFamilyMember(pendingChild), isHttpStatus(403));
  assert.throws(() => requireApprovedFamilyMember(principal("manager")), isHttpStatus(403));
  assert.throws(() => requireApprovedFamilyMember(principal("worker")), isHttpStatus(403));
});

test("managers can access historical reports without relabeling legacy citizen data", () => {
  const historicalCitizenReport = report("legacy-citizen-report", null);
  const manager = principal("manager");
  const parent = principal("parent", { familyId: "family-a", membershipStatus: "approved" });

  assert.equal(canViewReport(manager, historicalCitizenReport), true);
  assert.equal(canViewReport(parent, historicalCitizenReport), false);
});

test("workers see only their assigned team and can update status only", () => {
  const westWorker = principal("worker", { teamName: "West Clean Team" });
  const westReport = report("west-report", null, "West Clean Team");
  const eastReport = report("east-report", null, "East Clean Team");
  const unassignedReport = report("unassigned-report", null);

  assert.equal(canViewReport(westWorker, westReport), true);
  assert.equal(canViewReport(westWorker, eastReport), false);
  assert.equal(canViewReport(westWorker, unassignedReport), false);
  assert.doesNotThrow(() => assertCanUpdateReport(westWorker, westReport, ["status"]));
  assert.throws(() => assertCanUpdateReport(westWorker, westReport, ["description"]), isHttpStatus(403));
  assert.throws(() => assertCanUpdateReport(westWorker, eastReport, ["status"]), isHttpStatus(403));
});

test("only managers and workers may change a report", () => {
  const caseReport = report("family-case", "family-a");
  const parent = principal("parent", { familyId: "family-a", membershipStatus: "approved" });
  const manager = principal("manager");

  assert.throws(() => assertCanUpdateReport(parent, caseReport, ["status"]), isHttpStatus(403));
  assert.doesNotThrow(() => assertCanUpdateReport(manager, caseReport, ["status", "managerNotes"]));
});