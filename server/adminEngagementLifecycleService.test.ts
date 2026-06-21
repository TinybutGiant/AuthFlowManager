import assert from "node:assert/strict";
import test from "node:test";

import {
  activateDueEngagements,
  offboardExpiredEngagements,
} from "./adminEngagementLifecycleService";
import type { AdminEngagement, AdminUser } from "@shared/schema";

class MemoryLifecycleStorage {
  admins = new Map<number, any>();
  engagements = new Map<number, any>();
  events: any[] = [];

  seedAdmin(overrides: Partial<AdminUser> = {}) {
    const admin = {
      id: this.admins.size + 1,
      name: "Trainee",
      email: `trainee-${this.admins.size + 1}@example.com`,
      role: "trainee_access",
      status: "active",
      ...overrides,
    };
    this.admins.set(admin.id, admin);
    return admin;
  }

  seedEngagement(adminUserId: number, overrides: Partial<AdminEngagement> = {}) {
    const engagement = {
      id: this.engagements.size + 1,
      adminUserId,
      engagementType: "intern",
      scheduleType: "part_time",
      workAuthorizationType: "none",
      startDate: "2026-06-01",
      endDate: "2026-08-31",
      supervisorAdminId: null,
      workScope: "Training",
      expectedHoursPerWeek: 20,
      status: "draft",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-05-01T00:00:00Z"),
      ...overrides,
    };
    this.engagements.set(engagement.id, engagement);
    return engagement;
  }

  async listDueTraineeEngagementsForActivation(now: Date) {
    const today = now.toISOString().slice(0, 10);
    return [...this.engagements.values()].filter((engagement) => {
      const admin = this.admins.get(engagement.adminUserId);
      return (
        admin?.role === "trainee_access" &&
        admin.status === "active" &&
        ["draft", "invited"].includes(engagement.status) &&
        engagement.startDate &&
        engagement.startDate <= today
      );
    });
  }

  async listExpiredActiveTraineeEngagements(now: Date) {
    const today = now.toISOString().slice(0, 10);
    return [...this.engagements.values()].filter((engagement) => {
      const admin = this.admins.get(engagement.adminUserId);
      return (
        admin?.role === "trainee_access" &&
        engagement.status === "active" &&
        engagement.endDate &&
        engagement.endDate < today
      );
    });
  }

  async activateTraineeEngagementLifecycle(engagementId: number, now: Date) {
    const today = now.toISOString().slice(0, 10);
    const engagement = this.engagements.get(engagementId);
    const admin = engagement ? this.admins.get(engagement.adminUserId) : undefined;
    if (
      !engagement ||
      !admin ||
      admin.role !== "trainee_access" ||
      admin.status !== "active" ||
      !["draft", "invited"].includes(engagement.status) ||
      !engagement.startDate ||
      engagement.startDate > today
    ) {
      return false;
    }

    const previousStatus = engagement.status;
    const updated = { ...engagement, status: "active", updatedAt: now };
    this.engagements.set(engagementId, updated);
    for (const eventType of ["onboarding_started", "engagement_activated"]) {
      this.events.push({
        adminUserId: updated.adminUserId,
        engagementId,
        eventType,
        occurredAt: now,
        actorAdminId: null,
        metadata: {
          previous_status: previousStatus,
          new_status: "active",
          start_date: updated.startDate,
        },
      });
    }
    return true;
  }

  async offboardTraineeEngagementLifecycle(engagementId: number, now: Date) {
    const today = now.toISOString().slice(0, 10);
    const engagement = this.engagements.get(engagementId);
    const admin = engagement ? this.admins.get(engagement.adminUserId) : undefined;
    if (
      !engagement ||
      !admin ||
      admin.role !== "trainee_access" ||
      engagement.status !== "active" ||
      !engagement.endDate ||
      engagement.endDate >= today
    ) {
      return false;
    }

    this.engagements.set(engagementId, { ...engagement, status: "offboarding", updatedAt: now });
    this.events.push({
      adminUserId: engagement.adminUserId,
      engagementId,
      eventType: "offboarding_started",
      occurredAt: now,
      actorAdminId: null,
      metadata: { previous_status: "active", new_status: "offboarding", end_date: engagement.endDate },
    });

    const alreadyInactive = admin.status !== "active";
    if (!alreadyInactive) {
      this.admins.set(admin.id, { ...admin, status: "inactive" });
    }
    this.events.push({
      adminUserId: engagement.adminUserId,
      engagementId,
      eventType: "access_disabled",
      occurredAt: now,
      actorAdminId: null,
      metadata: {
        previous_status: admin.status,
        new_status: alreadyInactive ? admin.status : "inactive",
        end_date: engagement.endDate,
        already_inactive: alreadyInactive,
      },
    });

    this.engagements.set(engagementId, { ...engagement, status: "ended", endedAt: now, updatedAt: now });
    this.events.push({
      adminUserId: engagement.adminUserId,
      engagementId,
      eventType: "engagement_ended",
      occurredAt: now,
      actorAdminId: null,
      metadata: { previous_status: "offboarding", new_status: "ended", end_date: engagement.endDate },
    });
    return true;
  }
}

test("due invited trainee engagement becomes active and records onboarding events", async () => {
  const store = new MemoryLifecycleStorage();
  const admin = store.seedAdmin();
  const engagement = store.seedEngagement(admin.id, { status: "invited", startDate: "2026-06-01" });

  const result = await activateDueEngagements(new Date("2026-06-01T12:00:00Z"), store as any);

  assert.equal(result.activatedCount, 1);
  assert.equal(store.engagements.get(engagement.id).status, "active");
  assert.deepEqual(store.events.map((event) => event.eventType), ["onboarding_started", "engagement_activated"]);
  assert.deepEqual(store.events[0].metadata, {
    previous_status: "invited",
    new_status: "active",
    start_date: "2026-06-01",
  });
});

test("activation transition is idempotent", async () => {
  const store = new MemoryLifecycleStorage();
  const admin = store.seedAdmin();
  store.seedEngagement(admin.id, { status: "draft", startDate: "2026-06-01" });
  const now = new Date("2026-06-02T00:00:00Z");

  await activateDueEngagements(now, store as any);
  const second = await activateDueEngagements(now, store as any);

  assert.equal(second.activatedCount, 0);
  assert.equal(store.events.length, 2);
});

test("expired active trainee engagement ends and disables access", async () => {
  const store = new MemoryLifecycleStorage();
  const admin = store.seedAdmin();
  const engagement = store.seedEngagement(admin.id, { status: "active", endDate: "2026-06-30" });

  const result = await offboardExpiredEngagements(new Date("2026-07-01T12:00:00Z"), store as any);

  assert.equal(result.offboardedCount, 1);
  assert.equal(store.engagements.get(engagement.id).status, "ended");
  assert.ok(store.engagements.get(engagement.id).endedAt);
  assert.equal(store.admins.get(admin.id).status, "inactive");
  assert.deepEqual(store.events.map((event) => event.eventType), [
    "offboarding_started",
    "access_disabled",
    "engagement_ended",
  ]);
});

test("expired active trainee engagement ends even when user is already inactive", async () => {
  const store = new MemoryLifecycleStorage();
  const admin = store.seedAdmin({ status: "inactive" });
  const engagement = store.seedEngagement(admin.id, { status: "active", endDate: "2026-06-30" });

  const result = await offboardExpiredEngagements(new Date("2026-07-01T12:00:00Z"), store as any);

  assert.equal(result.offboardedCount, 1);
  assert.equal(store.engagements.get(engagement.id).status, "ended");
  assert.ok(store.engagements.get(engagement.id).endedAt);
  assert.equal(store.admins.get(admin.id).status, "inactive");
  const accessDisabled = store.events.find((event) => event.eventType === "access_disabled");
  assert.equal(accessDisabled.metadata.already_inactive, true);
});

test("scheduled offboarding does not run on planned last active day", async () => {
  const store = new MemoryLifecycleStorage();
  const admin = store.seedAdmin();
  const engagement = store.seedEngagement(admin.id, { status: "active", endDate: "2026-06-30" });

  const result = await offboardExpiredEngagements(new Date("2026-06-30T12:00:00Z"), store as any);

  assert.equal(result.offboardedCount, 0);
  assert.equal(store.engagements.get(engagement.id).status, "active");
  assert.equal(store.admins.get(admin.id).status, "active");
  assert.equal(store.events.length, 0);
});

test("offboarding transition is idempotent", async () => {
  const store = new MemoryLifecycleStorage();
  const admin = store.seedAdmin();
  store.seedEngagement(admin.id, { status: "active", endDate: "2026-06-30" });
  const now = new Date("2026-07-01T00:00:00Z");

  await offboardExpiredEngagements(now, store as any);
  const second = await offboardExpiredEngagements(now, store as any);

  assert.equal(second.offboardedCount, 0);
  assert.equal(store.events.length, 3);
});

test("cancelled rejected inactive pending and non-trainee engagements are ignored for activation", async () => {
  const store = new MemoryLifecycleStorage();
  const trainee = store.seedAdmin();
  const rejected = store.seedAdmin({ status: "rejected" });
  const inactive = store.seedAdmin({ status: "inactive" });
  const pending = store.seedAdmin({ status: "pending" });
  const finance = store.seedAdmin({ role: "admin_finance" });
  store.seedEngagement(trainee.id, { status: "cancelled", startDate: "2026-06-01", endDate: "2026-06-30" });
  store.seedEngagement(rejected.id, { status: "invited", startDate: "2026-06-01" });
  store.seedEngagement(inactive.id, { status: "invited", startDate: "2026-06-01" });
  store.seedEngagement(pending.id, { status: "invited", startDate: "2026-06-01" });
  store.seedEngagement(finance.id, { status: "active", endDate: "2026-06-30" });

  const result = await activateDueEngagements(new Date("2026-07-01T00:00:00Z"), store as any);

  assert.equal(result.activatedCount, 0);
  assert.equal(store.events.length, 0);
});

test("scheduled offboarding ignores non-trainee admin roles", async () => {
  const store = new MemoryLifecycleStorage();
  const finance = store.seedAdmin({ role: "admin_finance" });
  store.seedEngagement(finance.id, { status: "active", endDate: "2026-06-30" });

  const result = await offboardExpiredEngagements(new Date("2026-07-01T00:00:00Z"), store as any);

  assert.equal(result.offboardedCount, 0);
  assert.equal(store.events.length, 0);
});
