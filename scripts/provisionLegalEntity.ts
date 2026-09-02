import "dotenv/config";

import { createPostgresPool } from "../server/db-client";

const entityTypes = new Set(["llc", "corporation", "partnership", "sole_proprietorship", "other"]);
const statuses = new Set(["active", "inactive"]);

type Flags = {
  legalName: string;
  entityType: string;
  formationState: string | null;
  maskedTaxIdentifier: string | null;
  status: string;
  createdByEmail: string | null;
  execute: boolean;
};

function parseFlags(args: string[]): Flags {
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".`);
    }
    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      values.set(rawName, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(rawName, next);
      index += 1;
      continue;
    }
    values.set(rawName, true);
  }

  const legalName = stringFlag(values, "legal-name");
  const entityType = optionalStringFlag(values, "entity-type") ?? "llc";
  const status = optionalStringFlag(values, "status") ?? "active";

  if (!entityTypes.has(entityType)) {
    throw new Error(`--entity-type must be one of: ${Array.from(entityTypes).join(", ")}.`);
  }
  if (!statuses.has(status)) {
    throw new Error(`--status must be one of: ${Array.from(statuses).join(", ")}.`);
  }

  return {
    legalName,
    entityType,
    formationState: optionalStringFlag(values, "formation-state") ?? null,
    maskedTaxIdentifier: optionalStringFlag(values, "masked-tax-identifier") ?? null,
    status,
    createdByEmail: optionalStringFlag(values, "created-by-email") ?? null,
    execute: values.get("execute") === true,
  };
}

function stringFlag(values: Map<string, string | boolean>, name: string) {
  const value = values.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required --${name} value.`);
  }
  return value.trim();
}

function optionalStringFlag(values: Map<string, string | boolean>, name: string) {
  const value = values.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`--${name} requires a value.`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set.");
  }

  const flags = parseFlags(process.argv.slice(2));
  const pool = createPostgresPool(process.env.DATABASE_URL);

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query('LOCK TABLE "legal_entities" IN SHARE ROW EXCLUSIVE MODE');

      const existing = await client.query<{
        id: number;
        legal_name: string;
        entity_type: string;
        formation_state: string | null;
        status: string;
      }>(
        `
          SELECT id, legal_name, entity_type, formation_state, status
          FROM legal_entities
          WHERE lower(trim(legal_name)) = lower(trim($1))
          ORDER BY id
          FOR UPDATE
        `,
        [flags.legalName],
      );

      if (existing.rowCount && existing.rowCount > 1) {
        throw new Error("Multiple legal_entities rows already use that legal name; refusing to provision.");
      }

      let createdById: number | null = null;
      if (flags.createdByEmail) {
        const owner = await client.query<{ id: number }>(
          `
            SELECT id
            FROM admin_users
            WHERE lower(email) = lower($1)
            ORDER BY id
            LIMIT 1
          `,
          [flags.createdByEmail],
        );
        if (!owner.rowCount) {
          throw new Error("--created-by-email did not match an admin_users row.");
        }
        createdById = owner.rows[0].id;
      }

      if (existing.rowCount === 1) {
        await client.query("ROLLBACK");
        const row = existing.rows[0];
        console.log(JSON.stringify({
          status: "exists",
          id: row.id,
          legalName: row.legal_name,
          entityType: row.entity_type,
          formationState: row.formation_state,
          legalEntityStatus: row.status,
        }, null, 2));
        return;
      }

      if (!flags.execute) {
        await client.query("ROLLBACK");
        console.log(JSON.stringify({
          status: "dry_run",
          wouldInsert: {
            legalName: flags.legalName,
            entityType: flags.entityType,
            formationState: flags.formationState,
            maskedTaxIdentifierPresent: Boolean(flags.maskedTaxIdentifier),
            legalEntityStatus: flags.status,
            createdByAdminId: createdById,
          },
        }, null, 2));
        return;
      }

      const inserted = await client.query<{
        id: number;
        legal_name: string;
        entity_type: string;
        formation_state: string | null;
        status: string;
        created_by: number | null;
      }>(
        `
          INSERT INTO legal_entities (
            legal_name,
            entity_type,
            formation_state,
            masked_tax_identifier,
            status,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, legal_name, entity_type, formation_state, status, created_by
        `,
        [
          flags.legalName,
          flags.entityType,
          flags.formationState,
          flags.maskedTaxIdentifier,
          flags.status,
          createdById,
        ],
      );

      await client.query("COMMIT");
      const row = inserted.rows[0];
      console.log(JSON.stringify({
        status: "inserted",
        id: row.id,
        legalName: row.legal_name,
        entityType: row.entity_type,
        formationState: row.formation_state,
        legalEntityStatus: row.status,
        createdByAdminId: row.created_by,
      }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
