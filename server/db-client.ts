import pg from "pg";
import type { Pool as PgPool } from "pg";

const { Pool } = pg;

type CreatePostgresPoolOptions = {
  poolMaxEnvName?: string;
  sslEnvNames?: string[];
};

function parseDbUrl(connectionString: string): URL | null {
  try {
    return new URL(connectionString.replace(/^postgres:\/\//, "postgresql://"));
  } catch {
    return null;
  }
}

function readPositiveIntEnv(name?: string): number | undefined {
  if (!name) return undefined;
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readSslOverride(envNames: string[]): boolean | undefined {
  for (const name of envNames) {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) continue;
    if (["0", "false", "no", "disable", "disabled"].includes(raw)) return false;
    if (["1", "true", "yes", "require", "required"].includes(raw)) return true;
  }
  return undefined;
}

function shouldUseSsl(connectionString: string, envNames: string[]): boolean {
  const override = readSslOverride(envNames);
  if (override !== undefined) return override;

  const parsed = parseDbUrl(connectionString);
  const sslMode = parsed?.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode === "disable") return false;
  if (sslMode) return true;

  const host = parsed?.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
}

function isSupabasePooler(connectionString: string): boolean {
  return parseDbUrl(connectionString)?.hostname.toLowerCase().endsWith(".pooler.supabase.com") ?? false;
}

function withoutSslMode(connectionString: string): string {
  const parsed = parseDbUrl(connectionString);
  if (!parsed) return connectionString;

  parsed.searchParams.delete("sslmode");
  return parsed.toString();
}

export function createPostgresPool(
  connectionString: string,
  options: CreatePostgresPoolOptions = {},
): PgPool {
  const sslEnvNames = options.sslEnvNames ?? ["DB_SSL"];
  const explicitMax = readPositiveIntEnv(options.poolMaxEnvName);
  const max = explicitMax ?? (isSupabasePooler(connectionString) ? 3 : undefined);

  return new Pool({
    connectionString: withoutSslMode(connectionString),
    ssl: shouldUseSsl(connectionString, sslEnvNames) ? { rejectUnauthorized: false } : false,
    ...(max ? { max } : {}),
  });
}
