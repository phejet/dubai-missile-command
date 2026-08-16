export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

export interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  size: number;
  customMetadata?: Record<string, string>;
}

export interface R2Bucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2ObjectBody | null>;
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: {
      onlyIf?: { etagDoesNotMatch?: string };
      httpMetadata?: { contentType?: string; contentEncoding?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2ObjectBody | null>;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  CAPTURES: R2Bucket;
  INGEST_IP: RateLimitBinding;
  INGEST_INSTALL: RateLimitBinding;
  REPORT_INSTALL: RateLimitBinding;
  CAPTURE_BEARER_TOKEN?: string;
  CAPTURE_AUTH_SECRET?: string;
  ALLOWED_BUILDS?: string;
  ALLOWED_ORIGINS?: string;
  APPLE_TEAM_ID?: string;
  APPLE_BUNDLE_ID?: string;
  APPLE_BUNDLE_VERSIONS?: string;
  APPLE_ATTEST_ENVIRONMENTS?: string;
  ENROLLMENT_ENABLED?: string;
  WORKER_BUILD?: string;
}
