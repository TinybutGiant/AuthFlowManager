import type { ClientConfig } from "pg";

export type HyperdriveBindingName = "AUTHFLOW_DB" | "MAIN_DB";

export type HyperdriveBinding = {
  connectionString: string;
};

export type WorkerV2Env = {
  AUTHFLOW_DB?: HyperdriveBinding;
  MAIN_DB?: HyperdriveBinding;
};

export type DatabaseHealthErrorCode =
  | "BINDING_MISSING"
  | "CONNECTION_FAILED";

export type DatabaseHealthResult =
  | { ok: true }
  | { ok: false; errorCode: DatabaseHealthErrorCode };

export class WorkerDatabaseConfigError extends Error {
  readonly code = "BINDING_MISSING" as const;
  readonly bindingName: HyperdriveBindingName;

  constructor(bindingName: HyperdriveBindingName) {
    super(`${bindingName} Hyperdrive binding is not configured`);
    this.name = "WorkerDatabaseConfigError";
    this.bindingName = bindingName;
  }
}

export function readHyperdriveConnectionString(
  env: WorkerV2Env,
  bindingName: HyperdriveBindingName,
): string {
  const binding = env[bindingName];
  if (!binding?.connectionString) {
    throw new WorkerDatabaseConfigError(bindingName);
  }

  return binding.connectionString;
}

function parsePostgresUrl(connectionString: string): URL | null {
  try {
    return new URL(connectionString.replace(/^postgres:\/\//, "postgresql://"));
  } catch {
    return null;
  }
}

function withoutSslMode(connectionString: string): string {
  const parsed = parsePostgresUrl(connectionString);
  if (!parsed) return connectionString;

  parsed.searchParams.delete("sslmode");
  return parsed.toString();
}

function createPgClientConfig(connectionString: string): ClientConfig {
  const sslMode = parsePostgresUrl(connectionString)
    ?.searchParams.get("sslmode")
    ?.toLowerCase();

  if (sslMode === "disable") {
    return {
      connectionString: withoutSslMode(connectionString),
      ssl: false,
    };
  }

  if (sslMode && sslMode !== "verify-full") {
    return {
      connectionString: withoutSslMode(connectionString),
      ssl: { rejectUnauthorized: false },
    };
  }

  return { connectionString };
}

export function createHyperdrivePgClientConfig(
  env: WorkerV2Env,
  bindingName: HyperdriveBindingName,
): ClientConfig {
  return createPgClientConfig(readHyperdriveConnectionString(env, bindingName));
}

export function toDatabaseHealthErrorCode(
  error: unknown,
): DatabaseHealthErrorCode {
  return error instanceof WorkerDatabaseConfigError
    ? error.code
    : "CONNECTION_FAILED";
}

export function logDatabaseHealthError(
  bindingName: HyperdriveBindingName,
  error: unknown,
) {
  const errorType = error instanceof Error ? error.name : typeof error;
  console.error("Worker database health check failed", {
    binding: bindingName,
    errorType,
  });
}
