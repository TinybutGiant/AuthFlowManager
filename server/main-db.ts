import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as mainSchema from "../shared/main-schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.MAIN_DATABASE_URL) {
  throw new Error(
    "MAIN_DATABASE_URL must be set. Did you forget to provision the main database?",
  );
}

export const mainPool = new Pool({ connectionString: process.env.MAIN_DATABASE_URL });
export const mainDb = drizzle({ client: mainPool, schema: mainSchema });