import {
  users,
  adminUsers,
  adminUserApprovals,
  type User,
  type InsertUser,
  type AdminUser,
  type InsertAdminUser,
  type AdminUserApproval,
  type InsertAdminUserApproval,
  type AdminRole,
  type AdminStatus,
  type ApprovalStatus,
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
import { eq, and, desc, inArray, lt, or, isNull } from "drizzle-orm";

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
  createAdminUser(adminUser: InsertAdminUser): Promise<AdminUser>;
  updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser>;
  deleteAdminUser(id: number): Promise<void>;
  listAdminUsers(filters?: { role?: AdminRole; status?: AdminStatus }): Promise<AdminUser[]>;
  
  // Admin approval operations
  createApprovalRequest(approval: InsertAdminUserApproval): Promise<AdminUserApproval>;
  getApprovalRequest(id: number): Promise<AdminUserApproval | undefined>;
  listApprovalRequests(filters?: { status?: ApprovalStatus }): Promise<AdminUserApproval[]>;
  updateApprovalRequest(id: number, updates: Partial<AdminUserApproval>): Promise<AdminUserApproval>;
  
  // Admin authentication
  authenticateAdmin(email: string, password: string): Promise<AdminUser | null>;
  
  // Guide application operations
  getGuideApplication(id: string): Promise<GuideApplicationLite | undefined>;
  listGuideApplications(filters?: { 
    status?: ApplicationStatus; 
    flaggedForReview?: boolean;
    userId?: number;
    adminId?: number; // Filter to show only applications this admin can access
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

  async createAdminUser(adminUser: InsertAdminUser): Promise<AdminUser> {
    const [newAdmin] = await db
      .insert(adminUsers)
      .values(adminUser)
      .returning();
    return newAdmin;
  }

  async updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser> {
    const [updatedAdmin] = await db
      .update(adminUsers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning();
    return updatedAdmin;
  }

  async deleteAdminUser(id: number): Promise<void> {
    await db.delete(adminUsers).where(eq(adminUsers.id, id));
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
    adminId?: number; // Filter to show only applications this admin can access
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

    // Filter out applications locked by other admins
    if (filters?.adminId) {
      const now = new Date();
      conditions.push(
        or(
          // No lock exists
          isNull(guideApplicationsLite.lockedBy),
          // Lock has expired
          lt(guideApplicationsLite.lockExpiry, now),
          // Lock is held by this admin
          eq(guideApplicationsLite.lockedBy, filters.adminId)
        )
      );
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
