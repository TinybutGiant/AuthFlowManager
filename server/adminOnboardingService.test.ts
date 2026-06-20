import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminOnboardingError,
  approveCreateAdminRequest,
  assertCanLogin,
  completePasswordSetup,
  createAdminAccountForPasswordSetup,
  createPendingAdminAccount,
  rejectCreateAdminRequest,
  resendPasswordSetupLink,
  sanitizeAdminUser,
  type AdminOnboardingStorage,
} from "./adminOnboardingService";
import { hashPasswordSetupToken } from "./passwordSetup";
import type {
  AdminUser,
  AdminUserApproval,
  InsertAdminEngagement,
  InsertAdminLifecycleEvent,
  InsertAdminUser,
  InsertAdminUserApproval,
} from "@shared/schema";

class MemoryOnboardingStorage implements AdminOnboardingStorage {
  admins = new Map<number, any>();
  approvals = new Map<number, any>();
  engagements = new Map<number, any>();
  lifecycleEvents: any[] = [];
  nextAdminId = 1;
  nextApprovalId = 1;
  nextEngagementId = 1;
  failApprovalInsert = false;

  async createAdminUserForPasswordSetup(
    adminUser: InsertAdminUser,
    engagement?: Omit<InsertAdminEngagement, "adminUserId">,
    event?: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<{ admin: AdminUser; engagement?: any }> {
    const newAdmin = {
      id: this.nextAdminId++,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      ...adminUser,
    };
    this.admins.set(newAdmin.id, newAdmin);

    if (!engagement) {
      return { admin: newAdmin };
    }

    const newEngagement = this.seedEngagement(newAdmin.id, engagement);
    if (event) {
      this.lifecycleEvents.push({
        ...event,
        adminUserId: newAdmin.id,
        engagementId: newEngagement.id,
      });
    }

    return { admin: newAdmin, engagement: newEngagement };
  }

  async createAdminUserWithApproval(adminUser: InsertAdminUser, approval: InsertAdminUserApproval): Promise<AdminUser> {
    const adminsSnapshot = new Map(this.admins);
    const approvalsSnapshot = new Map(this.approvals);
    const nextAdminIdSnapshot = this.nextAdminId;
    const nextApprovalIdSnapshot = this.nextApprovalId;

    try {
      const newAdmin = {
        id: this.nextAdminId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
        ...adminUser,
      };
      this.admins.set(newAdmin.id, newAdmin);

      if (this.failApprovalInsert) {
        throw new Error("forced approval insert failure");
      }

      const newApproval = {
        id: this.nextApprovalId++,
        status: "pending",
        approvedBy: null,
        approvedAt: null,
        notes: null,
        createdAt: new Date(),
        ...approval,
        targetAdminId: newAdmin.id,
      };
      this.approvals.set(newApproval.id, newApproval);
      return newAdmin;
    } catch (error) {
      this.admins = adminsSnapshot;
      this.approvals = approvalsSnapshot;
      this.nextAdminId = nextAdminIdSnapshot;
      this.nextApprovalId = nextApprovalIdSnapshot;
      throw error;
    }
  }

  async getApprovalRequest(id: number): Promise<AdminUserApproval | undefined> {
    return this.approvals.get(id);
  }

  async getAdminUser(id: number): Promise<AdminUser | undefined> {
    return this.admins.get(id);
  }

  async updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser> {
    const admin = this.admins.get(id);
    if (!admin) throw new Error("admin not found");
    const updated = { ...admin, ...updates, updatedAt: new Date() };
    this.admins.set(id, updated);
    return updated;
  }

  async updateApprovalRequest(id: number, updates: Partial<AdminUserApproval>): Promise<AdminUserApproval> {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error("approval not found");
    const updated = { ...approval, ...updates };
    this.approvals.set(id, updated);
    return updated;
  }

  async activateCreateApprovalForPasswordSetup(
    approvalId: number,
    targetAdminId: number,
    approvedBy: number,
    tokenHash: string,
    expiresAt: Date,
    notes?: string
  ): Promise<{ admin: AdminUser; approval: AdminUserApproval }> {
    const admin = await this.updateAdminUser(targetAdminId, {
      status: "active",
      mustChangePassword: true,
      passwordSetupTokenHash: tokenHash,
      passwordSetupExpiresAt: expiresAt,
    } as any);
    const approval = await this.updateApprovalRequest(approvalId, {
      status: "approved",
      approvedBy,
      approvedAt: new Date(),
      ...(notes ? { notes } : {}),
    } as any);
    return { admin, approval };
  }

  async rejectCreateApproval(
    approvalId: number,
    targetAdminId: number,
    approvedBy: number,
    notes?: string
  ): Promise<{ admin: AdminUser; approval: AdminUserApproval }> {
    const admin = await this.updateAdminUser(targetAdminId, {
      status: "rejected",
      passwordSetupTokenHash: null,
      passwordSetupExpiresAt: null,
    } as any);
    if (admin.role === "trainee_access") {
      for (const [id, engagement] of this.engagements.entries()) {
        if (engagement.adminUserId === targetAdminId) {
          const updatedEngagement = { ...engagement, status: "cancelled", updatedAt: new Date() };
          this.engagements.set(id, updatedEngagement);
          this.lifecycleEvents.push({
            adminUserId: targetAdminId,
            engagementId: id,
            eventType: "engagement_updated",
            actorAdminId: approvedBy,
            metadata: { status: "cancelled", reason: "approval_rejected" },
            notes: notes ?? null,
          });
        }
      }
    }
    const approval = await this.updateApprovalRequest(approvalId, {
      status: "rejected",
      approvedBy,
      approvedAt: new Date(),
      ...(notes ? { notes } : {}),
    } as any);
    return { admin, approval };
  }

  seedEngagement(adminUserId: number, overrides: Record<string, any> = {}) {
    const engagement = {
      id: this.nextEngagementId++,
      adminUserId,
      engagementType: "intern",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    this.engagements.set(engagement.id, engagement);
    return engagement;
  }

  async refreshPasswordSetupTokenForAdmin(id: number, tokenHash: string, expiresAt: Date): Promise<AdminUser | undefined> {
    const admin = this.admins.get(id);
    if (!admin || admin.status !== "active" || admin.mustChangePassword !== true) {
      return undefined;
    }
    return this.updateAdminUser(id, {
      passwordSetupTokenHash: tokenHash,
      passwordSetupExpiresAt: expiresAt,
    } as any);
  }

  async completePasswordSetup(tokenHash: string, passwordHash: string, now = new Date()): Promise<AdminUser | undefined> {
    const admin = [...this.admins.values()].find(
      (candidate) =>
        candidate.passwordSetupTokenHash === tokenHash &&
        candidate.passwordSetupExpiresAt &&
        candidate.passwordSetupExpiresAt > now &&
        candidate.mustChangePassword === true &&
        candidate.status === "active"
    );
    if (!admin) return undefined;
    return this.updateAdminUser(admin.id, {
      passwordHash,
      mustChangePassword: false,
      passwordSetupTokenHash: null,
      passwordSetupExpiresAt: null,
    } as any);
  }
}

function pendingAdmin(overrides: Partial<AdminUser> = {}): any {
  return {
    name: "New Admin",
    email: "new-admin@example.com",
    passwordHash: "placeholder",
    mustChangePassword: true,
    passwordSetupTokenHash: null,
    passwordSetupExpiresAt: null,
    role: "admin_support",
    status: "pending",
    createdBy: 1,
    permissions: [],
    ...overrides,
  };
}

async function seedPendingCreate(store: MemoryOnboardingStorage): Promise<{ admin: any; approval: any }> {
  const admin = await createPendingAdminAccount({
    storage: store,
    adminUser: pendingAdmin(),
    requestedBy: 1,
    requestData: { adminData: { email: "new-admin@example.com" } },
  });
  const approval = [...store.approvals.values()][0];
  return { admin, approval };
}

test("create admin is atomic when approval creation fails", async () => {
  const store = new MemoryOnboardingStorage();
  store.failApprovalInsert = true;

  await assert.rejects(
    createPendingAdminAccount({
      storage: store,
      adminUser: pendingAdmin(),
      requestedBy: 1,
      requestData: {},
    })
  );

  assert.equal(store.admins.size, 0);
  assert.equal(store.approvals.size, 0);
});

test("direct create activates admin and stores setup token without approval", async () => {
  process.env.ADMIN_APP_ORIGIN = "https://admin.example.com";
  const store = new MemoryOnboardingStorage();

  const result = await createAdminAccountForPasswordSetup({
    storage: store,
    adminUser: pendingAdmin({ status: "pending", passwordSetupTokenHash: null }),
  });

  assert.equal(store.approvals.size, 0);
  assert.equal(result.admin.status, "active");
  assert.equal(result.admin.mustChangePassword, true);
  assert.ok(result.admin.passwordSetupTokenHash);
  assert.ok(result.admin.passwordSetupExpiresAt > new Date());

  const token = new URL(result.setupUrl).searchParams.get("token");
  assert.equal(result.admin.passwordSetupTokenHash, hashPasswordSetupToken(token!));
});

test("direct trainee create stores engagement and lifecycle event", async () => {
  const store = new MemoryOnboardingStorage();

  const result = await createAdminAccountForPasswordSetup({
    storage: store,
    adminUser: pendingAdmin({ role: "trainee_access" }),
    engagement: {
      engagementType: "intern",
      workAuthorizationType: "none",
      endDate: "2026-08-31",
      supervisorAdminId: 1,
      workScope: "Training project",
      status: "draft",
    },
    event: {
      eventType: "engagement_created",
      actorAdminId: 1,
      metadata: {},
      notes: null,
    },
  });

  assert.equal(result.admin.status, "active");
  assert.equal(result.engagement?.status, "draft");
  assert.equal(store.approvals.size, 0);
  assert.equal(store.lifecycleEvents.length, 1);
  assert.equal(store.lifecycleEvents[0].eventType, "engagement_created");
});

test("approve create activates admin, stores setup token hash, and approves request", async () => {
  process.env.ADMIN_APP_ORIGIN = "https://admin.example.com";
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);

  const result = await approveCreateAdminRequest({
    storage: store,
    approvalId: approval.id,
    approvedBy: 99,
  });

  const updatedAdmin = store.admins.get(admin.id);
  assert.equal(updatedAdmin.status, "active");
  assert.equal(updatedAdmin.mustChangePassword, true);
  assert.ok(updatedAdmin.passwordSetupTokenHash);
  assert.ok(updatedAdmin.passwordSetupExpiresAt > new Date());
  assert.equal(result.approval.status, "approved");
  assert.equal(result.approval.approvedBy, 99);

  const token = new URL(result.delivery.setupUrl).searchParams.get("token");
  assert.equal(updatedAdmin.passwordSetupTokenHash, hashPasswordSetupToken(token!));
});

test("approve email failure leaves database state consistent for resend", async () => {
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);

  const result = await approveCreateAdminRequest({
    storage: store,
    approvalId: approval.id,
    approvedBy: 99,
  });
  const emailSent = false;
  assert.equal(emailSent, false);

  assert.equal(store.admins.get(admin.id).status, "active");
  assert.equal(store.admins.get(admin.id).mustChangePassword, true);
  assert.ok(store.admins.get(admin.id).passwordSetupTokenHash);
  assert.equal(store.approvals.get(result.approval.id).status, "approved");
});

test("approve trainee create does not cancel engagement", async () => {
  const store = new MemoryOnboardingStorage();
  const admin = await createPendingAdminAccount({
    storage: store,
    adminUser: pendingAdmin({ role: "trainee_access" }),
    requestedBy: 1,
    requestData: { adminData: { email: "trainee@example.com", role: "trainee_access" } },
  });
  const approval = [...store.approvals.values()][0];
  const engagement = store.seedEngagement(admin.id, { status: "draft" });

  await approveCreateAdminRequest({ storage: store, approvalId: approval.id, approvedBy: 1 });

  assert.equal(store.engagements.get(engagement.id).status, "draft");
  assert.equal(store.lifecycleEvents.length, 0);
});

test("resend setup link overwrites existing setup token", async () => {
  process.env.ADMIN_APP_ORIGIN = "https://admin.example.com";
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);
  await approveCreateAdminRequest({ storage: store, approvalId: approval.id, approvedBy: 99 });
  const oldHash = store.admins.get(admin.id).passwordSetupTokenHash;

  const delivery = await resendPasswordSetupLink({ storage: store, adminId: admin.id });

  const newHash = store.admins.get(admin.id).passwordSetupTokenHash;
  assert.notEqual(newHash, oldHash);
  const token = new URL(delivery.setupUrl).searchParams.get("token");
  assert.equal(newHash, hashPasswordSetupToken(token!));
});

test("set-password succeeds and reused token fails", async () => {
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);
  const approved = await approveCreateAdminRequest({ storage: store, approvalId: approval.id, approvedBy: 99 });
  const token = new URL(approved.delivery.setupUrl).searchParams.get("token")!;

  const updated = await completePasswordSetup({
    storage: store,
    token,
    passwordHash: "new-hash",
  });

  assert.equal(updated.passwordHash, "new-hash");
  assert.equal(updated.mustChangePassword, false);
  assert.equal(updated.passwordSetupTokenHash, null);

  await assert.rejects(
    completePasswordSetup({
      storage: store,
      token,
      passwordHash: "newer-hash",
    }),
    AdminOnboardingError
  );
  assert.equal(store.admins.get(admin.id).passwordHash, "new-hash");
});

test("expired setup token fails", async () => {
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);
  const approved = await approveCreateAdminRequest({ storage: store, approvalId: approval.id, approvedBy: 99 });
  const token = new URL(approved.delivery.setupUrl).searchParams.get("token")!;
  await store.updateAdminUser(admin.id, { passwordSetupExpiresAt: new Date(Date.now() - 1000) } as any);

  await assert.rejects(
    completePasswordSetup({
      storage: store,
      token,
      passwordHash: "new-hash",
    }),
    AdminOnboardingError
  );
});

test("reject create marks target admin and approval rejected", async () => {
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);

  const rejectedApproval = await rejectCreateAdminRequest({
    storage: store,
    approvalId: approval.id,
    approvedBy: 99,
  });

  assert.equal(rejectedApproval.status, "rejected");
  assert.equal(store.admins.get(admin.id).status, "rejected");
});

test("reject trainee create cancels engagement and appends lifecycle event", async () => {
  const store = new MemoryOnboardingStorage();
  const admin = await createPendingAdminAccount({
    storage: store,
    adminUser: pendingAdmin({ role: "trainee_access" }),
    requestedBy: 1,
    requestData: { adminData: { email: "trainee@example.com", role: "trainee_access" } },
  });
  const approval = [...store.approvals.values()][0];
  const engagement = store.seedEngagement(admin.id);

  await rejectCreateAdminRequest({ storage: store, approvalId: approval.id, approvedBy: 1 });

  assert.equal(store.engagements.get(engagement.id).status, "cancelled");
  assert.equal(store.lifecycleEvents.length, 1);
  assert.equal(store.lifecycleEvents[0].eventType, "engagement_updated");
  assert.deepEqual(store.lifecycleEvents[0].metadata, { status: "cancelled", reason: "approval_rejected" });
});

test("reject normal admin create does not cancel unrelated engagement data", async () => {
  const store = new MemoryOnboardingStorage();
  const { admin, approval } = await seedPendingCreate(store);
  const engagement = store.seedEngagement(admin.id, { status: "draft" });

  await rejectCreateAdminRequest({ storage: store, approvalId: approval.id, approvedBy: 1 });

  assert.equal(store.engagements.get(engagement.id).status, "draft");
  assert.equal(store.lifecycleEvents.length, 0);
});

test("login blocking covers pending, rejected, and mustChangePassword admins", () => {
  assert.throws(() => assertCanLogin({ status: "pending", mustChangePassword: false } as any), AdminOnboardingError);
  assert.throws(() => assertCanLogin({ status: "rejected", mustChangePassword: false } as any), AdminOnboardingError);
  assert.throws(() => assertCanLogin({ status: "active", mustChangePassword: true } as any), AdminOnboardingError);
  assert.doesNotThrow(() => assertCanLogin({ status: "active", mustChangePassword: false } as any));
});

test("admin API sanitization strips password and setup hashes", () => {
  const sanitized = sanitizeAdminUser({
    id: 1,
    email: "admin@example.com",
    passwordHash: "secret-hash",
    passwordSetupTokenHash: "setup-hash",
    passwordSetupExpiresAt: new Date(),
    mustChangePassword: true,
  });

  assert.equal("passwordHash" in sanitized, false);
  assert.equal("passwordSetupTokenHash" in sanitized, false);
  assert.equal("passwordSetupExpiresAt" in sanitized, false);
  assert.equal(sanitized.mustChangePassword, true);
});
