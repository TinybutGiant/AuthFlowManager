import { drizzle } from "drizzle-orm/node-postgres";
import * as mainSchema from "../shared/main-schema";
import "dotenv/config";
import { createPostgresPool } from "./db-client";

if (!process.env.MAIN_DATABASE_URL) {
  throw new Error(
    "MAIN_DATABASE_URL must be set. Did you forget to provision the main database?",
  );
}

export const mainPool = createPostgresPool(process.env.MAIN_DATABASE_URL, {
  poolMaxEnvName: "MAIN_DB_POOL_MAX",
  sslEnvNames: ["MAIN_DB_SSL", "MAIN_DB_SSLMODE", "DB_SSL"],
});
export const mainDb = drizzle(mainPool, { schema: mainSchema });
