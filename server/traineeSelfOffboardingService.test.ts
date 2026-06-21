import assert from "node:assert/strict";
import test from "node:test";

import { selfOffboardTraineeEngagement } from "./traineeSelfOffboardingService";

class MemorySelfOffboardingStorage {
  admins = new Map<number, any>();
  engagements = new Map<number, any>();
  events: any[] = [];
  simulateLostTransition = false;

  seedAdmin(overrides: Record<string, any> = {}) {
    const admin = {
      id: this.admins.size + 1,
      role: "trainee_access",
      status: "active",
      ...overrides,
    };
    this.admins.set(admin.id, admin);
    return admin;
  }

  seedEngagement(adminUserId: number, overrides: Record<string, any> = {}) {
    const engagement = {
      id: this.engagements.size + 1,
      adminUserId,
      status: "active",
      endedAt: null,
      ...overrides,
    };
    this.engagements.set(engagement.id, engagement);
    return engagement;
  }

  async selfOffboardTraineeEngagement(
    adminUserId: number,
    input: { reason?: string | null; now?: Date }
  ) {
    const now = input.now ?? new Date();
    const engagements = [...this.engagements.values()].filter(
      (engagement) => engagement.adminUserId === adminUserId && ["active", "invited", "draft"].includes(engagement.status)
    );
    const engagement =
      engagements.find((candidate) => candidate.status === "active") ??
      engagements.find((candidate) => candidate.status === "invited") ??
      engagements[0];

    if (!engagement) {
      return { status: "already_ended" as const };
    }

    if (engagement.status === "active") {
      if (this.simulateLostTransition) {
        this.engagements.set(engagement.id, { ...engagement, status: "ended", endedAt: now });
        return { status: "already_ended" as const };
      }

      this.engagements.set(engagement.id, { ...engagement, status: "offboarding", updatedAt: now });
      this.events.push({
        eventType: "self_offboarding_requested",
        adminUserId,
        engagementId: engagement.id,
        metadata: { previous_status: engagement.status, reason: input.reason ?? null },
      });
      this.admins.set(adminUserId, { ...this.admins.get(adminUserId), status: "inactive" });
      this.engagements.set(engagement.id, { ...engagement, status: "ended", endedAt: now, updatedAt: now });
      this.events.push(
        { eventType: "early_offboarding_started", adminUserId, engagementId: engagement.id },
        { eventType: "access_disabled", adminUserId, engagementId: engagement.id },
        { eventType: "engagement_ended", adminUserId, engagementId: engagement.id }
      );
      return { status: "ended" as const, engagement: this.engagements.get(engagement.id) };
    }

    if (this.simulateLostTransition) {
      this.engagements.set(engagement.id, { ...engagement, status: "cancelled", endedAt: now });
      return { status: "already_ended" as const };
    }

    this.engagements.set(engagement.id, { ...engagement, status: "cancelled", endedAt: now });
    this.admins.set(adminUserId, { ...this.admins.get(adminUserId), status: "inactive" });
    this.events.push({
      eventType: "self_offboarding_requested",
      adminUserId,
      engagementId: engagement.id,
      metadata: { previous_status: engagement.status, reason: input.reason ?? null },
    });
    this.events.push(
      { eventType: "engagement_cancelled", adminUserId, engagementId: engagement.id },
      { eventType: "access_disabled", adminUserId, engagementId: engagement.id }
    );
    return { status: "cancelled" as const, engagement: this.engagements.get(engagement.id) };
  }
}

test("active trainee can self-offboard and disable own access", async () => {
  const store = new MemorySelfOffboardingStorage();
  const admin = store.seedAdmin();
  const engagement = store.seedEngagement(admin.id, { status: "active" });

  const result = await selfOffboardTraineeEngagement({
    adminUserId: admin.id,
    reason: "Schedule changed",
    now: new Date("2026-06-20T12:00:00Z"),
    storage: store,
  });

  assert.equal(result.status, "ended");
  assert.equal(store.engagements.get(engagement.id).status, "ended");
  assert.ok(store.engagements.get(engagement.id).endedAt);
  assert.equal(store.admins.get(admin.id).status, "inactive");
  assert.deepEqual(store.events.map((event) => event.eventType), [
    "self_offboarding_requested",
    "early_offboarding_started",
    "access_disabled",
    "engagement_ended",
  ]);
  assert.equal(store.events[0].metadata.reason, "Schedule changed");
});

test("draft or invited self-offboarding cancels engagement and disables access", async () => {
  for (const status of ["draft", "invited"]) {
    const store = new MemorySelfOffboardingStorage();
    const admin = store.seedAdmin();
    const engagement = store.seedEngagement(admin.id, { status });

    const result = await selfOffboardTraineeEngagement({
      adminUserId: admin.id,
      now: new Date("2026-06-20T12:00:00Z"),
      storage: store,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(store.engagements.get(engagement.id).status, "cancelled");
    assert.equal(store.admins.get(admin.id).status, "inactive");
    assert.deepEqual(store.events.map((event) => event.eventType), [
      "self_offboarding_requested",
      "engagement_cancelled",
      "access_disabled",
    ]);
  }
});

test("repeated self-offboarding is idempotent and does not duplicate events", async () => {
  const store = new MemorySelfOffboardingStorage();
  const admin = store.seedAdmin();
  store.seedEngagement(admin.id, { status: "active" });

  await selfOffboardTraineeEngagement({ adminUserId: admin.id, storage: store });
  const second = await selfOffboardTraineeEngagement({ adminUserId: admin.id, storage: store });

  assert.equal(second.status, "already_ended");
  assert.equal(store.events.length, 4);
});

test("self-offboarding losing a concurrent transition writes no request event", async () => {
  const store = new MemorySelfOffboardingStorage();
  const admin = store.seedAdmin();
  store.seedEngagement(admin.id, { status: "active" });
  store.simulateLostTransition = true;

  const result = await selfOffboardTraineeEngagement({ adminUserId: admin.id, storage: store });

  assert.equal(result.status, "already_ended");
  assert.equal(store.events.length, 0);
});

test("self-offboarding cannot affect another user when scoped by authenticated id", async () => {
  const store = new MemorySelfOffboardingStorage();
  const first = store.seedAdmin();
  const second = store.seedAdmin();
  const firstEngagement = store.seedEngagement(first.id, { status: "active" });
  const secondEngagement = store.seedEngagement(second.id, { status: "active" });

  await selfOffboardTraineeEngagement({ adminUserId: first.id, storage: store });

  assert.equal(store.engagements.get(firstEngagement.id).status, "ended");
  assert.equal(store.engagements.get(secondEngagement.id).status, "active");
  assert.equal(store.admins.get(second.id).status, "active");
});
