import {
  users,
  adminUsers,
  adminUserApprovals,
  type User,
  type UpsertUser,
  type AdminUser,
  type InsertAdminUser,
  type AdminUserApproval,
  type InsertAdminUserApproval,
  type AdminRole,
  type AdminStatus,
  type ApprovalStatus,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, inArray } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations (IMPORTANT: mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
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
}

export class DatabaseStorage implements IStorage {
  // User operations (IMPORTANT: mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
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
    let query = db.select().from(adminUsers);
    
    const conditions = [];
    if (filters?.role) {
      conditions.push(eq(adminUsers.role, filters.role));
    }
    if (filters?.status) {
      conditions.push(eq(adminUsers.status, filters.status));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return await query.orderBy(desc(adminUsers.createdAt));
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
    let query = db.select().from(adminUserApprovals);
    
    if (filters?.status) {
      query = query.where(eq(adminUserApprovals.status, filters.status));
    }

    return await query.orderBy(desc(adminUserApprovals.createdAt));
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
}

export const storage = new DatabaseStorage();
