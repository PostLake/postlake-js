// Import the BUILT package the way a consumer does.
//
// This exists because postlake@1.0.0 shipped broken: tsconfig uses
// moduleResolution "Bundler", which permits extensionless relative imports in
// source, but tsc emits them verbatim and Node's ESM loader rejects them. The
// unit tests run against src/ through vitest, which resolves like a bundler, so
// every check was green and the published tarball could not be imported at all.
//
// Testing the artefact, not the source, is the only thing that catches that.
import { PostLake, PostLakeError, WEBHOOK_SIGNATURE_HEADER } from "./dist/index.js";

const fail = (m) => { console.error("SMOKE FAIL:", m); process.exit(1); };

const pl = new PostLake({ apiKey: "sk_test" });
for (const r of ["posts", "socialAccounts", "analytics", "media", "webhooks"]) {
  if (typeof pl[r] !== "object") fail(`missing resource: ${r}`);
}
for (const m of ["create", "validate", "get", "list", "listAll", "update", "cancel", "analytics"]) {
  if (typeof pl.posts[m] !== "function") fail(`missing posts.${m}`);
}
if (typeof pl.me !== "function") fail("missing me()");
if (typeof PostLakeError !== "function") fail("PostLakeError not exported");
if (WEBHOOK_SIGNATURE_HEADER !== "postlake-signature") fail("webhook header wrong");
console.log("smoke ok: built package imports and exposes its full surface");
