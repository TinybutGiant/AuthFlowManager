import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../../shared/main-schema";
import {
  createHyperdrivePgClientConfig,
  logDatabaseHealthError,
  toDatabaseHealthErrorCode,
  type DatabaseHealthResult,
  type WorkerV2Env,
} from "./types";

export type MainWorkerDatabase = NodePgDatabase<typeof schema>;

export async function withMainDatabase<T>(
  env: WorkerV2Env,
  operation: (db: MainWorkerDatabase, client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(createHyperdrivePgClientConfig(env, "MAIN_DB"));

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

export async function checkMainDatabaseHealth(
  env: WorkerV2Env,
): Promise<DatabaseHealthResult> {
  try {
    await withMainDatabase(env, async (db) => {
      await db.execute(sql`SELECT 1`);
    });
    return { ok: true };
  } catch (error) {
    logDatabaseHealthError("MAIN_DB", error);
    return { ok: false, errorCode: toDatabaseHealthErrorCode(error) };
  }
}
