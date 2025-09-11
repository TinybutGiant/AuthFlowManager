import { defineConfig } from "drizzle-kit";

if (!process.env.MAIN_DATABASE_URL) {
  throw new Error("MAIN_DATABASE_URL must be set for main database operations");
}

export default defineConfig({
  out: "./migrations-main",
  schema: "./shared/main-schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MAIN_DATABASE_URL,
  },
});