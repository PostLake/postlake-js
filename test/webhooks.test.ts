// Webhook signature verification — the counterpart to the server's signing
// (api/src/lib/webhooks.ts `signatureHeader`). The known-answer vector below is
// asserted on BOTH sides (see api/test/webhooks.test.ts), so the two packages
// can never drift on the wire format.

import { describe, expect, it } from "vitest";
import { PostLake, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from "../src/index";

const SECRET = "whsec_test";
const BODY = JSON.stringify({ event: { id: "evt_1", type: "post.published" } });
const T = 1_700_000_000; // fixed unix seconds
const KAT_HEADER = `t=${T},v1=f929b9f7fadcd1a6061184b9ed143bb4c076ce1d8ad6d68d7a0a54ab264d9de4`;

describe("verifyWebhookSignature", () => {
  it("accepts a genuine signature (known-answer vector — matches the server)", async () => {
    expect(await verifyWebhookSignature(SECRET, BODY, KAT_HEADER)).toBe(true);
  });

  it("is also reachable as pl.webhooks.verify(...)", async () => {
    const pl = new PostLake({ apiKey: "sk_test" });
    expect(await pl.webhooks.verify(SECRET, BODY, KAT_HEADER)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    expect(await verifyWebhookSignature(SECRET, BODY + " ", KAT_HEADER)).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    expect(await verifyWebhookSignature("whsec_wrong", BODY, KAT_HEADER)).toBe(false);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await verifyWebhookSignature(SECRET, BODY, null)).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, "")).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, "garbage")).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, `t=${T}`)).toBe(false); // no v1
  });

  it("rejects a stale timestamp when toleranceSec is set (replay protection)", async () => {
    // 10,000s later, tolerance 300s → rejected
    expect(await verifyWebhookSignature(SECRET, BODY, KAT_HEADER, { toleranceSec: 300, nowMs: (T + 10_000) * 1000 })).toBe(false);
    // 60s later, tolerance 300s → still accepted
    expect(await verifyWebhookSignature(SECRET, BODY, KAT_HEADER, { toleranceSec: 300, nowMs: (T + 60) * 1000 })).toBe(true);
  });

  it("exposes the signature header name", () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("postlake-signature");
  });
});
