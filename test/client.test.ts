// SDK tests — drive the client against a fake fetch so we assert the exact
// requests it builds (auth, JSON, idempotency, pagination, query) and how it
// maps responses + errors. No network.

import { describe, expect, it, vi } from "vitest";
import { PostLake, PostLakeError } from "../src/index";

type Call = { url: string; init: RequestInit };

/** A fake fetch that records calls and returns queued responses. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)] ?? { status: 200, body: {} };
    const status = r.status ?? 200;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req_test", ...(r.headers ?? {}) },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const client = (fetchImpl: typeof fetch) => new PostLake({ apiKey: "sk_live_test", fetch: fetchImpl });

describe("PostLake client", () => {
  it("requires an apiKey", () => {
    expect(() => new PostLake({} as never)).toThrow(/apiKey is required/);
  });

  it("sends the bearer token and parses JSON", async () => {
    const { fn, calls } = fakeFetch([{ body: { id: "acct_1", email: "a@b.c", platforms: ["bluesky"] } }]);
    const me = await client(fn).me();
    expect(me).toEqual({ id: "acct_1", email: "a@b.c", platforms: ["bluesky"] });
    expect(calls[0].url).toBe("https://api.postlake.dev/v1/me");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk_live_test");
  });

  it("posts.create sends JSON + an idempotency key", async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: "post_1", state: "published", targets: [] } }]);
    const post = await client(fn).posts.create({ text: "hi", accounts: ["acc_1"] }, { idempotencyKey: "key-123" });
    expect(post.id).toBe("post_1");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("application/json");
    expect(h["idempotency-key"]).toBe("key-123");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: "hi", accounts: ["acc_1"] });
    expect(calls[0].init.method).toBe("POST");
  });

  it("posts.list maps {posts,nextCursor} → {data,nextCursor} and passes query", async () => {
    const { fn, calls } = fakeFetch([{ body: { posts: [{ id: "post_1" }], nextCursor: "post_1" } }]);
    const page = await client(fn).posts.list({ limit: 10 });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBe("post_1");
    expect(calls[0].url).toContain("limit=10");
  });

  it("posts.listAll auto-paginates across pages then stops", async () => {
    const { fn, calls } = fakeFetch([
      { body: { posts: [{ id: "p1" }, { id: "p2" }], nextCursor: "p2" } },
      { body: { posts: [{ id: "p3" }], nextCursor: null } },
    ]);
    const ids: string[] = [];
    for await (const p of client(fn).posts.listAll()) ids.push(p.id);
    expect(ids).toEqual(["p1", "p2", "p3"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("cursor=p2");
  });

  it("throws a typed PostLakeError carrying type/status/retryable/requestId", async () => {
    const { fn } = fakeFetch([{ status: 429, body: { error: { type: "rate_limited", message: "slow down", retryable: true } } }]);
    await expect(client(fn).posts.create({ text: "x", accounts: ["a"] })).rejects.toMatchObject({
      name: "PostLakeError",
      type: "rate_limited",
      status: 429,
      retryable: true,
      requestId: "req_test",
      message: "slow down",
    });
  });

  it("falls back gracefully on a non-JSON error body", async () => {
    const { fn } = fakeFetch([{ status: 502, body: undefined }]);
    const err = await client(fn).me().catch((e) => e);
    expect(err).toBeInstanceOf(PostLakeError);
    expect(err.status).toBe(502);
  });

  it("media.upload sends raw bytes with the given content-type (no JSON)", async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: "med_1", url: "https://x/y", contentType: "image/png", size: 3, createdAt: "" } }]);
    const bytes = new Uint8Array([1, 2, 3]);
    const asset = await client(fn).media.upload(bytes, "image/png");
    expect(asset.id).toBe("med_1");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("image/png");
    expect(calls[0].init.body).toBe(bytes);
  });

  it("respects a custom baseUrl", async () => {
    const { fn, calls } = fakeFetch([{ body: {} }]);
    await new PostLake({ apiKey: "k", baseUrl: "http://localhost:8787/", fetch: fn }).me();
    expect(calls[0].url).toBe("http://localhost:8787/v1/me");
  });
});
