import type { AdminUser, AdminUserApproval, InsertAdminUser, InsertAdminUserApproval } from "@shared/schema";
import { buildPasswordSetupUrl, createPasswordSetupToken, hashPasswordSetupToken } from "./passwordSetup";

export class AdminOnboardingError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export interface SetupDelivery {
  admin: AdminUser;
  setupUrl: string;
}

export interface AdminOnboardingStorage {
  createAdminUserWithApproval(adminUser: InsertAdminUser, approval: InsertAdminUserApproval): Promise<AdminUser>;
  getApprovalRequest(id: number): Promise<AdminUserApproval | undefined>;
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser>;
  updateApprovalRequest(id: number, updates: Partial<AdminUserApproval>): Promise<AdminUserApproval>;
  activateCreateApprovalForPasswordSetup(
    approvalId: number,
    targetAdminId: number,
    approvedBy: number,
    tokenHash: string,
    expiresAt: Date,
    notes?: string
  ): Promise<{ admin: AdminUser; approval: AdminUserApproval }>;
  rejectCreateApproval(
    approvalId: number,
    targetAdminId: number,
    approvedBy: number,
    notes?: string
  ): Promise<{ admin: AdminUser; approval: AdminUserApproval }>;
  refreshPasswordSetupTokenForAdmin(id: number, tokenHash: string, expiresAt: Date): Promise<AdminUser | undefined>;
  completePasswordSetup(tokenHash: string, passwordHash: string, now?: Date): Promise<AdminUser | undefined>;
}

export function sanitizeAdminUser(adminUser: any) {
  if (!adminUser) return adminUser;
  const {
    passwordHash,
    passwordSetupTokenHash,
    passwordSetupExpiresAt,
    ...safeAdminUser
  } = adminUser;
  return safeAdminUser;
}

export function assertCanLogin(adminUser: Pick<AdminUser, "status" | "mustChangePassword">): void {
  if (adminUser.status !== "active") {
    throw new AdminOnboardingError(401, "Account is not active");
  }
  if (adminUser.mustChangePassword) {
    throw new AdminOnboardingError(403, "Password setup is required. Please use the setup link sent to your email.");
  }
}

export async function createPendingAdminAccount(input: {
  storage: AdminOnboardingStorage;
  adminUser: InsertAdminUser;
  requestedBy: number;
  requestData: any;
}): Promise<AdminUser> {
  return input.storage.createAdminUserWithApproval(input.adminUser, {
    targetAdminId: 0,
    action: "create",
    requestedBy: input.requestedBy,
    requestData: input.requestData,
  });
}

export async function approveCreateAdminRequest(input: {
  storage: AdminOnboardingStorage;
  approvalId: number;
  approvedBy: number;
  notes?: string;
}): Promise<{ approval: AdminUserApproval; delivery: SetupDelivery }> {
  const approval = await input.storage.getApprovalRequest(input.approvalId);
  if (!approval) {
    throw new AdminOnboardingError(404, "Approval request not found");
  }
  if (approval.status !== "pending") {
    throw new AdminOnboardingError(409, "Approval request has already been completed");
  }
  if (approval.action !== "create") {
    throw new AdminOnboardingError(400, "Approval request is not a create-admin request");
  }

  const targetAdmin = await input.storage.getAdminUser(approval.targetAdminId);
  if (!targetAdmin) {
    throw new AdminOnboardingError(404, "Target admin user not found");
  }

  const setupToken = createPasswordSetupToken();
  const result = await input.storage.activateCreateApprovalForPasswordSetup(
    approval.id,
    targetAdmin.id,
    input.approvedBy,
    setupToken.tokenHash,
    setupToken.expiresAt,
    input.notes
  );

  return {
    approval: result.approval,
    delivery: {
      admin: result.admin,
      setupUrl: buildPasswordSetupUrl(setupToken.token),
    },
  };
}

export async function rejectCreateAdminRequest(input: {
  storage: AdminOnboardingStorage;
  approvalId: number;
  approvedBy: number;
  notes?: string;
}): Promise<AdminUserApproval> {
  const approval = await input.storage.getApprovalRequest(input.approvalId);
  if (!approval) {
    throw new AdminOnboardingError(404, "Approval request not found");
  }
  if (approval.status !== "pending") {
    throw new AdminOnboardingError(409, "Approval request has already been completed");
  }
  if (approval.action !== "create") {
    throw new AdminOnboardingError(400, "Approval request is not a create-admin request");
  }

  const result = await input.storage.rejectCreateApproval(
    approval.id,
    approval.targetAdminId,
    input.approvedBy,
    input.notes
  );
  return result.approval;
}

export async function resendPasswordSetupLink(input: {
  storage: AdminOnboardingStorage;
  adminId: number;
}): Promise<SetupDelivery> {
  const admin = await input.storage.getAdminUser(input.adminId);
  if (!admin) {
    throw new AdminOnboardingError(404, "Admin user not found");
  }
  if (admin.status !== "active" || !admin.mustChangePassword) {
    throw new AdminOnboardingError(400, "Admin is not eligible for password setup resend");
  }

  const setupToken = createPasswordSetupToken();
  const updatedAdmin = await input.storage.refreshPasswordSetupTokenForAdmin(
    admin.id,
    setupToken.tokenHash,
    setupToken.expiresAt
  );
  if (!updatedAdmin) {
    throw new AdminOnboardingError(409, "Admin is no longer eligible for password setup resend");
  }

  return {
    admin: updatedAdmin,
    setupUrl: buildPasswordSetupUrl(setupToken.token),
  };
}

export async function completePasswordSetup(input: {
  storage: AdminOnboardingStorage;
  token: string;
  passwordHash: string;
}): Promise<AdminUser> {
  const updatedAdmin = await input.storage.completePasswordSetup(
    hashPasswordSetupToken(input.token),
    input.passwordHash
  );
  if (!updatedAdmin) {
    throw new AdminOnboardingError(400, "Invalid or expired password setup link");
  }
  return updatedAdmin;
}
