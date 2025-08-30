import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAdminUserSchema, insertAdminUserApprovalSchema, type AdminRole } from "@shared/schema";
import bcrypt from 'bcrypt';

// Role-based authorization middleware
function requireRole(allowedRoles: AdminRole[]) {
  return async (req: any, res: any, next: any) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Get admin user by their Replit user ID (stored in a separate mapping table in real implementation)
      // For now, we'll check if user exists and has proper role
      const user = await storage.getUser(userId);
      if (!user?.email) {
        return res.status(401).json({ message: "User not found" });
      }

      const admin = await storage.getAdminUserByEmail(user.email);
      if (!admin || !allowedRoles.includes(admin.role)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      req.adminUser = admin;
      next();
    } catch (error) {
      res.status(500).json({ message: "Authorization error" });
    }
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Also get admin user info if exists
      let adminUser = null;
      if (user?.email) {
        adminUser = await storage.getAdminUserByEmail(user.email);
      }
      
      res.json({ ...user, adminUser });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Admin management routes (super_admin only)
  app.get("/api/admin/users", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
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

  app.get("/api/admin/users/:id", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
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

  app.post("/api/admin/users", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
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

  app.put("/api/admin/users/:id", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      const updatedAdmin = await storage.updateAdminUser(id, updates);
      res.json(updatedAdmin);
    } catch (error) {
      res.status(400).json({ message: "Failed to update admin user" });
    }
  });

  app.delete("/api/admin/users/:id", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAdminUser(id);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ message: "Failed to delete admin user" });
    }
  });

  // Approval workflow routes
  app.get("/api/admin/approvals", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
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

  app.post("/api/admin/approvals", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
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

  app.put("/api/admin/approvals/:id", isAuthenticated, requireRole(['super_admin']), async (req: any, res) => {
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

  // Role-specific management routes
  app.get("/api/admin/finance", isAuthenticated, requireRole(['super_admin', 'admin_finance']), async (req: any, res) => {
    res.json({ message: "Finance Management" });
  });

  app.get("/api/admin/verifier", isAuthenticated, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    res.json({ message: "Verifier Management" });
  });

  app.get("/api/admin/support", isAuthenticated, requireRole(['super_admin', 'admin_support']), async (req: any, res) => {
    res.json({ message: "Support Management" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
