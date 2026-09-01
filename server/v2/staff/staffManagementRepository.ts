import type { Client } from "pg";
import type {
  AdminAccessGroup,
  AdminRole,
  AdminStatus,
} from "../../../shared/schema";
import type {
  StaffManagementRepository,
  V2StaffRecord,
} from "./staffManagement";
import { V2_STAFF_ASSIGNABLE_ACCESS_GROUPS } from "./permissions";

const STAFF_ACCOUNT_TYPE = "admin_staff";
const V2_STAFF_MANAGEMENT_SOURCE = "v2_staff_management";

type StaffRow = {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  account_type: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type GrantRow = {
  admin_user_id: number;
  access_group: AdminAccessGroup;
};

function serializeTimestamp(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function mapStaffRow(
  row: StaffRow,
  accessGroups: AdminAccessGroup[],
): V2StaffRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    accountType: row.account_type,
    accessGroups,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at),
  };
}

async function loadActiveGrantsByStaffId(
  client: Client,
  staffIds: number[],
): Promise<Map<number, AdminAccessGroup[]>> {
  const grantsByStaffId = new Map<number, AdminAccessGroup[]>();

  for (const staffId of staffIds) {
    grantsByStaffId.set(staffId, []);
  }

  if (staffIds.length === 0) {
    return grantsByStaffId;
  }

  const result = await client.query<GrantRow>(
    `
      SELECT "admin_user_id", "access_group"
      FROM "admin_user_access_grants"
      WHERE "admin_user_id" = ANY($1::integer[])
        AND "revoked_at" IS NULL
      ORDER BY "access_group"
    `,
    [staffIds],
  );

  for (const row of result.rows) {
    const accessGroups = grantsByStaffId.get(row.admin_user_id) ?? [];
    accessGroups.push(row.access_group);
    grantsByStaffId.set(row.admin_user_id, accessGroups);
  }

  return grantsByStaffId;
}

async function loadStaffRow(
  client: Client,
  id: number,
): Promise<StaffRow | undefined> {
  const result = await client.query<StaffRow>(
    `
      SELECT
        "id",
        "name",
        "email",
        "role",
        "status",
        "account_type",
        "created_at",
        "updated_at"
      FROM "admin_users"
      WHERE "id" = $1
        AND "account_type" = $2
      LIMIT 1
    `,
    [id, STAFF_ACCOUNT_TYPE],
  );

  return result.rows[0];
}

async function mapStaffWithGrants(
  client: Client,
  row: StaffRow,
): Promise<V2StaffRecord> {
  const grantsByStaffId = await loadActiveGrantsByStaffId(client, [row.id]);
  return mapStaffRow(row, grantsByStaffId.get(row.id) ?? []);
}

async function insertLifecycleEvent(
  client: Client,
  adminUserId: number,
  eventType: string,
  actorAdminId: number,
  metadata: Record<string, unknown>,
  notes: string | null = null,
) {
  await client.query(
    `
      INSERT INTO "admin_lifecycle_events" (
        "admin_user_id",
        "event_type",
        "actor_admin_id",
        "metadata",
        "notes",
        "occurred_at",
        "created_at"
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, now(), now())
    `,
    [adminUserId, eventType, actorAdminId, JSON.stringify(metadata), notes],
  );
}

async function insertGrant(
  client: Client,
  adminUserId: number,
  accessGroup: AdminAccessGroup,
  actorAdminId: number,
) {
  await client.query(
    `
      INSERT INTO "admin_user_access_grants" (
        "admin_user_id",
        "access_group",
        "source",
        "metadata",
        "granted_by",
        "granted_at",
        "created_at",
        "updated_at"
      )
      VALUES ($1, $2, $3, '{}'::jsonb, $4, now(), now(), now())
    `,
    [
      adminUserId,
      accessGroup,
      V2_STAFF_MANAGEMENT_SOURCE,
      actorAdminId,
    ],
  );

  await insertLifecycleEvent(
    client,
    adminUserId,
    "permission_granted",
    actorAdminId,
    { accessGroup },
    "V2 staff management grant update.",
  );
}

async function replaceGrantsInOpenTransaction(
  client: Client,
  adminUserId: number,
  nextAccessGroups: AdminAccessGroup[],
  actorAdminId: number,
) {
  const lockedStaff = await client.query<{ id: number }>(
    `
      SELECT "id"
      FROM "admin_users"
      WHERE "id" = $1
        AND "account_type" = $2
      FOR UPDATE
    `,
    [adminUserId, STAFF_ACCOUNT_TYPE],
  );

  if (!lockedStaff.rows[0]) {
    return false;
  }

  const current = await client.query<{ access_group: AdminAccessGroup }>(
    `
      SELECT "access_group"
      FROM "admin_user_access_grants"
      WHERE "admin_user_id" = $1
        AND "revoked_at" IS NULL
      FOR UPDATE
    `,
    [adminUserId],
  );
  const currentAccessGroups = new Set(
    current.rows.map((row) => row.access_group),
  );
  const nextAccessGroupSet = new Set(nextAccessGroups);

  const revoked = await client.query<{ access_group: AdminAccessGroup }>(
    `
      UPDATE "admin_user_access_grants"
      SET
        "revoked_at" = now(),
        "revoked_by" = $2,
        "updated_at" = now()
      WHERE "admin_user_id" = $1
        AND "revoked_at" IS NULL
        AND "access_group" = ANY($4::text[])
        AND NOT ("access_group" = ANY($3::text[]))
      RETURNING "access_group"
    `,
    [
      adminUserId,
      actorAdminId,
      nextAccessGroups,
      V2_STAFF_ASSIGNABLE_ACCESS_GROUPS,
    ],
  );

  for (const row of revoked.rows) {
    await insertLifecycleEvent(
      client,
      adminUserId,
      "permission_revoked",
      actorAdminId,
      { accessGroup: row.access_group },
      "V2 staff management grant update.",
    );
  }

  for (const accessGroup of nextAccessGroups) {
    if (currentAccessGroups.has(accessGroup)) {
      continue;
    }

    if (nextAccessGroupSet.has(accessGroup)) {
      await insertGrant(client, adminUserId, accessGroup, actorAdminId);
    }
  }

  return true;
}

async function withTransaction<T>(
  client: Client,
  operation: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");

  try {
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function createPgStaffManagementRepository(
  client: Client,
): StaffManagementRepository {
  return {
    async listStaff() {
      const staff = await client.query<StaffRow>(
        `
          SELECT
            "id",
            "name",
            "email",
            "role",
            "status",
            "account_type",
            "created_at",
            "updated_at"
          FROM "admin_users"
          WHERE "account_type" = $1
          ORDER BY
            CASE "status"
              WHEN 'active' THEN 0
              WHEN 'inactive' THEN 1
              ELSE 2
            END,
            lower("email")
        `,
        [STAFF_ACCOUNT_TYPE],
      );
      const grantsByStaffId = await loadActiveGrantsByStaffId(
        client,
        staff.rows.map((row) => row.id),
      );

      return staff.rows.map((row) =>
        mapStaffRow(row, grantsByStaffId.get(row.id) ?? []),
      );
    },

    async getStaffById(id: number) {
      const row = await loadStaffRow(client, id);
      if (!row) {
        return undefined;
      }

      return await mapStaffWithGrants(client, row);
    },

    async findStaffByNormalizedEmail(normalizedEmail: string) {
      const result = await client.query<StaffRow>(
        `
          SELECT
            "id",
            "name",
            "email",
            "role",
            "status",
            "account_type",
            "created_at",
            "updated_at"
          FROM "admin_users"
          WHERE lower("email") = $1
          LIMIT 1
        `,
        [normalizedEmail],
      );
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }

      return await mapStaffWithGrants(client, row);
    },

    async createStaff(input, actorAdminId) {
      const newStaffId = await withTransaction(client, async () => {
        const inserted = await client.query<{ id: number }>(
          `
            INSERT INTO "admin_users" (
              "name",
              "email",
              "password_hash",
              "role",
              "account_type",
              "status",
              "created_by",
              "created_at",
              "updated_at"
            )
            VALUES ($1, $2, NULL, $3, $4, $5, $6, now(), now())
            RETURNING "id"
          `,
          [
            input.name,
            input.email,
            input.role,
            STAFF_ACCOUNT_TYPE,
            input.status,
            actorAdminId,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (!id) {
          throw new Error("Staff insert did not return an ID.");
        }

        await replaceGrantsInOpenTransaction(
          client,
          id,
          input.accessGroups,
          actorAdminId,
        );

        return id;
      });

      const created = await this.getStaffById(newStaffId);
      if (!created) {
        throw new Error("Created staff account could not be loaded.");
      }

      return created;
    },

    async updateStaff(id, input) {
      const result = await client.query<StaffRow>(
        `
          UPDATE "admin_users"
          SET
            "name" = $2,
            "email" = $3,
            "role" = $4,
            "updated_at" = now()
          WHERE "id" = $1
            AND "account_type" = $5
          RETURNING
            "id",
            "name",
            "email",
            "role",
            "status",
            "account_type",
            "created_at",
            "updated_at"
        `,
        [id, input.name, input.email, input.role, STAFF_ACCOUNT_TYPE],
      );
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }

      return await mapStaffWithGrants(client, row);
    },

    async setStaffStatus(id, status, actorAdminId) {
      const row = await withTransaction(client, async () => {
        const current = await client.query<{ status: AdminStatus }>(
          `
            SELECT "status"
            FROM "admin_users"
            WHERE "id" = $1
              AND "account_type" = $2
            FOR UPDATE
          `,
          [id, STAFF_ACCOUNT_TYPE],
        );
        const previousStatus = current.rows[0]?.status;
        if (!previousStatus) {
          return undefined;
        }

        const result = await client.query<StaffRow>(
          `
            UPDATE "admin_users"
            SET
              "status" = $2,
              "updated_at" = now()
            WHERE "id" = $1
              AND "account_type" = $3
            RETURNING
              "id",
              "name",
              "email",
              "role",
              "status",
              "account_type",
              "created_at",
              "updated_at"
          `,
          [id, status, STAFF_ACCOUNT_TYPE],
        );
        const updated = result.rows[0];
        if (!updated) {
          return undefined;
        }

        await insertLifecycleEvent(
          client,
          id,
          status === "active" ? "account_activated" : "access_disabled",
          actorAdminId,
          { previousStatus, nextStatus: status },
          status === "active"
            ? "V2 staff management activation."
            : "V2 staff management suspension.",
        );

        return updated;
      });
      if (!row) {
        return undefined;
      }

      return await mapStaffWithGrants(client, row);
    },

    async replaceStaffGrants(id, accessGroups, actorAdminId) {
      const replaced = await withTransaction(client, async () =>
        replaceGrantsInOpenTransaction(client, id, accessGroups, actorAdminId),
      );

      if (!replaced) {
        return undefined;
      }

      return await this.getStaffById(id);
    },
  };
}
