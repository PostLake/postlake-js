// The SDK's job on an error is to hand back something an agent can act on. That
// means the guidance fields survive the trip from the wire to the thrown object,
// and that a dry run is available so an agent can find out for free rather than
// by spending a credit and failing.
import { describe, it, expect } from "vitest";
import { PostLake, PostLakeError } from "../src/index";

function stub(status: number, body: unknown, capture?: (url: string, init: RequestInit) => void) {
  return async (url: string, init?: RequestInit) => {
    capture?.(url, init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req_abc" },
    });
  };
}

describe("error guidance", () => {
  it("carries code, fix, docs and param through to the thrown error", async () => {
    const pl = new PostLake({
      apiKey: "sk_test",
      fetch: stub(400, {
        error: {
          type: "invalid_request",
          message: "Bluesky allows 300 characters. This is 412.",
          retryable: false,
          platform: "bluesky",
          code: "text_too_long",
          fix: "Trim the caption, or send a shorter version to Bluesky only.",
          docs: "https://docs.postlake.dev/errors#text_too_long",
          param: "text",
        },
      }),
    });

    const err = await pl.posts.create({ text: "x", accounts: ["acc_1"] }).catch((e) => e);
    expect(err).toBeInstanceOf(PostLakeError);
    expect(err.code).toBe("text_too_long");
    expect(err.param).toBe("text");
    expect(err.docs).toBe("https://docs.postlake.dev/errors#text_too_long");
    expect(err.fix).toContain("Trim the caption");
    expect(err.retryable).toBe(false);
    expect(err.platform).toBe("bluesky");
    expect(err.requestId).toBe("req_abc");
  });

  it("still works against a deployment that sends none of them", async () => {
    const pl = new PostLake({
      apiKey: "sk_test",
      fetch: stub(429, { error: { type: "rate_limited", message: "slow down", retryable: true } }),
    });
    const err = await pl.me().catch((e) => e);
    expect(err).toBeInstanceOf(PostLakeError);
    expect(err.retryable).toBe(true);
    expect(err.code).toBeUndefined();
    expect(err.fix).toBeUndefined();
  });
});

describe("posts.validate", () => {
  it("posts the draft to the dry-run endpoint and returns per-target issues", async () => {
    let seenUrl = "";
    let seenBody: unknown;
    const pl = new PostLake({
      apiKey: "sk_test",
      fetch: stub(
        200,
        {
          ok: false,
          targets: [
            {
              account: "acc_1",
              platform: "tiktok",
              ok: false,
              errors: ["TikTok cannot publish text on its own"],
              warnings: [],
              issues: [
                {
                  code: "media_required",
                  message: "TikTok cannot publish text on its own",
                  fix: "Attach an image or a video.",
                  param: "media",
                  docs: "https://docs.postlake.dev/errors#media_required",
                },
              ],
            },
          ],
        },
        (url, init) => {
          seenUrl = url;
          seenBody = JSON.parse(String(init.body));
        },
      ),
    });

    const res = await pl.posts.validate({ text: "hello", accounts: ["acc_1"] });
    expect(seenUrl).toContain("/v1/posts/validate");
    expect(seenBody).toEqual({ text: "hello", accounts: ["acc_1"] });
    expect(res.ok).toBe(false);
    expect(res.targets[0].platform).toBe("tiktok");
    expect(res.targets[0].issues[0].code).toBe("media_required");
    expect(res.targets[0].issues[0].fix).toContain("Attach an image");
  });

  it("does not spend an idempotency key: a dry run has nothing to make idempotent", async () => {
    let seenHeaders: HeadersInit | undefined;
    const pl = new PostLake({
      apiKey: "sk_test",
      fetch: stub(200, { ok: true, targets: [] }, (_u, init) => { seenHeaders = init.headers; }),
    });
    await pl.posts.validate({ text: "hello", accounts: ["acc_1"] });
    const headers = new Headers(seenHeaders);
    expect(headers.get("idempotency-key")).toBeNull();
  });
});
