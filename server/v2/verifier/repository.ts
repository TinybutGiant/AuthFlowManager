import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  adminActionTypeEnum,
  applicationStatusTypeEnum,
  destinations,
  guideApplicationApprovals,
  guideApplications,
  guideApplicationServiceAreas,
  guideServiceAreaProposals,
  type AdminActionType,
  type ApplicationStatus,
  type DestinationRecord,
  type GuideApplicationApprovalRecord,
  type GuideApplicationRecord,
  type GuideServiceAreaProposalRecord,
} from "./schema";
import {
  createHyperdrivePgClientConfig,
  type WorkerV2Env,
} from "../db/types";

export type GuideVerifierDatabase = NodePgDatabase<{
  applicationStatusTypeEnum: typeof applicationStatusTypeEnum;
  adminActionTypeEnum: typeof adminActionTypeEnum;
  guideApplications: typeof guideApplications;
  destinations: typeof destinations;
  guideApplicationServiceAreas: typeof guideApplicationServiceAreas;
  guideServiceAreaProposals: typeof guideServiceAreaProposals;
  guideApplicationApprovals: typeof guideApplicationApprovals;
}>;

type DrizzleDb = any;

export type GuideVerifierDestination = Pick<
  DestinationRecord,
  | "id"
  | "slug"
  | "countryCode"
  | "nameEn"
  | "nameJa"
  | "nameZhCn"
  | "timezone"
  | "prefectureCode"
  | "prefectureName"
  | "placeType"
  | "status"
  | "sortOrder"
>;

export type GuideApplicationWithServiceAreas = GuideApplicationRecord & {
  serviceAreas: GuideVerifierDestination[];
  serviceAreaDestinationIds: number[];
  serviceAreaProposals: GuideServiceAreaProposalRecord[];
  customServiceAreaProposals: string[];
};

export type GuideApplicationListFilters = {
  status?: ApplicationStatus;
  flaggedForReview?: boolean;
  userId?: number;
};

export type GuideApplicationReviewUpdate = {
  internalTags?: string[] | null;
  flaggedForReview?: boolean;
};

export type CreateGuideApprovalRecord = {
  applicationId: string;
  userId: number;
  adminId: number;
  adminAction: AdminActionType;
  note?: string | null;
};

export type GuideVerifierRepository = {
  transaction<T>(
    work: (repository: GuideVerifierRepository) => Promise<T>,
  ): Promise<T>;
  cleanExpiredLocks(now?: Date): Promise<void>;
  listGuideApplications(
    filters?: GuideApplicationListFilters,
  ): Promise<GuideApplicationRecord[]>;
  getGuideApplication(
    applicationId: string,
  ): Promise<GuideApplicationWithServiceAreas | undefined>;
  acquireApplicationLock(
    applicationId: string,
    adminId: number,
    now?: Date,
  ): Promise<GuideApplicationRecord | undefined>;
  releaseApplicationLock(applicationId: string, adminId: number): Promise<void>;
  isApplicationLockedByOther(
    applicationId: string,
    adminId: number,
    now?: Date,
  ): Promise<boolean>;
  updateApplicationReviewState(
    applicationId: string,
    adminId: number,
    updates: GuideApplicationReviewUpdate,
    now?: Date,
  ): Promise<GuideApplicationRecord | undefined>;
  listDestinations(filters?: {
    countryCode?: string;
    status?: string;
  }): Promise<GuideVerifierDestination[]>;
  listGuideApplicationApprovals(
    applicationId?: string,
  ): Promise<GuideApplicationApprovalRecord[]>;
  createGuideApplicationApproval(
    values: CreateGuideApprovalRecord,
  ): Promise<GuideApplicationApprovalRecord>;
};

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function destinationFields() {
  return {
    id: destinations.id,
    slug: destinations.slug,
    countryCode: destinations.countryCode,
    nameEn: destinations.nameEn,
    nameJa: destinations.nameJa,
    nameZhCn: destinations.nameZhCn,
    timezone: destinations.timezone,
    prefectureCode: destinations.prefectureCode,
    prefectureName: destinations.prefectureName,
    placeType: destinations.placeType,
    status: destinations.status,
    sortOrder: destinations.sortOrder,
  };
}

async function listApplicationServiceAreas(
  database: DrizzleDb,
  applicationId: string,
): Promise<GuideVerifierDestination[]> {
  return await database
    .select(destinationFields())
    .from(guideApplicationServiceAreas)
    .innerJoin(
      destinations,
      eq(guideApplicationServiceAreas.destinationId, destinations.id),
    )
    .where(eq(guideApplicationServiceAreas.applicationId, applicationId))
    .orderBy(asc(destinations.sortOrder), asc(destinations.nameEn));
}

async function listApplicationServiceAreaProposals(
  database: DrizzleDb,
  applicationId: string,
): Promise<GuideServiceAreaProposalRecord[]> {
  return await database
    .select()
    .from(guideServiceAreaProposals)
    .where(eq(guideServiceAreaProposals.applicationId, applicationId))
    .orderBy(asc(guideServiceAreaProposals.id));
}

export function createGuideVerifierRepository(
  database: DrizzleDb,
): GuideVerifierRepository {
  return {
    async transaction(work) {
      return await database.transaction(async (tx: DrizzleDb) =>
        work(createGuideVerifierRepository(tx)),
      );
    },

    async cleanExpiredLocks(now = new Date()) {
      await database
        .update(guideApplications)
        .set({
          lockedBy: null,
          lockedAt: null,
          lockExpiry: null,
          updatedAt: now,
        })
        .where(lt(guideApplications.lockExpiry, now));
    },

    async listGuideApplications(filters = {}) {
      const conditions = [];

      if (filters.status) {
        conditions.push(eq(guideApplications.applicationStatus, filters.status));
      }
      if (filters.flaggedForReview !== undefined) {
        conditions.push(
          eq(guideApplications.flaggedForReview, filters.flaggedForReview),
        );
      }
      if (filters.userId) {
        conditions.push(eq(guideApplications.userId, filters.userId));
      }

      let query = database.select().from(guideApplications).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      return await query.orderBy(desc(guideApplications.updatedAt));
    },

    async getGuideApplication(applicationId) {
      const [application] = await database
        .select()
        .from(guideApplications)
        .where(eq(guideApplications.id, applicationId))
        .limit(1);

      if (!application) return undefined;

      const serviceAreas = await listApplicationServiceAreas(
        database,
        applicationId,
      );
      const serviceAreaProposals = await listApplicationServiceAreaProposals(
        database,
        applicationId,
      );

      return {
        ...application,
        serviceAreas,
        serviceAreaDestinationIds: serviceAreas.map((area) => area.id),
        serviceAreaProposals,
        customServiceAreaProposals: serviceAreaProposals.map(
          (proposal) => proposal.rawName,
        ),
      };
    },

    async acquireApplicationLock(applicationId, adminId, now = new Date()) {
      const lockExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await this.cleanExpiredLocks(now);

      const [updatedApplication] = await database
        .update(guideApplications)
        .set({
          lockedBy: adminId,
          lockedAt: now,
          lockExpiry,
          updatedAt: now,
        })
        .where(
          and(
            eq(guideApplications.id, applicationId),
            or(
              isNull(guideApplications.lockedBy),
              lt(guideApplications.lockExpiry, now),
              eq(guideApplications.lockedBy, adminId),
            ),
          ),
        )
        .returning();

      return updatedApplication;
    },

    async releaseApplicationLock(applicationId, adminId) {
      await database
        .update(guideApplications)
        .set({
          lockedBy: null,
          lockedAt: null,
          lockExpiry: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(guideApplications.id, applicationId),
            eq(guideApplications.lockedBy, adminId),
          ),
        );
    },

    async isApplicationLockedByOther(applicationId, adminId, now = new Date()) {
      const [application] = await database
        .select({
          lockedBy: guideApplications.lockedBy,
          lockExpiry: guideApplications.lockExpiry,
        })
        .from(guideApplications)
        .where(eq(guideApplications.id, applicationId))
        .limit(1);

      return Boolean(
        application?.lockedBy &&
          application.lockExpiry &&
          application.lockExpiry > now &&
          application.lockedBy !== adminId,
      );
    },

    async updateApplicationReviewState(
      applicationId,
      adminId,
      updates,
      now = new Date(),
    ) {
      const [updatedApplication] = await database
        .update(guideApplications)
        .set({
          ...compact(updates),
          updatedAt: now,
        })
        .where(
          and(
            eq(guideApplications.id, applicationId),
            eq(guideApplications.lockedBy, adminId),
            gt(guideApplications.lockExpiry, now),
          ),
        )
        .returning();

      return updatedApplication;
    },

    async listDestinations(filters = {}) {
      const conditions = [];

      if (filters.countryCode) {
        conditions.push(eq(destinations.countryCode, filters.countryCode));
      }
      if (filters.status) {
        conditions.push(eq(destinations.status, filters.status));
      }

      let query = database
        .select(destinationFields())
        .from(destinations)
        .$dynamic();

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      return await query.orderBy(asc(destinations.sortOrder), asc(destinations.nameEn));
    },

    async listGuideApplicationApprovals(applicationId) {
      let query = database
        .select()
        .from(guideApplicationApprovals)
        .$dynamic();

      if (applicationId) {
        query = query.where(
          eq(guideApplicationApprovals.applicationId, applicationId),
        );
      }

      return await query.orderBy(desc(guideApplicationApprovals.createdAt));
    },

    async createGuideApplicationApproval(values) {
      const [approval] = await database
        .insert(guideApplicationApprovals)
        .values(compact(values))
        .returning();

      return approval;
    },
  };
}

export async function withGuideVerifierDatabase<T>(
  env: WorkerV2Env,
  operation: (
    repository: GuideVerifierRepository,
    client: Client,
  ) => Promise<T>,
): Promise<T> {
  const client = new Client(createHyperdrivePgClientConfig(env, "MAIN_DB"));

  let connected = false;
  try {
    await client.connect();
    connected = true;
    const db = drizzle(client, {
      schema: {
        applicationStatusTypeEnum,
        adminActionTypeEnum,
        guideApplications,
        destinations,
        guideApplicationServiceAreas,
        guideServiceAreaProposals,
        guideApplicationApprovals,
      },
    });
    return await operation(createGuideVerifierRepository(db), client);
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}
