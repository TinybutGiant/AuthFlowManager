import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import "dotenv/config";
import { createPostgresPool } from "./db-client";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = createPostgresPool(process.env.DATABASE_URL, {
  poolMaxEnvName: "DB_POOL_MAX",
  sslEnvNames: ["DB_SSL"],
});
export const db = drizzle(pool, { schema });
