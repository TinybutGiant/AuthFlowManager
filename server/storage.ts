import {
  users,
  adminUsers,
  adminUserApprovals,
  adminUserAccessGrants,
  adminEngagements,
  adminLifecycleEvents,
  adminActivityLogs,
  adminEngagementDocuments,
  adminDocumentTemplates,
  type User,
  type InsertUser,
  type AdminUser,
  type InsertAdminUser,
  type AdminUserApproval,
  type InsertAdminUserApproval,
  type AdminEngagement,
  type InsertAdminEngagement,
  type AdminLifecycleEvent,
  type InsertAdminLifecycleEvent,
  type AdminActivityLog,
  type InsertAdminActivityLog,
  type AdminEngagementDocument,
  type InsertAdminEngagementDocument,
  type AdminDocumentTemplate,
  type InsertAdminDocumentTemplate,
  type AdminRole,
  type AdminAccessGroup,
  type AdminStatus,
  type ApprovalStatus,
  type EngagementStatus,
} from "@shared/schema";
import {
  guideApplicationsLite,
  guideApplicationApprovals,
  mainUsers,
  type GuideApplicationLite,
  type InsertGuideApplicationLite,
  type UpdateGuideApplicationLite,
  type GuideApplicationApproval,
  type InsertGuideApplicationApproval,
  type UpdateGuideApplicationApproval,
  type ApplicationStatus,
  type AdminActionType,
  type MainUser,
  type InsertMainUser,
  type UpdateMainUser,
} from "../shared/main-schema";
import { db } from "./db";
import { mainDb } from "./main-db";
import { eq, and, desc, inArray, lt, or, isNull, gt, lte, sql } from "drizzle-orm";
import {
  deriveAccessGroupsFromLegacyRole,
  deriveAccountTypeFromLegacyRole,
  ROLE_DERIVED_ACCESS_GRANT_SOURCE,
  ROLE_DERIVED_ACCESS_GRANT_SOURCES,
} from "./adminAccessModel";

// Interface for storage operations
export interface IStorage {
  // User operations for JWT Auth
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
  
  // Admin user operations
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  getAdminUserByEmail(email: string): Promise<AdminUser | undefined>;
  getAdminUserByPasswordSetupTokenHash(tokenHash: string, now?: Date): Promise<AdminUser | undefined>;
  createAdminUser(adminUser: InsertAdminUser): Promise<AdminUser>;
  createAdminUserForPasswordSetup(
    adminUser: InsertAdminUser,
    engagement?: Omit<InsertAdminEngagement, "adminUserId">,
    event?: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<{ admin: AdminUser; engagement?: AdminEngagement }>;
  createAdminUserWithApproval(adminUser: InsertAdminUser, approval: InsertAdminUserApproval): Promise<AdminUser>;
  createAdminUserWithApprovalAndEngagement(
    adminUser: InsertAdminUser,
    approval: InsertAdminUserApproval,
    engagement: Omit<InsertAdminEngagement, "adminUserId">,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminUser>;
  updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser>;
  deleteAdminUser(id: number): Promise<void>;
  listAdminUsers(filters?: { role?: AdminRole; status?: AdminStatus }): Promise<AdminUser[]>;
  getActiveAccessGroupsForAdminUser(adminUserId: number): Promise<AdminAccessGroup[]>;
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
  
  // Admin approval operations
  createApprovalRequest(approval: InsertAdminUserApproval): Promise<AdminUserApproval>;
  getApprovalRequest(id: number): Promise<AdminUserApproval | undefined>;
  listApprovalRequests(filters?: { status?: ApprovalStatus }): Promise<AdminUserApproval[]>;
  updateApprovalRequest(id: number, updates: Partial<AdminUserApproval>): Promise<AdminUserApproval>;

  // Admin engagement and lifecycle operations
  listAdminEngagements(adminUserId: number): Promise<AdminEngagement[]>;
  getAdminEngagement(id: number): Promise<AdminEngagement | undefined>;
  createAdminEngagementWithEvent(
    engagement: InsertAdminEngagement,
    event: InsertAdminLifecycleEvent
  ): Promise<AdminEngagement>;
  updateAdminEngagementWithEvent(
    id: number,
    updates: Partial<AdminEngagement>,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminEngagement | undefined>;
  listAdminLifecycleEvents(adminUserId: number): Promise<AdminLifecycleEvent[]>;
  createAdminLifecycleEvent(event: InsertAdminLifecycleEvent): Promise<AdminLifecycleEvent>;
  getCurrentTraineeEngagement(adminUserId: number): Promise<AdminEngagement | undefined>;
  listAdminActivityLogs(adminUserId: number): Promise<AdminActivityLog[]>;
  listAdminActivityLogsForEngagement(engagementId: number): Promise<AdminActivityLog[]>;
  createAdminActivityLogWithEvent(
    activityLog: InsertAdminActivityLog,
    event?: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminActivityLog>;
  listAdminEngagementDocuments(engagementId: number): Promise<AdminEngagementDocument[]>;
  listTraineeEngagementDocuments(adminUserId: number): Promise<AdminEngagementDocument[]>;
  listAdminDocumentTemplates(filters?: { documentType?: string }): Promise<AdminDocumentTemplate[]>;
  getAdminDocumentTemplate(id: number): Promise<AdminDocumentTemplate | undefined>;
  createAdminDocumentTemplate(template: InsertAdminDocumentTemplate): Promise<AdminDocumentTemplate>;
  updateAdminDocumentTemplate(id: number, updates: Partial<AdminDocumentTemplate>): Promise<AdminDocumentTemplate | undefined>;
  getAdminEngagementDocument(id: number): Promise<AdminEngagementDocument | undefined>;
  getAdminEngagementDocumentForEngagement(
    engagementId: number,
    documentId: number
  ): Promise<AdminEngagementDocument | undefined>;
  getTraineeEngagementDocument(
    adminUserId: number,
    documentId: number
  ): Promise<AdminEngagementDocument | undefined>;
  createAdminEngagementDocumentWithEvent(
    document: InsertAdminEngagementDocument,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminEngagementDocument>;
  updateAdminEngagementDocument(
    id: number,
    updates: Partial<AdminEngagementDocument>
  ): Promise<AdminEngagementDocument | undefined>;
  updateAdminEngagementDocumentWithEvent(
    id: number,
    updates: Partial<AdminEngagementDocument>,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminEngagementDocument | undefined>;
  markOfferLetterViewed(
    documentId: number,
    adminUserId: number,
    now: Date
  ): Promise<AdminEngagementDocument | undefined>;
  markOfferLetterAccepted(
    documentId: number,
    adminUserId: number,
    input: { now: Date; ip?: string | null; userAgent?: string | null }
  ): Promise<AdminEngagementDocument | undefined>;
  hasAcceptedOfferLetterForEngagement(engagementId: number): Promise<boolean>;
  listDueTraineeEngagementsForActivation(now: Date): Promise<AdminEngagement[]>;
  listExpiredActiveTraineeEngagements(now: Date): Promise<AdminEngagement[]>;
  activateTraineeEngagementLifecycle(engagementId: number, now: Date): Promise<boolean>;
  offboardTraineeEngagementLifecycle(engagementId: number, now: Date): Promise<boolean>;
  selfOffboardTraineeEngagement(
    adminUserId: number,
    input: { reason?: string | null; now?: Date }
  ): Promise<{ status: "ended" | "cancelled" | "already_ended"; engagement?: AdminEngagement }>;
  
  // Admin authentication
  authenticateAdmin(email: string, password: string): Promise<AdminUser | null>;
  
  // Guide application operations
  getGuideApplication(id: string): Promise<GuideApplicationLite | undefined>;
  listGuideApplications(filters?: { 
    status?: ApplicationStatus; 
    flaggedForReview?: boolean;
    userId?: number;
  }): Promise<GuideApplicationLite[]>;
  updateGuideApplication(id: string, updates: UpdateGuideApplicationLite): Promise<GuideApplicationLite>;
  
  // Exclusive lock operations
  acquireApplicationLock(applicationId: string, adminId: number): Promise<GuideApplicationLite | null>;
  releaseApplicationLock(applicationId: string, adminId: number): Promise<void>;
  cleanExpiredLocks(): Promise<void>;
  isApplicationLockedByOther(applicationId: string, adminId: number): Promise<boolean>;
  
  // Guide application approval operations  
  getGuideApplicationApproval(id: number): Promise<GuideApplicationApproval | undefined>;
  listGuideApplicationApprovals(applicationId?: string): Promise<GuideApplicationApproval[]>;
  createGuideApplicationApproval(approval: InsertGuideApplicationApproval): Promise<GuideApplicationApproval>;
  updateGuideApplicationApproval(id: number, updates: UpdateGuideApplicationApproval): Promise<GuideApplicationApproval>;
  getApplicationApprovalHistory(applicationId: string): Promise<GuideApplicationApproval[]>;
  
  // User operations for main database
  getMainUser(id: number): Promise<MainUser | undefined>;
  createMainUser(user: InsertMainUser): Promise<MainUser>;
  updateMainUser(id: number, updates: UpdateMainUser): Promise<MainUser>;
  updateUserGuideStatus(userId: number, isGuide: boolean): Promise<MainUser>;
}

export class DatabaseStorage implements IStorage {
  private buildAdminUserInsert(adminUser: InsertAdminUser): InsertAdminUser {
    return {
      ...adminUser,
      accountType: adminUser.accountType ?? deriveAccountTypeFromLegacyRole(adminUser.role),
    };
  }

  private async createRoleDerivedAccessGrants(
    tx: Pick<typeof db, "insert">,
    adminUserId: number,
    role: AdminRole,
    grantedBy?: number | null,
  ) {
    const accessGroups = deriveAccessGroupsFromLegacyRole(role);
    if (accessGroups.length === 0) {
      return;
    }

    await tx
      .insert(adminUserAccessGrants)
      .values(
        accessGroups.map((accessGroup) => ({
          adminUserId,
          accessGroup,
          source: ROLE_DERIVED_ACCESS_GRANT_SOURCE,
          metadata: { legacyRole: role },
          grantedBy: grantedBy ?? null,
        })),
      )
      .onConflictDoNothing();
  }

  private async syncRoleDerivedAccessGrants(
    tx: Pick<typeof db, "insert" | "update">,
    adminUserId: number,
    role: AdminRole,
  ) {
    const now = new Date();
    await tx
      .update(adminUserAccessGrants)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(adminUserAccessGrants.adminUserId, adminUserId),
          isNull(adminUserAccessGrants.revokedAt),
          inArray(adminUserAccessGrants.source, ROLE_DERIVED_ACCESS_GRANT_SOURCES),
        ),
      );

    await this.createRoleDerivedAccessGrants(tx, adminUserId, role);
  }

  private async createTraineeWorkspaceGrantForAcceptedOffer(
    tx: Pick<typeof db, "insert">,
    input: { adminUserId: number; engagementId: number; documentId: number },
  ) {
    await tx
      .insert(adminUserAccessGrants)
      .values({
        adminUserId: input.adminUserId,
        accessGroup: "trainee_workspace",
        source: "offer_accepted",
        metadata: {
          documentId: input.documentId,
          engagementId: input.engagementId,
        },
        grantedBy: input.adminUserId,
      })
      .onConflictDoNothing();
  }

  private async revokeActiveTraineeAccessGrants(
    tx: Pick<typeof db, "update">,
    adminUserId: number,
    input: { revokedBy?: number | null; now?: Date } = {},
  ) {
    const now = input.now ?? new Date();
    await tx
      .update(adminUserAccessGrants)
      .set({
        revokedAt: now,
        revokedBy: input.revokedBy ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(adminUserAccessGrants.adminUserId, adminUserId),
          inArray(adminUserAccessGrants.accessGroup, ["trainee_offer_portal", "trainee_workspace"]),
          isNull(adminUserAccessGrants.revokedAt),
        ),
      );
  }

  // User operations for JWT Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  // Admin user operations
  async getAdminUser(id: number): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
    return admin;
  }

  async getAdminUserByEmail(email: string): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    return admin;
  }

  async getAdminUserByPasswordSetupTokenHash(
    tokenHash: string,
    now = new Date()
  ): Promise<AdminUser | undefined> {
    const [admin] = await db
      .select()
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.passwordSetupTokenHash, tokenHash),
          gt(adminUsers.passwordSetupExpiresAt, now)
        )
      );
    return admin;
  }

  async createAdminUser(adminUser: InsertAdminUser): Promise<AdminUser> {
    return await db.transaction(async (tx) => {
      const adminInsert = this.buildAdminUserInsert(adminUser);
      const [newAdmin] = await tx
        .insert(adminUsers)
        .values(adminInsert)
        .returning();

      await this.createRoleDerivedAccessGrants(tx, newAdmin.id, newAdmin.role, newAdmin.createdBy);
      return newAdmin;
    });
  }

  async createAdminUserForPasswordSetup(
    adminUser: InsertAdminUser,
    engagement?: Omit<InsertAdminEngagement, "adminUserId">,
    event?: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<{ admin: AdminUser; engagement?: AdminEngagement }> {
    return await db.transaction(async (tx) => {
      const adminInsert = this.buildAdminUserInsert(adminUser);
      const [newAdmin] = await tx
        .insert(adminUsers)
        .values(adminInsert)
        .returning();

      await this.createRoleDerivedAccessGrants(tx, newAdmin.id, newAdmin.role, newAdmin.createdBy);

      if (!engagement) {
        return { admin: newAdmin };
      }

      const [newEngagement] = await tx
        .insert(adminEngagements)
        .values({
          ...engagement,
          adminUserId: newAdmin.id,
        })
        .returning();

      if (event) {
        await tx.insert(adminLifecycleEvents).values({
          ...event,
          adminUserId: newAdmin.id,
          engagementId: newEngagement.id,
        });
      }

      return { admin: newAdmin, engagement: newEngagement };
    });
  }

  async createAdminUserWithApproval(
    adminUser: InsertAdminUser,
    approval: InsertAdminUserApproval
  ): Promise<AdminUser> {
    return await db.transaction(async (tx) => {
      const adminInsert = this.buildAdminUserInsert(adminUser);
      const [newAdmin] = await tx
        .insert(adminUsers)
        .values(adminInsert)
        .returning();

      await this.createRoleDerivedAccessGrants(tx, newAdmin.id, newAdmin.role, newAdmin.createdBy);

      await tx.insert(adminUserApprovals).values({
        ...approval,
        targetAdminId: newAdmin.id,
      });

      return newAdmin;
    });
  }

  async createAdminUserWithApprovalAndEngagement(
    adminUser: InsertAdminUser,
    approval: InsertAdminUserApproval,
    engagement: Omit<InsertAdminEngagement, "adminUserId">,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminUser> {
    return await db.transaction(async (tx) => {
      const adminInsert = this.buildAdminUserInsert(adminUser);
      const [newAdmin] = await tx
        .insert(adminUsers)
        .values(adminInsert)
        .returning();

      await this.createRoleDerivedAccessGrants(tx, newAdmin.id, newAdmin.role, newAdmin.createdBy);

      await tx.insert(adminUserApprovals).values({
        ...approval,
        targetAdminId: newAdmin.id,
      });

      const [newEngagement] = await tx
        .insert(adminEngagements)
        .values({
          ...engagement,
          adminUserId: newAdmin.id,
        })
        .returning();

      await tx.insert(adminLifecycleEvents).values({
        ...event,
        adminUserId: newAdmin.id,
        engagementId: newEngagement.id,
      });

      return newAdmin;
    });
  }

  async updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser> {
    return await db.transaction(async (tx) => {
      const nextUpdates = {
        ...updates,
        ...(updates.role ? { accountType: deriveAccountTypeFromLegacyRole(updates.role) } : {}),
        updatedAt: new Date(),
      };

      const [updatedAdmin] = await tx
        .update(adminUsers)
        .set(nextUpdates)
        .where(eq(adminUsers.id, id))
        .returning();

      if (updatedAdmin && updates.role) {
        await this.syncRoleDerivedAccessGrants(tx, updatedAdmin.id, updatedAdmin.role);
      }

      return updatedAdmin;
    });
  }

  async deleteAdminUser(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      const ownedEngagements = await tx
        .select({ id: adminEngagements.id })
        .from(adminEngagements)
        .where(eq(adminEngagements.adminUserId, id));
      const ownedEngagementIds = ownedEngagements.map((engagement) => engagement.id);
      const ownedEngagementFilter = ownedEngagementIds.length > 0
        ? inArray(adminEngagements.id, ownedEngagementIds)
        : undefined;
      const ownedDocumentFilter = ownedEngagementIds.length > 0
        ? or(
            eq(adminEngagementDocuments.adminUserId, id),
            inArray(adminEngagementDocuments.engagementId, ownedEngagementIds),
          )
        : eq(adminEngagementDocuments.adminUserId, id);
      const ownedActivityLogFilter = ownedEngagementIds.length > 0
        ? or(
            eq(adminActivityLogs.adminUserId, id),
            inArray(adminActivityLogs.engagementId, ownedEngagementIds),
          )
        : eq(adminActivityLogs.adminUserId, id);
      const ownedLifecycleEventFilter = ownedEngagementIds.length > 0
        ? or(
            eq(adminLifecycleEvents.adminUserId, id),
            inArray(adminLifecycleEvents.engagementId, ownedEngagementIds),
          )
        : eq(adminLifecycleEvents.adminUserId, id);

      await tx
        .update(adminUsers)
        .set({ createdBy: null, updatedAt: new Date() })
        .where(eq(adminUsers.createdBy, id));

      await tx
        .update(adminUserAccessGrants)
        .set({ grantedBy: null, revokedBy: null, updatedAt: new Date() })
        .where(or(eq(adminUserAccessGrants.grantedBy, id), eq(adminUserAccessGrants.revokedBy, id)));

      await tx
        .update(adminDocumentTemplates)
        .set({ createdBy: null, updatedAt: new Date() })
        .where(eq(adminDocumentTemplates.createdBy, id));

      await tx
        .update(adminEngagements)
        .set({ supervisorAdminId: null, createdBy: null, updatedAt: new Date() })
        .where(or(eq(adminEngagements.supervisorAdminId, id), eq(adminEngagements.createdBy, id)));

      await tx
        .update(adminActivityLogs)
        .set({ reviewedBy: null, updatedAt: new Date() })
        .where(eq(adminActivityLogs.reviewedBy, id));

      await tx
        .update(adminEngagementDocuments)
        .set({ acceptedBy: null, voidedBy: null, createdBy: null, updatedAt: new Date() })
        .where(or(
          eq(adminEngagementDocuments.acceptedBy, id),
          eq(adminEngagementDocuments.voidedBy, id),
          eq(adminEngagementDocuments.createdBy, id),
        ));

      await tx
        .update(adminLifecycleEvents)
        .set({ actorAdminId: null })
        .where(eq(adminLifecycleEvents.actorAdminId, id));

      await tx.delete(adminEngagementDocuments).where(ownedDocumentFilter);
      await tx.delete(adminActivityLogs).where(ownedActivityLogFilter);
      await tx.delete(adminLifecycleEvents).where(ownedLifecycleEventFilter);
      await tx.delete(adminUserAccessGrants).where(eq(adminUserAccessGrants.adminUserId, id));
      await tx.delete(adminUserApprovals).where(eq(adminUserApprovals.targetAdminId, id));
      if (ownedEngagementFilter) {
        await tx.delete(adminEngagements).where(ownedEngagementFilter);
      }
      await tx.delete(adminUsers).where(eq(adminUsers.id, id));
    });
  }

  async listAdminUsers(filters?: { role?: AdminRole; status?: AdminStatus }): Promise<AdminUser[]> {
    const conditions = [];
    if (filters?.role) {
      conditions.push(eq(adminUsers.role, filters.role));
    }
    if (filters?.status) {
      conditions.push(eq(adminUsers.status, filters.status));
    }

    if (conditions.length > 0) {
      return await db.select().from(adminUsers).where(and(...conditions)).orderBy(desc(adminUsers.createdAt));
    }

    return await db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt));
  }

  async getActiveAccessGroupsForAdminUser(adminUserId: number): Promise<AdminAccessGroup[]> {
    const grants = await db
      .select({ accessGroup: adminUserAccessGrants.accessGroup })
      .from(adminUserAccessGrants)
      .where(
        and(
          eq(adminUserAccessGrants.adminUserId, adminUserId),
          isNull(adminUserAccessGrants.revokedAt),
        ),
      );

    return grants.map((grant) => grant.accessGroup as AdminAccessGroup);
  }

  async activateCreateApprovalForPasswordSetup(
    approvalId: number,
    targetAdminId: number,
    approvedBy: number,
    tokenHash: string,
    expiresAt: Date,
    notes?: string
  ): Promise<{ admin: AdminUser; approval: AdminUserApproval }> {
    return await db.transaction(async (tx) => {
      const [admin] = await tx
        .update(adminUsers)
        .set({
          status: 'active',
          mustChangePassword: true,
          passwordSetupTokenHash: tokenHash,
          passwordSetupExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(adminUsers.id, targetAdminId))
        .returning();

      if (!admin) {
        throw new Error('Target admin user not found');
      }

      const [approval] = await tx
        .update(adminUserApprovals)
        .set({
          status: 'approved',
          approvedBy,
          approvedAt: new Date(),
          ...(notes ? { notes } : {}),
        })
        .where(
          and(
            eq(adminUserApprovals.id, approvalId),
            eq(adminUserApprovals.status, 'pending'),
            eq(adminUserApprovals.action, 'create')
          )
        )
        .returning();

      if (!approval) {
        throw new Error('Approval request not found');
      }

      return { admin, approval };
    });
  }

  async rejectCreateApproval(
    approvalId: number,
    targetAdminId: number,
    approvedBy: number,
    notes?: string
  ): Promise<{ admin: AdminUser; approval: AdminUserApproval }> {
    return await db.transaction(async (tx) => {
      const [admin] = await tx
        .update(adminUsers)
        .set({
          status: 'rejected',
          passwordSetupTokenHash: null,
          passwordSetupExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(adminUsers.id, targetAdminId))
        .returning();

      if (!admin) {
        throw new Error('Target admin user not found');
      }

      const [approval] = await tx
        .update(adminUserApprovals)
        .set({
          status: 'rejected',
          approvedBy,
          approvedAt: new Date(),
          ...(notes ? { notes } : {}),
        })
        .where(
          and(
            eq(adminUserApprovals.id, approvalId),
            eq(adminUserApprovals.status, 'pending'),
            eq(adminUserApprovals.action, 'create')
          )
        )
        .returning();

      if (!approval) {
        throw new Error('Approval request not found');
      }

      if (admin.role === 'trainee_access') {
        await this.revokeActiveTraineeAccessGrants(tx, targetAdminId, { revokedBy: approvedBy });

        const cancelledEngagements = await tx
          .update(adminEngagements)
          .set({
            status: 'cancelled',
            updatedAt: new Date(),
          })
          .where(eq(adminEngagements.adminUserId, targetAdminId))
          .returning();

        if (cancelledEngagements.length > 0) {
          await tx.insert(adminLifecycleEvents).values(
            cancelledEngagements.map((engagement) => ({
              adminUserId: targetAdminId,
              engagementId: engagement.id,
              eventType: 'engagement_updated',
              actorAdminId: approvedBy,
              metadata: { status: 'cancelled', reason: 'approval_rejected' },
              notes: notes ?? null,
            }))
          );
        }
      }

      return { admin, approval };
    });
  }

  async refreshPasswordSetupTokenForAdmin(
    id: number,
    tokenHash: string,
    expiresAt: Date
  ): Promise<AdminUser | undefined> {
    const [admin] = await db
      .update(adminUsers)
      .set({
        passwordSetupTokenHash: tokenHash,
        passwordSetupExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adminUsers.id, id),
          eq(adminUsers.status, 'active'),
          eq(adminUsers.mustChangePassword, true)
        )
      )
      .returning();
    return admin;
  }

  async completePasswordSetup(
    tokenHash: string,
    passwordHash: string,
    now = new Date()
  ): Promise<AdminUser | undefined> {
    const [admin] = await db
      .update(adminUsers)
      .set({
        passwordHash,
        mustChangePassword: false,
        passwordSetupTokenHash: null,
        passwordSetupExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(adminUsers.passwordSetupTokenHash, tokenHash),
          eq(adminUsers.mustChangePassword, true),
          eq(adminUsers.status, 'active'),
          gt(adminUsers.passwordSetupExpiresAt, now)
        )
      )
      .returning();
    return admin;
  }

  // Admin approval operations
  async createApprovalRequest(approval: InsertAdminUserApproval): Promise<AdminUserApproval> {
    const [newApproval] = await db
      .insert(adminUserApprovals)
      .values(approval)
      .returning();
    return newApproval;
  }

  async getApprovalRequest(id: number): Promise<AdminUserApproval | undefined> {
    const [approval] = await db.select().from(adminUserApprovals).where(eq(adminUserApprovals.id, id));
    return approval;
  }

  async listApprovalRequests(filters?: { status?: ApprovalStatus }): Promise<AdminUserApproval[]> {
    if (filters?.status) {
      return await db.select().from(adminUserApprovals).where(eq(adminUserApprovals.status, filters.status)).orderBy(desc(adminUserApprovals.createdAt));
    }

    return await db.select().from(adminUserApprovals).orderBy(desc(adminUserApprovals.createdAt));
  }

  async updateApprovalRequest(id: number, updates: Partial<AdminUserApproval>): Promise<AdminUserApproval> {
    const [updatedApproval] = await db
      .update(adminUserApprovals)
      .set(updates)
      .where(eq(adminUserApprovals.id, id))
      .returning();
    return updatedApproval;
  }

  async listAdminEngagements(adminUserId: number): Promise<AdminEngagement[]> {
    return await db
      .select()
      .from(adminEngagements)
      .where(eq(adminEngagements.adminUserId, adminUserId))
      .orderBy(desc(adminEngagements.createdAt));
  }

  async getAdminEngagement(id: number): Promise<AdminEngagement | undefined> {
    const [engagement] = await db
      .select()
      .from(adminEngagements)
      .where(eq(adminEngagements.id, id));
    return engagement;
  }

  async createAdminEngagementWithEvent(
    engagement: InsertAdminEngagement,
    event: InsertAdminLifecycleEvent
  ): Promise<AdminEngagement> {
    return await db.transaction(async (tx) => {
      const [newEngagement] = await tx
        .insert(adminEngagements)
        .values(engagement)
        .returning();

      await tx.insert(adminLifecycleEvents).values({
        ...event,
        adminUserId: newEngagement.adminUserId,
        engagementId: newEngagement.id,
      });

      return newEngagement;
    });
  }

  async updateAdminEngagementWithEvent(
    id: number,
    updates: Partial<AdminEngagement>,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminEngagement | undefined> {
    return await db.transaction(async (tx) => {
      const [updatedEngagement] = await tx
        .update(adminEngagements)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(adminEngagements.id, id))
        .returning();

      if (!updatedEngagement) {
        return undefined;
      }

      await tx.insert(adminLifecycleEvents).values({
        ...event,
        adminUserId: updatedEngagement.adminUserId,
        engagementId: updatedEngagement.id,
      });

      return updatedEngagement;
    });
  }

  async listAdminLifecycleEvents(adminUserId: number): Promise<AdminLifecycleEvent[]> {
    return await db
      .select()
      .from(adminLifecycleEvents)
      .where(eq(adminLifecycleEvents.adminUserId, adminUserId))
      .orderBy(desc(adminLifecycleEvents.occurredAt));
  }

  async createAdminLifecycleEvent(event: InsertAdminLifecycleEvent): Promise<AdminLifecycleEvent> {
    const [newEvent] = await db
      .insert(adminLifecycleEvents)
      .values(event)
      .returning();
    return newEvent;
  }

  async getCurrentTraineeEngagement(adminUserId: number): Promise<AdminEngagement | undefined> {
    const engagements = await db
      .select()
      .from(adminEngagements)
      .where(
        and(
          eq(adminEngagements.adminUserId, adminUserId),
          inArray(adminEngagements.status, ['active', 'invited', 'draft'])
        )
      )
      .orderBy(desc(adminEngagements.createdAt));

    return (
      engagements.find((engagement) => engagement.status === 'active') ??
      engagements.find((engagement) => engagement.status === 'invited') ??
      engagements[0]
    );
  }

  async listAdminActivityLogs(adminUserId: number): Promise<AdminActivityLog[]> {
    return await db
      .select()
      .from(adminActivityLogs)
      .where(eq(adminActivityLogs.adminUserId, adminUserId))
      .orderBy(desc(adminActivityLogs.activityDate), desc(adminActivityLogs.createdAt));
  }

  async listAdminActivityLogsForEngagement(engagementId: number): Promise<AdminActivityLog[]> {
    return await db
      .select()
      .from(adminActivityLogs)
      .where(eq(adminActivityLogs.engagementId, engagementId))
      .orderBy(desc(adminActivityLogs.activityDate), desc(adminActivityLogs.createdAt));
  }

  async createAdminActivityLogWithEvent(
    activityLog: InsertAdminActivityLog,
    event?: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminActivityLog> {
    return await db.transaction(async (tx) => {
      const [newActivityLog] = await tx
        .insert(adminActivityLogs)
        .values(activityLog)
        .returning();

      if (event) {
        const eventMetadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? event.metadata as Record<string, unknown>
          : {};
        const metadata = event.eventType === 'activity_log_submitted'
          ? { ...eventMetadata, activity_log_id: newActivityLog.id }
          : eventMetadata;

        await tx.insert(adminLifecycleEvents).values({
          ...event,
          metadata,
          adminUserId: newActivityLog.adminUserId,
          engagementId: newActivityLog.engagementId,
        });
      }

      return newActivityLog;
    });
  }

  async listAdminDocumentTemplates(filters?: { documentType?: string }): Promise<AdminDocumentTemplate[]> {
    if (filters?.documentType) {
      return await db
        .select()
        .from(adminDocumentTemplates)
        .where(eq(adminDocumentTemplates.documentType, filters.documentType))
        .orderBy(desc(adminDocumentTemplates.updatedAt), desc(adminDocumentTemplates.createdAt));
    }

    return await db
      .select()
      .from(adminDocumentTemplates)
      .orderBy(desc(adminDocumentTemplates.updatedAt), desc(adminDocumentTemplates.createdAt));
  }

  async getAdminDocumentTemplate(id: number): Promise<AdminDocumentTemplate | undefined> {
    const [template] = await db
      .select()
      .from(adminDocumentTemplates)
      .where(eq(adminDocumentTemplates.id, id));
    return template;
  }

  async createAdminDocumentTemplate(template: InsertAdminDocumentTemplate): Promise<AdminDocumentTemplate> {
    const [created] = await db
      .insert(adminDocumentTemplates)
      .values(template)
      .returning();
    return created;
  }

  async updateAdminDocumentTemplate(
    id: number,
    updates: Partial<AdminDocumentTemplate>
  ): Promise<AdminDocumentTemplate | undefined> {
    const [template] = await db
      .update(adminDocumentTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(adminDocumentTemplates.id, id))
      .returning();
    return template;
  }

  async listAdminEngagementDocuments(engagementId: number): Promise<AdminEngagementDocument[]> {
    return await db
      .select()
      .from(adminEngagementDocuments)
      .where(eq(adminEngagementDocuments.engagementId, engagementId))
      .orderBy(desc(adminEngagementDocuments.version), desc(adminEngagementDocuments.createdAt));
  }

  async listTraineeEngagementDocuments(adminUserId: number): Promise<AdminEngagementDocument[]> {
    return await db
      .select()
      .from(adminEngagementDocuments)
      .where(eq(adminEngagementDocuments.adminUserId, adminUserId))
      .orderBy(desc(adminEngagementDocuments.version), desc(adminEngagementDocuments.createdAt));
  }

  async getAdminEngagementDocument(id: number): Promise<AdminEngagementDocument | undefined> {
    const [document] = await db
      .select()
      .from(adminEngagementDocuments)
      .where(eq(adminEngagementDocuments.id, id));
    return document;
  }

  async getAdminEngagementDocumentForEngagement(
    engagementId: number,
    documentId: number
  ): Promise<AdminEngagementDocument | undefined> {
    const [document] = await db
      .select()
      .from(adminEngagementDocuments)
      .where(
        and(
          eq(adminEngagementDocuments.id, documentId),
          eq(adminEngagementDocuments.engagementId, engagementId)
        )
      );
    return document;
  }

  async getTraineeEngagementDocument(
    adminUserId: number,
    documentId: number
  ): Promise<AdminEngagementDocument | undefined> {
    const [document] = await db
      .select()
      .from(adminEngagementDocuments)
      .where(
        and(
          eq(adminEngagementDocuments.id, documentId),
          eq(adminEngagementDocuments.adminUserId, adminUserId)
        )
      );
    return document;
  }

  private safeDocumentEventMetadata(
    document: Pick<AdminEngagementDocument, "id" | "documentType" | "version" | "status">,
    metadata?: unknown
  ) {
    const base = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
    return {
      ...base,
      document_id: document.id,
      document_type: document.documentType,
      document_version: document.version,
      document_status: document.status,
    };
  }

  async createAdminEngagementDocumentWithEvent(
    document: InsertAdminEngagementDocument,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminEngagementDocument> {
    return await db.transaction(async (tx) => {
      const [newDocument] = await tx
        .insert(adminEngagementDocuments)
        .values(document)
        .returning();

      await tx.insert(adminLifecycleEvents).values({
        ...event,
        adminUserId: newDocument.adminUserId,
        engagementId: newDocument.engagementId,
        metadata: this.safeDocumentEventMetadata(newDocument, event.metadata),
      });

      return newDocument;
    });
  }

  async updateAdminEngagementDocument(
    id: number,
    updates: Partial<AdminEngagementDocument>
  ): Promise<AdminEngagementDocument | undefined> {
    const [document] = await db
      .update(adminEngagementDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(adminEngagementDocuments.id, id))
      .returning();
    return document;
  }

  async updateAdminEngagementDocumentWithEvent(
    id: number,
    updates: Partial<AdminEngagementDocument>,
    event: Omit<InsertAdminLifecycleEvent, "adminUserId" | "engagementId">
  ): Promise<AdminEngagementDocument | undefined> {
    return await db.transaction(async (tx) => {
      const [document] = await tx
        .update(adminEngagementDocuments)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(adminEngagementDocuments.id, id))
        .returning();

      if (!document) {
        return undefined;
      }

      await tx.insert(adminLifecycleEvents).values({
        ...event,
        adminUserId: document.adminUserId,
        engagementId: document.engagementId,
        metadata: this.safeDocumentEventMetadata(document, event.metadata),
      });

      return document;
    });
  }

  async markOfferLetterViewed(
    documentId: number,
    adminUserId: number,
    now: Date
  ): Promise<AdminEngagementDocument | undefined> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(adminEngagementDocuments)
        .where(
          and(
            eq(adminEngagementDocuments.id, documentId),
            eq(adminEngagementDocuments.adminUserId, adminUserId)
          )
        );

      if (!existing || existing.status !== "sent") {
        return existing;
      }

      const [document] = await tx
        .update(adminEngagementDocuments)
        .set({
          status: "viewed",
          viewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(adminEngagementDocuments.id, documentId),
            eq(adminEngagementDocuments.adminUserId, adminUserId),
            eq(adminEngagementDocuments.status, "sent")
          )
        )
        .returning();

      if (!document) {
        const [current] = await tx
          .select()
          .from(adminEngagementDocuments)
          .where(
            and(
              eq(adminEngagementDocuments.id, documentId),
              eq(adminEngagementDocuments.adminUserId, adminUserId)
            )
          );
        return current;
      }

      await tx.insert(adminLifecycleEvents).values({
        adminUserId,
        engagementId: document.engagementId,
        eventType: "offer_letter_viewed",
        occurredAt: now,
        actorAdminId: adminUserId,
        metadata: this.safeDocumentEventMetadata(document),
        notes: null,
      });

      return document;
    });
  }

  async markOfferLetterAccepted(
    documentId: number,
    adminUserId: number,
    input: { now: Date; ip?: string | null; userAgent?: string | null }
  ): Promise<AdminEngagementDocument | undefined> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(adminEngagementDocuments)
        .where(
          and(
            eq(adminEngagementDocuments.id, documentId),
            eq(adminEngagementDocuments.adminUserId, adminUserId)
          )
        );

      if (existing?.status === "accepted") {
        await this.createTraineeWorkspaceGrantForAcceptedOffer(tx, {
          adminUserId,
          engagementId: existing.engagementId,
          documentId: existing.id,
        });
        return existing;
      }

      if (!existing || !["sent", "viewed"].includes(existing.status)) {
        return existing;
      }

      const [document] = await tx
        .update(adminEngagementDocuments)
        .set({
          status: "accepted",
          acceptedAt: input.now,
          acceptedBy: adminUserId,
          acceptedIp: input.ip ?? null,
          acceptedUserAgent: input.userAgent ?? null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(adminEngagementDocuments.id, documentId),
            eq(adminEngagementDocuments.adminUserId, adminUserId),
            inArray(adminEngagementDocuments.status, ["sent", "viewed"])
          )
        )
        .returning();

      if (!document) {
        const [current] = await tx
          .select()
          .from(adminEngagementDocuments)
          .where(
            and(
              eq(adminEngagementDocuments.id, documentId),
              eq(adminEngagementDocuments.adminUserId, adminUserId)
            )
          );
        return current;
      }

      await tx.insert(adminLifecycleEvents).values({
        adminUserId,
        engagementId: document.engagementId,
        eventType: "offer_letter_accepted",
        occurredAt: input.now,
        actorAdminId: adminUserId,
        metadata: this.safeDocumentEventMetadata(document),
        notes: null,
      });

      await this.createTraineeWorkspaceGrantForAcceptedOffer(tx, {
        adminUserId,
        engagementId: document.engagementId,
        documentId: document.id,
      });

      return document;
    });
  }

  async hasAcceptedOfferLetterForEngagement(engagementId: number): Promise<boolean> {
    const [row] = await db
      .select({ id: adminEngagementDocuments.id })
      .from(adminEngagementDocuments)
      .where(
        and(
          eq(adminEngagementDocuments.engagementId, engagementId),
          eq(adminEngagementDocuments.documentType, "offer_letter"),
          eq(adminEngagementDocuments.status, "accepted"),
          isNull(adminEngagementDocuments.voidedAt),
          sql`${adminEngagementDocuments.acceptedAt} IS NOT NULL`
        )
      )
      .limit(1);

    return Boolean(row);
  }

  async listDueTraineeEngagementsForActivation(now: Date): Promise<AdminEngagement[]> {
    const today = now.toISOString().slice(0, 10);
    const rows = await db
      .select({ engagement: adminEngagements })
      .from(adminEngagements)
      .innerJoin(adminUsers, eq(adminUsers.id, adminEngagements.adminUserId))
      .where(
        and(
          eq(adminUsers.role, 'trainee_access'),
          eq(adminUsers.status, 'active'),
          inArray(adminEngagements.status, ['draft', 'invited']),
          lte(adminEngagements.startDate, today),
          sql`exists (
            select 1
            from admin_engagement_documents d
            where d.engagement_id = ${adminEngagements.id}
              and d.document_type = 'offer_letter'
              and d.status = 'accepted'
              and d.accepted_at is not null
              and d.voided_at is null
          )`
        )
      )
      .orderBy(desc(adminEngagements.createdAt));

    return rows.map((row) => row.engagement);
  }

  async listExpiredActiveTraineeEngagements(now: Date): Promise<AdminEngagement[]> {
    const today = now.toISOString().slice(0, 10);
    const rows = await db
      .select({ engagement: adminEngagements })
      .from(adminEngagements)
      .innerJoin(adminUsers, eq(adminUsers.id, adminEngagements.adminUserId))
      .where(
        and(
          eq(adminUsers.role, 'trainee_access'),
          eq(adminEngagements.status, 'active'),
          lt(adminEngagements.endDate, today)
        )
      )
      .orderBy(desc(adminEngagements.createdAt));

    return rows.map((row) => row.engagement);
  }

  async activateTraineeEngagementLifecycle(engagementId: number, now: Date): Promise<boolean> {
    const today = now.toISOString().slice(0, 10);
    return await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ engagement: adminEngagements, admin: adminUsers })
        .from(adminEngagements)
        .innerJoin(adminUsers, eq(adminUsers.id, adminEngagements.adminUserId))
        .where(
          and(
            eq(adminEngagements.id, engagementId),
            eq(adminUsers.role, 'trainee_access'),
            eq(adminUsers.status, 'active'),
            lte(adminEngagements.startDate, today),
            inArray(adminEngagements.status, ['draft', 'invited']),
            sql`exists (
              select 1
              from admin_engagement_documents d
              where d.engagement_id = ${adminEngagements.id}
                and d.document_type = 'offer_letter'
                and d.status = 'accepted'
                and d.accepted_at is not null
                and d.voided_at is null
            )`
          )
        );

      if (!candidate) {
        return false;
      }

      const [updatedEngagement] = await tx
        .update(adminEngagements)
        .set({
          status: 'active',
          updatedAt: now,
        })
        .where(
          and(
            eq(adminEngagements.id, engagementId),
            inArray(adminEngagements.status, ['draft', 'invited'])
          )
        )
        .returning();

      if (!updatedEngagement) {
        return false;
      }

      const metadata = {
        previous_status: candidate.engagement.status,
        new_status: 'active',
        start_date: updatedEngagement.startDate,
      };

      await tx.insert(adminLifecycleEvents).values([
        {
          adminUserId: updatedEngagement.adminUserId,
          engagementId: updatedEngagement.id,
          eventType: 'onboarding_started',
          occurredAt: now,
          actorAdminId: null,
          metadata: {
            ...metadata,
          },
          notes: null,
        },
        {
          adminUserId: updatedEngagement.adminUserId,
          engagementId: updatedEngagement.id,
          eventType: 'engagement_activated',
          occurredAt: now,
          actorAdminId: null,
          metadata: {
            ...metadata,
          },
          notes: null,
        },
      ]);

      return true;
    });
  }

  async offboardTraineeEngagementLifecycle(engagementId: number, now: Date): Promise<boolean> {
    const today = now.toISOString().slice(0, 10);
    return await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ engagement: adminEngagements, admin: adminUsers })
        .from(adminEngagements)
        .innerJoin(adminUsers, eq(adminUsers.id, adminEngagements.adminUserId))
        .where(
          and(
            eq(adminEngagements.id, engagementId),
            eq(adminUsers.role, 'trainee_access'),
            eq(adminEngagements.status, 'active'),
            lt(adminEngagements.endDate, today)
          )
        );

      if (!candidate) {
        return false;
      }

      const [offboardingEngagement] = await tx
        .update(adminEngagements)
        .set({
          status: 'offboarding',
          updatedAt: now,
        })
        .where(
          and(
            eq(adminEngagements.id, engagementId),
            eq(adminEngagements.status, 'active')
          )
        )
        .returning();

      if (!offboardingEngagement) {
        return false;
      }

      await tx.insert(adminLifecycleEvents).values({
        adminUserId: offboardingEngagement.adminUserId,
        engagementId: offboardingEngagement.id,
        eventType: 'offboarding_started',
        occurredAt: now,
        actorAdminId: null,
        metadata: {
          previous_status: 'active',
          new_status: 'offboarding',
          end_date: offboardingEngagement.endDate,
        },
        notes: null,
      });

      const alreadyInactive = candidate.admin.status !== 'active';
      if (!alreadyInactive) {
        await tx
          .update(adminUsers)
          .set({
            status: 'inactive',
            updatedAt: now,
          })
          .where(
            and(
              eq(adminUsers.id, offboardingEngagement.adminUserId),
              eq(adminUsers.role, 'trainee_access'),
              eq(adminUsers.status, 'active')
            )
          )
          .returning();
      }

      await this.revokeActiveTraineeAccessGrants(tx, offboardingEngagement.adminUserId, { now });

      await tx.insert(adminLifecycleEvents).values({
        adminUserId: offboardingEngagement.adminUserId,
        engagementId: offboardingEngagement.id,
        eventType: 'access_disabled',
        occurredAt: now,
        actorAdminId: null,
        metadata: {
          previous_status: candidate.admin.status,
          new_status: alreadyInactive ? candidate.admin.status : 'inactive',
          end_date: offboardingEngagement.endDate,
          already_inactive: alreadyInactive,
        },
        notes: null,
      });

      const [endedEngagement] = await tx
        .update(adminEngagements)
        .set({
          status: 'ended',
          endedAt: now,
          updatedAt: now,
        })
        .where(eq(adminEngagements.id, offboardingEngagement.id))
        .returning();

      await tx.insert(adminLifecycleEvents).values({
        adminUserId: endedEngagement.adminUserId,
        engagementId: endedEngagement.id,
        eventType: 'engagement_ended',
        occurredAt: now,
        actorAdminId: null,
        metadata: {
          previous_status: 'offboarding',
          new_status: 'ended',
          end_date: endedEngagement.endDate,
        },
        notes: null,
      });

      return true;
    });
  }

  async selfOffboardTraineeEngagement(
    adminUserId: number,
    input: { reason?: string | null; now?: Date }
  ): Promise<{ status: "ended" | "cancelled" | "already_ended"; engagement?: AdminEngagement }> {
    const now = input.now ?? new Date();
    const reason = input.reason?.trim() || null;

    return await db.transaction(async (tx) => {
      const engagements = await tx
        .select()
        .from(adminEngagements)
        .where(
          and(
            eq(adminEngagements.adminUserId, adminUserId),
            inArray(adminEngagements.status, ['active', 'invited', 'draft'])
          )
        )
        .orderBy(desc(adminEngagements.createdAt));

      const engagement =
        engagements.find((candidate) => candidate.status === 'active') ??
        engagements.find((candidate) => candidate.status === 'invited') ??
        engagements[0];

      if (!engagement) {
        return { status: "already_ended" as const };
      }

      if (engagement.status === 'active') {
        const [offboardingEngagement] = await tx
          .update(adminEngagements)
          .set({
            status: 'offboarding',
            updatedAt: now,
          })
          .where(
            and(
              eq(adminEngagements.id, engagement.id),
              eq(adminEngagements.status, 'active')
            )
          )
          .returning();

        if (!offboardingEngagement) {
          return { status: "already_ended" as const };
        }

        await tx.insert(adminLifecycleEvents).values({
          adminUserId,
          engagementId: engagement.id,
          eventType: 'self_offboarding_requested',
          occurredAt: now,
          actorAdminId: adminUserId,
          metadata: {
            previous_status: engagement.status,
            reason,
          },
          notes: reason,
        });

        await tx.insert(adminLifecycleEvents).values({
          adminUserId,
          engagementId: engagement.id,
          eventType: 'early_offboarding_started',
          occurredAt: now,
          actorAdminId: adminUserId,
          metadata: {
            previous_status: 'active',
            new_status: 'offboarding',
            reason,
          },
          notes: null,
        });

        await tx
          .update(adminUsers)
          .set({
            status: 'inactive',
            updatedAt: now,
          })
          .where(
            and(
              eq(adminUsers.id, adminUserId),
              eq(adminUsers.role, 'trainee_access')
            )
          );

        await this.revokeActiveTraineeAccessGrants(tx, adminUserId, {
          revokedBy: adminUserId,
          now,
        });

        await tx.insert(adminLifecycleEvents).values({
          adminUserId,
          engagementId: engagement.id,
          eventType: 'access_disabled',
          occurredAt: now,
          actorAdminId: adminUserId,
          metadata: {
            previous_status: 'active',
            new_status: 'inactive',
            reason,
          },
          notes: null,
        });

        const [endedEngagement] = await tx
          .update(adminEngagements)
          .set({
            status: 'ended',
            endedAt: now,
            updatedAt: now,
          })
          .where(eq(adminEngagements.id, engagement.id))
          .returning();

        await tx.insert(adminLifecycleEvents).values({
          adminUserId,
          engagementId: engagement.id,
          eventType: 'engagement_ended',
          occurredAt: now,
          actorAdminId: adminUserId,
          metadata: {
            previous_status: 'offboarding',
            new_status: 'ended',
            reason,
          },
          notes: null,
        });

        return { status: "ended" as const, engagement: endedEngagement };
      }

      const [cancelledEngagement] = await tx
        .update(adminEngagements)
        .set({
          status: 'cancelled',
          endedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(adminEngagements.id, engagement.id),
            inArray(adminEngagements.status, ['draft', 'invited'])
          )
        )
        .returning();

      if (!cancelledEngagement) {
        return { status: "already_ended" as const };
      }

      await tx.insert(adminLifecycleEvents).values({
        adminUserId,
        engagementId: engagement.id,
        eventType: 'self_offboarding_requested',
        occurredAt: now,
        actorAdminId: adminUserId,
        metadata: {
          previous_status: engagement.status,
          reason,
        },
        notes: reason,
      });

      await tx.insert(adminLifecycleEvents).values({
        adminUserId,
        engagementId: engagement.id,
        eventType: 'engagement_cancelled',
        occurredAt: now,
        actorAdminId: adminUserId,
        metadata: {
          previous_status: engagement.status,
          new_status: 'cancelled',
          reason,
        },
        notes: null,
      });

      await tx
        .update(adminUsers)
        .set({
          status: 'inactive',
          updatedAt: now,
        })
        .where(
          and(
            eq(adminUsers.id, adminUserId),
            eq(adminUsers.role, 'trainee_access')
          )
        );

      await this.revokeActiveTraineeAccessGrants(tx, adminUserId, {
        revokedBy: adminUserId,
        now,
      });

      await tx.insert(adminLifecycleEvents).values({
        adminUserId,
        engagementId: engagement.id,
        eventType: 'access_disabled',
        occurredAt: now,
        actorAdminId: adminUserId,
        metadata: {
          previous_status: 'active',
          new_status: 'inactive',
          reason,
        },
        notes: null,
      });

      return { status: "cancelled" as const, engagement: cancelledEngagement };
    });
  }

  // Admin authentication (placeholder - would use bcrypt in real implementation)
  async authenticateAdmin(email: string, password: string): Promise<AdminUser | null> {
    const admin = await this.getAdminUserByEmail(email);
    if (!admin) return null;
    
    // In real implementation, use bcrypt.compare(password, admin.passwordHash)
    // For now, this is a placeholder
    return admin.status === 'active' ? admin : null;
  }

  // Guide application operations
  async getGuideApplication(id: string): Promise<GuideApplicationLite | undefined> {
    const [application] = await mainDb.select().from(guideApplicationsLite).where(eq(guideApplicationsLite.id, id));
    return application;
  }

  async listGuideApplications(filters?: { 
    status?: ApplicationStatus; 
    flaggedForReview?: boolean;
    userId?: number;
  }): Promise<GuideApplicationLite[]> {
    const conditions = [];
    
    if (filters?.status) {
      conditions.push(eq(guideApplicationsLite.applicationStatus, filters.status));
    }
    if (filters?.flaggedForReview !== undefined) {
      conditions.push(eq(guideApplicationsLite.flaggedForReview, filters.flaggedForReview));
    }
    if (filters?.userId) {
      conditions.push(eq(guideApplicationsLite.userId, filters.userId));
    }

    if (conditions.length > 0) {
      return await mainDb.select()
        .from(guideApplicationsLite)
        .where(and(...conditions))
        .orderBy(desc(guideApplicationsLite.updatedAt));
    }

    return await mainDb.select()
      .from(guideApplicationsLite)
      .orderBy(desc(guideApplicationsLite.updatedAt));
  }

  async updateGuideApplication(id: string, updates: UpdateGuideApplicationLite): Promise<GuideApplicationLite> {
    const [updatedApplication] = await mainDb
      .update(guideApplicationsLite)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(guideApplicationsLite.id, id))
      .returning();
    return updatedApplication;
  }

  // Guide application approval operations  
  async getGuideApplicationApproval(id: number): Promise<GuideApplicationApproval | undefined> {
    const [approval] = await mainDb.select().from(guideApplicationApprovals).where(eq(guideApplicationApprovals.id, id));
    return approval;
  }

  async listGuideApplicationApprovals(applicationId?: string): Promise<GuideApplicationApproval[]> {
    if (applicationId) {
      return await mainDb.select()
        .from(guideApplicationApprovals)
        .where(eq(guideApplicationApprovals.applicationId, applicationId))
        .orderBy(desc(guideApplicationApprovals.createdAt));
    }

    return await mainDb.select()
      .from(guideApplicationApprovals)
      .orderBy(desc(guideApplicationApprovals.createdAt));
  }

  async createGuideApplicationApproval(approval: InsertGuideApplicationApproval): Promise<GuideApplicationApproval> {
    const [newApproval] = await mainDb
      .insert(guideApplicationApprovals)
      .values(approval)
      .returning();
    return newApproval;
  }

  async updateGuideApplicationApproval(id: number, updates: UpdateGuideApplicationApproval): Promise<GuideApplicationApproval> {
    const [updatedApproval] = await mainDb
      .update(guideApplicationApprovals)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(guideApplicationApprovals.id, id))
      .returning();
    return updatedApproval;
  }

  async getApplicationApprovalHistory(applicationId: string): Promise<GuideApplicationApproval[]> {
    return await mainDb.select()
      .from(guideApplicationApprovals)
      .where(eq(guideApplicationApprovals.applicationId, applicationId))
      .orderBy(desc(guideApplicationApprovals.createdAt));
  }

  // Exclusive lock operations
  async acquireApplicationLock(applicationId: string, adminId: number): Promise<GuideApplicationLite | null> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    // First, clean expired locks
    await this.cleanExpiredLocks();

    // Atomic conditional update - acquire lock only if:
    // 1. Application exists AND
    // 2. (No current lock OR lock expired OR lock owned by this admin)
    const [updatedApplication] = await mainDb
      .update(guideApplicationsLite)
      .set({
        lockedBy: adminId,
        lockedAt: now,
        lockExpiry: lockExpiry,
        updatedAt: now,
      })
      .where(
        and(
          eq(guideApplicationsLite.id, applicationId),
          or(
            // No current lock
            isNull(guideApplicationsLite.lockedBy),
            // Lock has expired
            lt(guideApplicationsLite.lockExpiry, now),
            // Lock is owned by this admin
            eq(guideApplicationsLite.lockedBy, adminId)
          )
        )
      )
      .returning();

    // Return null if no rows were updated (application doesn't exist or is locked by another admin)
    return updatedApplication || null;
  }

  async releaseApplicationLock(applicationId: string, adminId: number): Promise<void> {
    await mainDb
      .update(guideApplicationsLite)
      .set({
        lockedBy: null,
        lockedAt: null,
        lockExpiry: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(guideApplicationsLite.id, applicationId),
          eq(guideApplicationsLite.lockedBy, adminId)
        )
      );
  }

  async cleanExpiredLocks(): Promise<void> {
    const now = new Date();
    await mainDb
      .update(guideApplicationsLite)
      .set({
        lockedBy: null,
        lockedAt: null,
        lockExpiry: null,
        updatedAt: now,
      })
      .where(lt(guideApplicationsLite.lockExpiry, now));
  }

  async isApplicationLockedByOther(applicationId: string, adminId: number): Promise<boolean> {
    const now = new Date();
    const [application] = await mainDb.select()
      .from(guideApplicationsLite)
      .where(eq(guideApplicationsLite.id, applicationId));

    if (!application) return false;

    return !!(application.lockedBy && 
             application.lockExpiry && 
             application.lockExpiry > now &&
             application.lockedBy !== adminId);
  }

  // User operations for main database
  async getMainUser(id: number): Promise<MainUser | undefined> {
    const [user] = await mainDb.select().from(mainUsers).where(eq(mainUsers.id, id));
    return user;
  }

  async createMainUser(user: InsertMainUser): Promise<MainUser> {
    const [newUser] = await mainDb.insert(mainUsers).values(user).returning();
    return newUser;
  }

  async updateMainUser(id: number, updates: UpdateMainUser): Promise<MainUser> {
    const [updatedUser] = await mainDb
      .update(mainUsers)
      .set(updates)
      .where(eq(mainUsers.id, id))
      .returning();
    return updatedUser;
  }

  async updateUserGuideStatus(userId: number, isGuide: boolean): Promise<MainUser> {
    const [updatedUser] = await mainDb
      .update(mainUsers)
      .set({ is_guide: isGuide })
      .where(eq(mainUsers.id, userId))
      .returning();
    return updatedUser;
  }
}

export const storage = new DatabaseStorage();
