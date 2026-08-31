import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { createPostgresPool } from "../server/db-client";
import {
  adoptPreLedgerDatabase,
  getMigrationStatus,
  loadMigrationFiles,
  MigrationRunnerError,
  runMigrations,
  type MigrationPool,
} from "./migrationRunner";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "migrations");

type CliCommand = "migrate" | "status" | "adopt";

function parseCommand(raw: string | undefined): CliCommand {
  if (!raw) return "migrate";
  if (raw === "migrate" || raw === "status" || raw === "adopt") return raw;
  throw new MigrationRunnerError(
    "MIGRATION_COMMAND_INVALID",
    `Unknown migration command "${raw}". Use migrate, status, or adopt.`,
  );
}

function parseFlags(args: string[]) {
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new MigrationRunnerError("MIGRATION_ARGUMENT_INVALID", `Unexpected argument "${arg}".`);
    }
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(name, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return flags;
}

function requireStringFlag(flags: Map<string, string | boolean>, name: string) {
  const value = flags.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new MigrationRunnerError(
      "MIGRATION_ARGUMENT_MISSING",
      `Missing required --${name} value.`,
    );
  }
  return value;
}

function optionalStringFlag(flags: Map<string, string | boolean>, name: string) {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new MigrationRunnerError(
      "MIGRATION_ARGUMENT_INVALID",
      `--${name} requires a value.`,
    );
  }
  return value;
}

function createPool(): MigrationPool {
  if (!process.env.DATABASE_URL) {
    throw new MigrationRunnerError(
      "DATABASE_URL_MISSING",
      "DATABASE_URL must be set before running migrations.",
    );
  }

  return createPostgresPool(process.env.DATABASE_URL, {
    poolMaxEnvName: "DB_POOL_MAX",
    sslEnvNames: ["DB_SSL"],
  }) as MigrationPool;
}

function printStatus(status: Awaited<ReturnType<typeof getMigrationStatus>>) {
  console.log(`Migration ledger: ${status.ledgerPresent ? "present" : "missing"}`);
  console.log(`Ledgered numbered migrations: ${status.ledgeredMigrationCount}`);
  console.log(`Latest ledgered migration: ${status.latestLedgeredMigration ?? "none"}`);
  console.log(`Pending repository migrations: ${status.pendingMigrations.length}`);
  if (status.pendingMigrations.length > 0) {
    console.log(`Pending: ${status.pendingMigrations.join(", ")}`);
  }
  if (status.baselineRows.length > 0) {
    console.log(`Baseline markers: ${status.baselineRows.join(", ")}`);
  }
  const modeSummary = Object.entries(status.applicationModeCounts)
    .map(([mode, count]) => `${mode}=${count}`)
    .join(", ");
  console.log(`Application modes: ${modeSummary || "none"}`);

  if (status.checksumMismatches.length > 0) {
    console.log(`Checksum mismatches: ${status.checksumMismatches.join("; ")}`);
  }
  if (status.orderingProblems.length > 0) {
    console.log(`Ordering/ledger problems: ${status.orderingProblems.join("; ")}`);
  }
  if (status.transactionCompatibilityIssues.length > 0) {
    console.log(`Transaction compatibility issues: ${status.transactionCompatibilityIssues.join("; ")}`);
  }

  const adoptionSummary = status.adoptionTargets
    .map((target) => `${target.id}=${target.matched ? "matched" : "not_matched"}`)
    .join(", ");
  console.log(`Adoption fingerprints: ${adoptionSummary || "none"}`);
}

async function main() {
  const command = parseCommand(process.argv[2]);
  const flags = parseFlags(process.argv.slice(3));
  const migrations = await loadMigrationFiles(migrationsDir);
  const pool = createPool();

  try {
    if (command === "status") {
      printStatus(await getMigrationStatus(pool, migrations));
      return;
    }

    if (command === "adopt") {
      const result = await adoptPreLedgerDatabase(pool, migrations, {
        targetId: optionalStringFlag(flags, "target"),
        confirmDatabaseName: requireStringFlag(flags, "confirm-database"),
      });
      console.log(`Adopted migration prefix: ${result.throughFilename}`);
      console.log(`Adopted rows: ${result.adopted.length}`);
      console.log(`Application mode: adopted`);
      console.log(`Database: ${result.databaseName}`);
      return;
    }

    const result = await runMigrations(pool, migrations);
    console.log(`Migration ledger: present`);
    console.log(`Skipped ledgered migrations: ${result.skipped.length}`);
    console.log(`Pending before run: ${result.pendingBeforeRun.length}`);
    if (result.pendingBeforeRun.length > 0) {
      console.log(`Pending: ${result.pendingBeforeRun.join(", ")}`);
    }
    console.log(`Applied migrations: ${result.applied.length}`);
    if (result.applied.length > 0) {
      console.log(`Applied: ${result.applied.join(", ")}`);
    }
    console.log(`Latest migration: ${result.latestMigration ?? "none"}`);
  } finally {
    await pool.end?.();
  }
}

main().catch((error) => {
  if (error instanceof MigrationRunnerError) {
    console.error(`${error.code}: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
