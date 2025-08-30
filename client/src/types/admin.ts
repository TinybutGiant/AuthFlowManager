export type AdminRole = 'super_admin' | 'admin_finance' | 'admin_verifier' | 'admin_support';
export type AdminStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalAction = 'create' | 'change_role' | 'delete';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  createdBy?: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  permissions?: string[];
}

export interface AdminUserApproval {
  id: number;
  targetAdminId: number;
  action: ApprovalAction;
  requestedBy: number;
  approvedBy?: number;
  status: ApprovalStatus;
  requestData?: any;
  createdAt: string;
  approvedAt?: string;
  notes?: string;
}

export const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  admin_finance: ['finance.*'],
  admin_verifier: ['verifier.*'],
  admin_support: ['support.*'],
} as const;

export const ROLE_DISPLAY_NAMES = {
  super_admin: 'Super Admin',
  admin_finance: 'Finance Admin',
  admin_verifier: 'Verifier Admin', 
  admin_support: 'Support Admin',
} as const;
