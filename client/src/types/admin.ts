export type AdminRole = 'super_admin' | 'admin_finance' | 'admin_verifier' | 'admin_support' | 'trainee_access';
export type AdminStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalAction = 'create' | 'change_role' | 'delete';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  mustChangePassword?: boolean;
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

export type EngagementType = 'employee' | 'intern' | 'contractor' | 'advisor' | 'other';
export type EngagementScheduleType = 'full_time' | 'part_time';
export type WorkAuthorizationType = 'none' | 'cpt' | 'opt' | 'stem_opt' | 'other';
export type EngagementStatus = 'draft' | 'invited' | 'active' | 'offboarding' | 'ended' | 'cancelled';
export type AdminLifecycleEventType =
  | 'engagement_created'
  | 'engagement_updated'
  | 'invitation_sent'
  | 'account_activated'
  | 'onboarding_started'
  | 'engagement_activated'
  | 'permission_granted'
  | 'permission_revoked'
  | 'office_hour_attended'
  | 'training_completed'
  | 'offboarding_started'
  | 'access_disabled'
  | 'offboarding_email_sent'
  | 'offboarding_email_failed'
  | 'engagement_ended'
  | 'self_offboarding_requested'
  | 'early_offboarding_started'
  | 'engagement_cancelled'
  | 'activity_log_submitted';
export type AdminActivityType =
  | 'office_hour'
  | 'training'
  | 'learning'
  | 'research'
  | 'documentation'
  | 'draft_work'
  | 'meeting'
  | 'other';
export type AdminActivityLogStatus = 'submitted' | 'reviewed';

export interface AdminEngagement {
  id: number;
  adminUserId: number;
  engagementType: EngagementType;
  scheduleType?: EngagementScheduleType | null;
  workAuthorizationType: WorkAuthorizationType;
  startDate?: string | null;
  endDate?: string | null;
  supervisorAdminId?: number | null;
  workScope?: string | null;
  expectedHoursPerWeek?: number | null;
  status: EngagementStatus;
  endedAt?: string | null;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLifecycleEvent {
  id: number;
  adminUserId: number;
  engagementId?: number | null;
  eventType: AdminLifecycleEventType;
  occurredAt: string;
  actorAdminId?: number | null;
  metadata: Record<string, unknown>;
  notes?: string | null;
  createdAt: string;
}

export interface TraineeEngagement {
  id: number;
  engagement_type: EngagementType;
  schedule_type?: EngagementScheduleType | null;
  work_authorization_type: WorkAuthorizationType;
  start_date?: string | null;
  end_date?: string | null;
  expected_hours_per_week?: number | null;
  work_scope?: string | null;
  status: EngagementStatus;
  ended_at?: string | null;
  supervisor?: {
    id: number;
    name: string;
    email: string;
    role: AdminRole;
  } | null;
}

export interface AdminActivityLog {
  id: number;
  activity_type: AdminActivityType;
  activity_date: string;
  duration_minutes?: number | null;
  summary: string;
  learning_objective?: string | null;
  status: AdminActivityLogStatus;
  reviewed_at?: string | null;
  created_at: string;
}

export const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  admin_finance: ['finance.*'],
  admin_verifier: ['verifier.*'],
  admin_support: ['support.*'],
  trainee_access: [],
} as const;

export const ROLE_DISPLAY_NAMES = {
  super_admin: 'Super Admin',
  admin_finance: 'Finance Admin',
  admin_verifier: 'Verifier Admin', 
  admin_support: 'Support Admin',
  trainee_access: 'Trainee Access',
} as const;

// Guide Application types
export type ApplicationStatus = 'drafted' | 'pending' | 'needs_more_info' | 'approved' | 'rejected';
export type AdminActionType = 'review' | 'approve' | 'reject' | 'require_more_info';

// Qualifications type for guide applications
export interface Qualifications {
  certifications?: Record<string, {
    proof: string; // 文件 URL
    visible: boolean; // 是否可见
    description: string; // 文件描述
  }>;
}

export interface GuideApplication {
  id: string;
  userId: number;
  name: string;
  applicationStatus: ApplicationStatus;
  internalTags: string[] | null;
  qualifications: Qualifications | null;
  flaggedForReview: boolean;
  lockedBy: number | null;
  lockedAt: string | null;
  lockExpiry: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuideApplicationApproval {
  id: number;
  applicationId: string;
  userId: number;
  adminId: number | null;
  adminAction: AdminActionType | null;
  note: string | null;
  userResponse: any | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserResponse {
  description?: string;
  certifications?: Record<string, {
    proof: string;
    description: string;
  }>;
}
