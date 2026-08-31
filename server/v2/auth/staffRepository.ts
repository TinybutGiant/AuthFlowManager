import { and, eq, isNull, sql } from "drizzle-orm";
import {
  adminUserAccessGrants,
  adminUsers,
} from "../db/authflowSchema";
import type { AuthflowWorkerDatabase } from "../db/authflow";
import type {
  StaffPrincipalRepository,
  StaffUserRecord,
} from "./staffPrincipal";

export function createDrizzleStaffPrincipalRepository(
  db: AuthflowWorkerDatabase,
): StaffPrincipalRepository {
  return {
    async findStaffByNormalizedEmail(
      normalizedEmail: string,
    ): Promise<StaffUserRecord | undefined> {
      const [staff] = await db
        .select({
          id: adminUsers.id,
          email: adminUsers.email,
          role: adminUsers.role,
          status: adminUsers.status,
        })
        .from(adminUsers)
        .where(sql`lower(${adminUsers.email}) = ${normalizedEmail}`)
        .limit(1);

      return staff;
    },

    async loadAccessGrants(adminUserId: number) {
      return await db
        .select({
          accessGroup: adminUserAccessGrants.accessGroup,
          revokedAt: adminUserAccessGrants.revokedAt,
        })
        .from(adminUserAccessGrants)
        .where(
          and(
            eq(adminUserAccessGrants.adminUserId, adminUserId),
            isNull(adminUserAccessGrants.revokedAt),
          ),
        );
    },
  };
}
