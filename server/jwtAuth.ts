import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET not set, using default secret for development");
}

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// JWT utility functions
export const jwtUtils = {
  generateToken: (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  },

  verifyToken: (token: string): JWTPayload | null => {
    try {
      return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch (error) {
      return null;
    }
  },

  hashPassword: async (password: string): Promise<string> => {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  },

  comparePassword: async (password: string, hash: string): Promise<boolean> => {
    return await bcrypt.compare(password, hash);
  }
};

// JWT Authentication middleware
export const requireAuth: RequestHandler = async (req: any, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(' ')[1];
    const payload = jwtUtils.verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Get user from database
    const user = await storage.getUser(payload.userId);
    if (!user || user.isActive !== 'true') {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = { ...user, id: payload.userId };
    next();
  } catch (error) {
    return res.status(401).json({ message: "Authentication failed" });
  }
};

// Role-based authorization middleware
export function requireRole(allowedRoles: string[]) {
  return async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get admin user by email
      const admin = await storage.getAdminUserByEmail(req.user.email);
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

export async function setupAuth(app: Express) {
  // No session setup needed for JWT
  console.log('JWT authentication system initialized');
}