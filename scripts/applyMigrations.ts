import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { createPostgresPool } from "../server/db-client";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "migrations");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running migrations.");
}

const pool = createPostgresPool(process.env.DATABASE_URL, {
  poolMaxEnvName: "DB_POOL_MAX",
  sslEnvNames: ["DB_SSL"],
});

async function main() {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    console.log("No SQL migrations found.");
    return;
  }

  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    if (!sql.trim()) continue;

    console.log(`Applying ${file}`);
    await pool.query(sql);
  }

  console.log(`Applied ${migrationFiles.length} migration file(s).`);
}

try {
  await main();
} finally {
  await pool.end();
}
