import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface PrivateObjectMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface PutPrivateObjectInput {
  buffer: Buffer;
  key: string;
  contentType: string;
  metadata?: PrivateObjectMetadata;
}

export interface PrivateObjectBuffer {
  buffer: Buffer;
  contentType: string;
  contentLength?: number;
}

export class PrivateObjectStorageConfigError extends Error {
  constructor(message = "Private R2 storage is not configured.") {
    super(message);
    this.name = "PrivateObjectStorageConfigError";
  }
}

interface RequiredPrivateR2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function getPrivateR2Config() {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    configured: Boolean(endpoint && accessKeyId && secretAccessKey && bucket),
  };
}

function requirePrivateR2Config() {
  const config = getPrivateR2Config();
  if (!config.configured) {
    throw new PrivateObjectStorageConfigError(
      "Private R2 storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
    );
  }
  return {
    endpoint: config.endpoint!,
    accessKeyId: config.accessKeyId!,
    secretAccessKey: config.secretAccessKey!,
    bucket: config.bucket!,
  };
}

function createPrivateR2Client(config: RequiredPrivateR2Config = requirePrivateR2Config()) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function normalizeMetadata(metadata: PrivateObjectMetadata | undefined) {
  if (!metadata) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

export function isPrivateObjectStorageConfigured() {
  return getPrivateR2Config().configured;
}

export async function putPrivateObject(input: PutPrivateObjectInput): Promise<void> {
  const config = requirePrivateR2Config();
  const client = createPrivateR2Client(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.buffer,
      ContentType: input.contentType,
      Metadata: normalizeMetadata(input.metadata),
      CacheControl: "private, no-store",
    }),
  );
}

export async function privateObjectExists(key: string): Promise<boolean> {
  const config = requirePrivateR2Config();
  const client = createPrivateR2Client(config);

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
    return true;
  } catch (error: any) {
    const statusCode = error?.$metadata?.httpStatusCode;
    if (statusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      return false;
    }
    throw error;
  }
}

export async function getPrivateObjectBuffer(key: string): Promise<PrivateObjectBuffer> {
  const config = requirePrivateR2Config();
  const client = createPrivateR2Client(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error("Private object response did not include a body.");
  }

  const bytes = await response.Body.transformToByteArray();
  return {
    buffer: Buffer.from(bytes),
    contentType: response.ContentType ?? "application/octet-stream",
    contentLength: response.ContentLength,
  };
}
