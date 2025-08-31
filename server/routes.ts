import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireRole, jwtUtils } from "./jwtAuth";
import { insertAdminUserSchema, insertAdminUserApprovalSchema, type AdminRole } from "@shared/schema";
import { z } from "zod";
import bcrypt from 'bcrypt';

// Login/Register schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      console.log('Login attempt for email:', email);
      
      const adminUser = await storage.getAdminUserByEmail(email);
      if (!adminUser) {
        console.log('Admin user not found for email:', email);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      console.log('Found admin user:', { id: adminUser.id, email: adminUser.email, status: adminUser.status });

      const isValid = await jwtUtils.comparePassword(password, adminUser.passwordHash);
      console.log('Password validation result:', isValid);
      
      if (!isValid) {
        console.log('Password validation failed for email:', email);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (adminUser.status !== 'active') {
        console.log('Account not active for email:', email, 'status:', adminUser.status);
        return res.status(401).json({ message: "Account is not active" });
      }

      // Update last login
      await storage.updateAdminUser(adminUser.id, { lastLoginAt: new Date() });

      const token = jwtUtils.generateToken({ userId: adminUser.id.toString(), email: adminUser.email });
      
      res.json({ 
        token, 
        user: { 
          id: adminUser.id, 
          email: adminUser.email, 
          name: adminUser.name,
          role: adminUser.role
        }
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(400).json({ message: "Login failed", error: error?.message });
    }
  });

  // 注册功能已移除 - 管理员账户只能由super_admin创建

  app.get('/api/auth/user', requireAuth, async (req: any, res) => {
    try {
      const adminUser = await storage.getAdminUser(parseInt(req.user.id));
      if (!adminUser) {
        return res.status(404).json({ message: "Admin user not found" });
      }
      
      res.json({
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role,
        status: adminUser.status,
        adminUser: adminUser
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    // For JWT, logout is handled client-side by removing the token
    res.json({ message: "Logged out successfully" });
  });

  // Admin management routes (super_admin only)
  app.get("/api/admin/users", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const { role, status } = req.query;
      const admins = await storage.listAdminUsers({ 
        role: role as any, 
        status: status as any 
      });
      res.json(admins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch admin users" });
    }
  });

  app.get("/api/admin/users/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const admin = await storage.getAdminUser(id);
      if (!admin) {
        return res.status(404).json({ message: "Admin user not found" });
      }
      res.json(admin);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch admin user" });
    }
  });

  app.post("/api/admin/users", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const validatedData = insertAdminUserSchema.parse(req.body);
      
      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(validatedData.passwordHash, saltRounds);
      
      // Create admin user
      const newAdmin = await storage.createAdminUser({
        ...validatedData,
        passwordHash,
        createdBy: req.adminUser.id,
      });
      
      // Create approval request for the new admin
      await storage.createApprovalRequest({
        targetAdminId: newAdmin.id,
        action: 'create',
        requestedBy: req.adminUser.id,
        requestData: {
          adminData: {
            name: newAdmin.name,
            email: newAdmin.email,
            role: newAdmin.role
          }
        }
      });
      
      res.status(201).json(newAdmin);
    } catch (error: any) {
      res.status(400).json({ message: "Failed to create admin user", error: error?.message || 'Unknown error' });
    }
  });

  app.put("/api/admin/users/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      const updatedAdmin = await storage.updateAdminUser(id, updates);
      res.json(updatedAdmin);
    } catch (error) {
      res.status(400).json({ message: "Failed to update admin user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAdminUser(id);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ message: "Failed to delete admin user" });
    }
  });

  // Approval workflow routes
  app.get("/api/admin/approvals", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const { status } = req.query;
      const approvals = await storage.listApprovalRequests({ 
        status: status as any 
      });
      res.json(approvals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch approval requests" });
    }
  });

  app.post("/api/admin/approvals", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const validatedData = insertAdminUserApprovalSchema.parse({
        ...req.body,
        requestedBy: req.adminUser.id,
      });
      
      const approval = await storage.createApprovalRequest(validatedData);
      res.status(201).json(approval);
    } catch (error) {
      res.status(400).json({ message: "Failed to create approval request" });
    }
  });

  app.put("/api/admin/approvals/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes } = req.body;
      
      const updates: any = { status };
      if (status !== 'pending') {
        updates.approvedBy = req.adminUser.id;
        updates.approvedAt = new Date();
      }
      if (notes) {
        updates.notes = notes;
      }
      
      const updatedApproval = await storage.updateApprovalRequest(id, updates);
      res.json(updatedApproval);
    } catch (error) {
      res.status(400).json({ message: "Failed to update approval request" });
    }
  });

  // Dashboard stats route
  app.get("/api/admin/stats", requireAuth, requireRole(['super_admin', 'admin_finance', 'admin_verifier', 'admin_support']), async (req: any, res) => {
    try {
      const totalAdmins = await storage.listAdminUsers({ status: 'active' });
      const pendingApprovals = await storage.listApprovalRequests({ status: 'pending' });
      
      res.json({
        totalAdmins: totalAdmins.length,
        pendingApprovals: pendingApprovals.length,
        activeSessions: 1, // Placeholder for JWT sessions
        systemHealth: "Healthy"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Role-specific management routes
  app.get("/api/admin/finance", requireAuth, requireRole(['super_admin', 'admin_finance']), async (req: any, res) => {
    res.json({ message: "Finance Management" });
  });

  app.get("/api/admin/verifier", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    res.json({ message: "Verifier Management" });
  });

  app.get("/api/admin/support", requireAuth, requireRole(['super_admin', 'admin_support']), async (req: any, res) => {
    res.json({ message: "Support Management" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
