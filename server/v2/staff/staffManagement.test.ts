import assert from "node:assert/strict";
import test from "node:test";

import type {
  AdminAccessGroup,
  AdminRole,
  AdminStatus,
} from "../../../shared/schema";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import {
  activateManagedStaff,
  createManagedStaff,
  getManagedStaff,
  listManagedStaff,
  replaceManagedStaffGrants,
  StaffManagementError,
  STAFF_SUSPENDED_STATUS,
  suspendManagedStaff,
  updateManagedStaff,
  type StaffManagementRepository,
  type V2StaffRecord,
} from "./staffManagement";
import { isV2StaffAssignableAccessGroup } from "./permissions";

const NOW = "2026-01-01T00:00:00.000Z";

class MemoryStaffManagementRepository implements StaffManagementRepository {
  readonly staffById = new Map<number, V2StaffRecord>();
  private nextId = 10;

  async listStaff(): Promise<V2StaffRecord[]> {
    return Array.from(this.staffById.values()).sort((left, right) =>
      left.email.localeCompare(right.email),
    );
  }

  async getStaffById(id: number): Promise<V2StaffRecord | undefined> {
    return this.staffById.get(id);
  }

  async findStaffByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<V2StaffRecord | undefined> {
    return Array.from(this.staffById.values()).find(
      (staff) => staff.email.toLowerCase() === normalizedEmail,
    );
  }

  async createStaff(
    input: {
      name: string;
      email: string;
      role: AdminRole;
      status: typeof STAFF_SUSPENDED_STATUS;
      accessGroups: AdminAccessGroup[];
    },
    _actorAdminId: number,
  ): Promise<V2StaffRecord> {
    const staff: V2StaffRecord = {
      id: this.nextId++,
      name: input.name,
      email: input.email,
      role: input.role,
      status: input.status,
      accountType: "admin_staff",
      accessGroups: input.accessGroups,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.staffById.set(staff.id, staff);
    return staff;
  }

  async updateStaff(
    id: number,
    input: { name: string; email: string; role: AdminRole },
    _actorAdminId: number,
  ): Promise<V2StaffRecord | undefined> {
    const staff = this.staffById.get(id);
    if (!staff) return undefined;

    const updated = {
      ...staff,
      ...input,
      updatedAt: NOW,
    };
    this.staffById.set(id, updated);
    return updated;
  }

  async setStaffStatus(
    id: number,
    status: "active" | typeof STAFF_SUSPENDED_STATUS,
    _actorAdminId: number,
  ): Promise<V2StaffRecord | undefined> {
    const staff = this.staffById.get(id);
    if (!staff) return undefined;

    const updated = {
      ...staff,
      status,
      updatedAt: NOW,
    };
    this.staffById.set(id, updated);
    return updated;
  }

  async replaceStaffGrants(
    id: number,
    accessGroups: AdminAccessGroup[],
    _actorAdminId: number,
  ): Promise<V2StaffRecord | undefined> {
    const staff = this.staffById.get(id);
    if (!staff) return undefined;
    const preservedLegacyAccessGroups = staff.accessGroups.filter(
      (accessGroup) => !isV2StaffAssignableAccessGroup(accessGroup),
    );

    const updated = {
      ...staff,
      accessGroups: [...preservedLegacyAccessGroups, ...accessGroups],
      updatedAt: NOW,
    };
    this.staffById.set(id, updated);
    return updated;
  }
}

function staffRecord(overrides: Partial<V2StaffRecord> = {}): V2StaffRecord {
  return {
    id: 2,
    name: "Existing Staff",
    email: "staff@example.com",
    role: "admin_support",
    status: "active",
    accountType: "admin_staff",
    accessGroups: ["support_admin"],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function principal(
  overrides: Partial<StaffPrincipal> = {},
): StaffPrincipal {
  return {
    id: "1",
    email: "owner@example.com",
    role: "admin_support",
    permissions: ["super_admin"],
    ...overrides,
  };
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: StaffManagementError["code"],
) {
  await assert.rejects(
    promise,
    (error) =>
      error instanceof StaffManagementError && error.code === code,
  );
}

test("authorized manager can create, update, activate, and suspend staff", async () => {
  const repository = new MemoryStaffManagementRepository();
  const created = await createManagedStaff(repository, principal(), {
    name: "  Jane   Staff  ",
    email: "  JANE.STAFF@EXAMPLE.COM  ",
    role: "admin_verifier",
    accessGroups: ["verifier_admin", "finance_admin", "verifier_admin"],
  });

  assert.equal(created.name, "Jane Staff");
  assert.equal(created.email, "jane.staff@example.com");
  assert.equal(created.status, "inactive");
  assert.deepEqual(created.accessGroups, ["verifier_admin", "finance_admin"]);

  const updated = await updateManagedStaff(
    repository,
    principal(),
    created.id,
    {
      name: "Jane Manager",
      email: "jane.manager@example.com",
      role: "admin_finance",
    },
  );
  assert.equal(updated.name, "Jane Manager");
  assert.equal(updated.email, "jane.manager@example.com");
  assert.equal(updated.role, "admin_finance");

  const activated = await activateManagedStaff(
    repository,
    principal(),
    created.id,
  );
  assert.equal(activated.status, "active");

  const suspended = await suspendManagedStaff(
    repository,
    principal(),
    created.id,
  );
  assert.equal(suspended.status, "inactive");
});

test("role alone does not authorize staff management", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(2, staffRecord());

  await rejectsWithCode(
    listManagedStaff(
      repository,
      principal({ role: "super_admin", permissions: [] }),
    ),
    "STAFF_MANAGEMENT_PERMISSION_MISSING",
  );
});

test("duplicate normalized email is rejected", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(2, staffRecord({ email: "staff@example.com" }));

  await rejectsWithCode(
    createManagedStaff(repository, principal(), {
      name: "Duplicate",
      email: " STAFF@EXAMPLE.COM ",
      role: "admin_support",
      accessGroups: [],
    }),
    "DUPLICATE_EMAIL",
  );
});

test("unknown staff ID is rejected", async () => {
  const repository = new MemoryStaffManagementRepository();

  await rejectsWithCode(
    getManagedStaff(repository, principal(), 404),
    "STAFF_NOT_FOUND",
  );
});

test("invalid permission name is rejected", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(2, staffRecord());

  await rejectsWithCode(
    replaceManagedStaffGrants(repository, principal(), 2, ["staff.manage"]),
    "INVALID_ACCESS_GROUP",
  );
  await rejectsWithCode(
    replaceManagedStaffGrants(repository, principal(), 2, ["support_admin"]),
    "INVALID_ACCESS_GROUP",
  );
});

test("V2 grant replacement revokes only assignable grants and preserves legacy grants", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(
    2,
    staffRecord({
      accessGroups: ["super_admin", "support_admin"],
    }),
  );

  const updated = await replaceManagedStaffGrants(
    repository,
    principal(),
    2,
    ["finance_admin"],
  );

  assert.deepEqual(updated.accessGroups, ["support_admin", "finance_admin"]);
});

test("self-lockout protection blocks self-suspension and removing own management grants", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(
    1,
    staffRecord({
      id: 1,
      email: "owner@example.com",
      status: "active",
      accessGroups: ["super_admin"],
    }),
  );

  await rejectsWithCode(
    suspendManagedStaff(repository, principal({ id: "1" }), 1),
    "SELF_LOCKOUT",
  );
  await rejectsWithCode(
    replaceManagedStaffGrants(repository, principal({ id: "1" }), 1, []),
    "SELF_LOCKOUT",
  );

  const updated = await replaceManagedStaffGrants(
    repository,
    principal({ id: "1" }),
    1,
    ["admin_operations"],
  );
  assert.deepEqual(updated.accessGroups, ["admin_operations"]);
});

test("self-lockout protection blocks changing own Access email", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(
    1,
    staffRecord({
      id: 1,
      email: "owner@example.com",
      status: "active",
      accessGroups: ["super_admin"],
    }),
  );

  await rejectsWithCode(
    updateManagedStaff(repository, principal({ id: "1" }), 1, {
      email: "different@example.com",
    }),
    "SELF_LOCKOUT",
  );
});

test("status lifecycle uses inactive as V2 suspension", async () => {
  const repository = new MemoryStaffManagementRepository();
  repository.staffById.set(
    2,
    staffRecord({ status: "active" as AdminStatus }),
  );

  const suspended = await suspendManagedStaff(
    repository,
    principal(),
    2,
  );

  assert.equal(suspended.status, "inactive");
});
