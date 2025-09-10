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
  type GuideApplicationLite,
  type InsertGuideApplicationLite,
  type UpdateGuideApplicationLite,
  type GuideApplicationApproval,
  type InsertGuideApplicationApproval,
  type UpdateGuideApplicationApproval,
  type ApplicationStatus,
  type AdminActionType,
} from "../shared/main-schema";
import { db } from "./db";
import { mainDb } from "./main-db";
import { eq, and, desc, inArray } from "drizzle-orm";

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
  }): Promise<GuideApplicationLite[]>;
  updateGuideApplication(id: string, updates: UpdateGuideApplicationLite): Promise<GuideApplicationLite>;
  
  // Guide application approval operations  
  getGuideApplicationApproval(id: number): Promise<GuideApplicationApproval | undefined>;
  listGuideApplicationApprovals(applicationId?: string): Promise<GuideApplicationApproval[]>;
  createGuideApplicationApproval(approval: InsertGuideApplicationApproval): Promise<GuideApplicationApproval>;
  updateGuideApplicationApproval(id: number, updates: UpdateGuideApplicationApproval): Promise<GuideApplicationApproval>;
  getApplicationApprovalHistory(applicationId: string): Promise<GuideApplicationApproval[]>;
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
}

export const storage = new DatabaseStorage();
