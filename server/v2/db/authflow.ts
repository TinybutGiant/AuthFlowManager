import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../../shared/schema";
import {
  createHyperdrivePgClientConfig,
  logDatabaseHealthError,
  toDatabaseHealthErrorCode,
  type DatabaseHealthResult,
  type WorkerV2Env,
} from "./types";

export type AuthflowWorkerDatabase = NodePgDatabase<typeof schema>;

export async function withAuthflowDatabase<T>(
  env: WorkerV2Env,
  operation: (
    db: AuthflowWorkerDatabase,
    client: Client,
  ) => Promise<T>,
): Promise<T> {
  const client = new Client(createHyperdrivePgClientConfig(env, "AUTHFLOW_DB"));

  let connected = false;
  try {
    await client.connect();
    connected = true;
    const db = drizzle(client, { schema });
    return await operation(db, client);
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}

export async function checkAuthflowDatabaseHealth(
  env: WorkerV2Env,
): Promise<DatabaseHealthResult> {
  try {
    await withAuthflowDatabase(env, async (db) => {
      await db.execute(sql`SELECT 1`);
    });
    return { ok: true };
  } catch (error) {
    logDatabaseHealthError("AUTHFLOW_DB", error);
    return { ok: false, errorCode: toDatabaseHealthErrorCode(error) };
  }
}
