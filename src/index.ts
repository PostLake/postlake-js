// PostLake — the official TypeScript SDK.
//
//   import { PostLake } from "postlake";
//   const pl = new PostLake({ apiKey: "sk_live_…" });
//   await pl.posts.create({ text: "hello", accounts: ["acc_1"] });
//
// Thin, typed wrapper over the REST API: it handles auth, JSON, the error
// envelope, idempotency keys and cursor pagination so callers don't. Runs
// anywhere with a global fetch (Node 18+, Cloudflare Workers, the browser).

import type {
  Account,
  AnalyticsResponse,
  ConnectedAccount,
  CreatePostInput,
  MediaAsset,
  NormalisedError,
  Page,
  Platform,
  Post,
  PostAnalytics,
  ValidatePostResult,
  WebhookEndpoint,
} from "./types.js";

export * from "./types.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PostLakeOptions {
  /** Your secret API key (sk_live_…). Create one in the dashboard → API Keys. */
  apiKey: string;
  /** Override the API base URL (e.g. for self-host or tests). */
  baseUrl?: string;
  /** Inject a fetch implementation (defaults to the global fetch). */
  fetch?: FetchLike;
}

/** Thrown for any non-2xx response, carrying the normalised error + requestId. */
export class PostLakeError extends Error {
  readonly type: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly platform?: Platform;
  readonly requestId?: string;
  /** A stable, granular handle to branch on, e.g. "text_too_long". */
  readonly code?: string;
  /** The next action, in plain words, safe to show a person. */
  readonly fix?: string;
  /** Where the rule is written down, so it is learned once. */
  readonly docs?: string;
  /** The request field at fault, so a form can mark the right input. */
  readonly param?: string;
  constructor(err: NormalisedError, status: number, requestId?: string) {
    super(err.message);
    this.name = "PostLakeError";
    this.type = err.type;
    this.status = status;
    this.retryable = err.retryable;
    this.platform = err.platform;
    this.requestId = requestId;
    this.code = err.code;
    this.fix = err.fix;
    this.docs = err.docs;
    this.param = err.param;
  }
}

const DEFAULT_BASE = "https://api.postlake.dev";

interface RequestOpts {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Raw body + content-type (media upload); skips JSON encoding. */
  raw?: { bytes: ArrayBuffer | Uint8Array; contentType: string };
  idempotencyKey?: string;
}

export class PostLake {
  readonly posts: Posts;
  readonly socialAccounts: SocialAccounts;
  readonly analytics: Analytics;
  readonly media: Media;
  readonly webhooks: Webhooks;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: PostLakeOptions) {
    if (!opts?.apiKey) throw new Error("PostLake: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new Error("PostLake: no fetch available, pass `fetch` in options");
    this.fetchImpl = f;

    this.posts = new Posts(this);
    this.socialAccounts = new SocialAccounts(this);
    this.analytics = new Analytics(this);
    this.media = new Media(this);
    this.webhooks = new Webhooks(this);
  }

  /** The authenticated account (id, email, supported platforms, optional timezone). */
  me(): Promise<Account> {
    return this.request<Account>("GET", "/v1/me");
  }
  /** Set or clear the account default timezone. */
  updateMe(patch: { timezone?: string | null }): Promise<Account> {
    return this.request<Account>("PATCH", "/v1/me", { body: patch });
  }

  /** @internal */
  async request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

    let body: BodyInit | undefined;
    if (opts.raw) {
      headers["content-type"] = opts.raw.contentType;
      body = opts.raw.bytes as BodyInit;
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await this.fetchImpl(url.toString(), { method, headers, body });
    const requestId = res.headers.get("x-request-id") ?? undefined;

    if (!res.ok) {
      let err: NormalisedError = { type: "internal", message: res.statusText || "Request failed", retryable: false };
      try {
        const j = (await res.json()) as { error?: NormalisedError };
        if (j?.error) err = j.error;
      } catch {
        /* non-JSON error body */
      }
      throw new PostLakeError(err, res.status, requestId);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

class Posts {
  constructor(private readonly c: PostLake) {}

  /** Publish now (or schedule with `scheduledAt`). Pass `idempotencyKey` for safe retries. */
  create(input: CreatePostInput, opts: { idempotencyKey?: string } = {}): Promise<Post> {
    return this.c.request<Post>("POST", "/v1/posts", { body: input, idempotencyKey: opts.idempotencyKey });
  }
  get(id: string): Promise<Post> {
    return this.c.request<Post>("GET", `/v1/posts/${encodeURIComponent(id)}`);
  }

  /** Dry run. Runs exactly the checks a real publish runs (account resolution,
   *  media resolution, every network's capability rules) without touching any
   *  platform and without spending a credit. Cheap to call before `create`. */
  validate(input: CreatePostInput): Promise<ValidatePostResult> {
    return this.c.request<ValidatePostResult>("POST", "/v1/posts/validate", { body: input });
  }
  /** One page of posts, most recent first. */
  async list(params: { limit?: number; cursor?: string; state?: string; account?: string; profile?: string } = {}): Promise<Page<Post>> {
    const r = await this.c.request<{ posts: Post[]; nextCursor: string | null }>("GET", "/v1/posts", { query: params });
    return { data: r.posts, nextCursor: r.nextCursor };
  }
  /** Auto-paginating async iterator over every post. */
  async *listAll(params: { limit?: number; state?: string; account?: string; profile?: string } = {}): AsyncGenerator<Post> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, cursor });
      for (const p of page.data) yield p;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  /** Edit a scheduled post (text/media/platformOptions/scheduledAt/timezone). */
  update(
    id: string,
    patch: Partial<Pick<CreatePostInput, "text" | "media" | "scheduledAt" | "timezone" | "platformOptions">> & {
      textOverrides?: Partial<Record<Platform, string>>;
      mediaAlt?: string[];
      mediaOverrides?: Partial<Record<Platform, string[]>>;
      mediaAltOverrides?: Partial<Record<Platform, string[]>>;
    },
  ): Promise<Post> {
    return this.c.request<Post>("PATCH", `/v1/posts/${encodeURIComponent(id)}`, { body: patch });
  }
  /** Cancel a scheduled post. */
  cancel(id: string): Promise<{ id: string; cancelled: boolean }> {
    return this.c.request("DELETE", `/v1/posts/${encodeURIComponent(id)}`);
  }
  /** Per-post normalised analytics (per-target + totals). */
  analytics(id: string): Promise<PostAnalytics> {
    return this.c.request<PostAnalytics>("GET", `/v1/posts/${encodeURIComponent(id)}/analytics`);
  }
}

class SocialAccounts {
  constructor(private readonly c: PostLake) {}

  async list(params: { limit?: number; cursor?: string } = {}): Promise<Page<ConnectedAccount>> {
    const r = await this.c.request<{ accounts: ConnectedAccount[]; nextCursor: string | null }>(
      "GET",
      "/v1/social-accounts",
      { query: params },
    );
    return { data: r.accounts, nextCursor: r.nextCursor };
  }
  async *listAll(): AsyncGenerator<ConnectedAccount> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ cursor });
      for (const a of page.data) yield a;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  connect(input: { platform: Platform; profile?: string } & Record<string, unknown>): Promise<ConnectedAccount> {
    return this.c.request<ConnectedAccount>("POST", "/v1/social-accounts/connect", { body: input });
  }
  targets(id: string): Promise<Array<{ id: string; name: string }>> {
    return this.c.request("GET", `/v1/social-accounts/${encodeURIComponent(id)}/targets`);
  }
}

class Analytics {
  constructor(private readonly c: PostLake) {}
  /** Cross-platform analytics for a period (e.g. "7d", "30d", "90d"). */
  get(params: { period?: string } = {}): Promise<AnalyticsResponse> {
    return this.c.request<AnalyticsResponse>("GET", "/v1/analytics", { query: params });
  }
}

class Media {
  constructor(private readonly c: PostLake) {}
  /** Upload bytes; returns a med_… asset to reference when creating a post. */
  upload(bytes: ArrayBuffer | Uint8Array, contentType: string): Promise<MediaAsset> {
    return this.c.request<MediaAsset>("POST", "/v1/media", { raw: { bytes, contentType } });
  }
  /** Prepare signed PUT targets for several local files (a carousel) in one call. */
  prepareBatch(items: { contentType: string; sizeBytes?: number }[]): Promise<{
    items: Array<{
      id: string;
      uploadUrl: string;
      method: "PUT";
      headers: { authorization: string; "content-type": string };
      expiresInSeconds: number;
    }>;
  }> {
    return this.c.request("POST", "/v1/media/batch", { body: { items } });
  }
}

/** The header every PostLake webhook delivery is signed with. */
export const WEBHOOK_SIGNATURE_HEADER = "postlake-signature";

// HMAC-SHA256 to lowercase hex, via Web Crypto. NOTE: globalThis.crypto only
// became available unflagged in Node 19, so this needs Node 20+ (18 is EOL as
// of April 2025). Workers, Deno, Bun and browsers all have it natively. CI
// runs the matrix that proves this rather than trusting the claim.
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare so verification can't leak the signature via timing.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a PostLake webhook delivery before trusting it. Recomputes the
 * HMAC-SHA256 over `${timestamp}.${rawBody}` with your endpoint `secret` and
 * compares to the `postlake-signature` header in constant time. Pass
 * `toleranceSec` to also reject replays whose timestamp is too old.
 *
 * IMPORTANT: `rawBody` must be the EXACT bytes received — verify before parsing
 * JSON, and never re-serialize (whitespace changes break the signature).
 *
 *   import { verifyWebhookSignature } from "postlake";
 *   const ok = await verifyWebhookSignature(secret, rawBody, req.headers["postlake-signature"], { toleranceSec: 300 });
 *   if (!ok) return res.status(400).end();
 */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
  opts: { toleranceSec?: number; nowMs?: number } = {},
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (opts.toleranceSec !== undefined) {
    const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
    if (!Number.isFinite(Number(t)) || Math.abs(now - Number(t)) > opts.toleranceSec) return false;
  }
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return timingSafeEqualHex(expected, v1);
}

class Webhooks {
  constructor(private readonly c: PostLake) {}
  /** Register an endpoint. The signing `secret` is returned ONCE, here. */
  create(input: { url: string; events?: string[] }): Promise<WebhookEndpoint> {
    return this.c.request<WebhookEndpoint>("POST", "/v1/webhooks", { body: input });
  }
  list(): Promise<WebhookEndpoint[]> {
    return this.c.request<WebhookEndpoint[]>("GET", "/v1/webhooks");
  }
  delete(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.c.request("DELETE", `/v1/webhooks/${encodeURIComponent(id)}`);
  }
  /**
   * Verify a delivery's `postlake-signature` against the endpoint `secret`.
   * Pass the RAW request body. Convenience wrapper over {@link verifyWebhookSignature}.
   */
  verify(secret: string, rawBody: string, signatureHeader: string | null | undefined, opts?: { toleranceSec?: number }): Promise<boolean> {
    return verifyWebhookSignature(secret, rawBody, signatureHeader, opts);
  }
}
