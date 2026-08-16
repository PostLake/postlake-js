# PostLake

**The social media API for AI agents.** One integration publishes, schedules and measures across X, LinkedIn, Instagram, TikTok, Facebook, Threads, Bluesky, YouTube and Pinterest.

Typed, tiny and dependency-free. Runs anywhere there is a global `fetch`: Node 20+, Cloudflare Workers, Deno, Bun, the browser.

```bash
npm install postlake
```

## Publish to several networks in one call

```ts
import { PostLake } from "postlake";

const pl = new PostLake({ apiKey: process.env.POSTLAKE_API_KEY });

const post = await pl.posts.create({
  text: "the new release is here",
  accounts: ["acc_2f1a", "acc_9b7c"],
});

console.log(post.state, post.targets);
```

One response shape covers every network. `post.targets` has a row per destination, each with its own state, permalink and error, so partial success is a thing you can read rather than a thing you have to infer.

## Built for agents, not just for scripts

This is the part that matters if something autonomous is holding the key.

**Retries cannot double-post.** Pass an idempotency key and a retried request returns the original result instead of publishing twice.

```ts
await pl.posts.create(
  { text: "hi", accounts: ["acc_1"] },
  { idempotencyKey: crypto.randomUUID() },
);
```

**Errors say how to fix themselves.** Every failure carries a machine-readable `code`, the `param` at fault, a plain `fix` and a `docs` link. An agent can act on that without a human reading a stack trace.

```ts
import { PostLakeError } from "postlake";

try {
  await pl.posts.create({ text: longCaption, accounts: ["acc_bluesky"] });
} catch (e) {
  if (e instanceof PostLakeError) {
    console.error(e.code);      // "text_too_long"
    console.error(e.fix);       // "Bluesky allows 300 characters. This is 412."
    console.error(e.docs);      // https://docs.postlake.dev/errors#text_too_long
    console.error(e.requestId); // quote this to support
    if (e.retryable) { /* back off and retry */ }
  }
}
```

**Bad posts are refused before they cost anything.** Every network's rules are checked up front, so a caption over the limit or an image outside the pixel bounds fails immediately rather than several minutes into an async publish.

```ts
const check = await pl.posts.validate({ text, accounts, media });
if (!check.ok) console.log(check.issues); // per-network, with the fix for each
```

## What you can call

| Resource | Methods |
|---|---|
| `pl.posts` | `create`, `validate`, `get`, `list`, `listAll`, `update`, `cancel`, `analytics` |
| `pl.socialAccounts` | `list`, `listAll`, `connect`, `targets` |
| `pl.analytics` | `get` |
| `pl.media` | `upload` |
| `pl.webhooks` | `create`, `list`, `delete` |
| `pl` | `me()` |

`list` returns one page; `listAll` is an async iterator over everything:

```ts
for await (const post of pl.posts.listAll()) {
  console.log(post.id, post.state);
}
```

## Cross-platform analytics in one shape

Impressions, reach, engagement, CTR, saves and follower growth, normalised across networks so they can actually be compared.

```ts
const stats = await pl.analytics.get({ period: "30d" });
console.log(stats.totals, stats.byPlatform);
```

## Scheduling

```ts
await pl.posts.create({
  text: "weekly recap",
  accounts: ["acc_2f1a"],
  scheduledAt: "2026-09-01T09:00:00Z", // ISO 8601, UTC
});
```

## The networks, and what each one will take

Every network keeps its own rules, and they are further apart than people expect.

| Network | Caption limit | A post needs | Images |
|---|---|---|---|
| X | 280 | nothing, text is fine | 4 |
| Bluesky | 300 | nothing, text is fine | 4 |
| Threads | 500 | nothing, text is fine | 20 |
| Pinterest | 500 | an image or video | 5 |
| Instagram | 2,200 | an image or video | 10 |
| TikTok | 2,200 | an image or video | 35 |
| LinkedIn | 3,000 | nothing, text is fine | 20 |
| YouTube | 5,000 | a video | none |
| Facebook | 63,206 | nothing, text is fine | 10 |

The live version of this table, including formats, weight caps and pixel bounds, is at [postlake.dev/tools](https://postlake.dev/tools/) and machine-readable at [postlake.dev/capabilities.json](https://postlake.dev/capabilities.json). The SDK validates against the same source.

## Configuration

```ts
new PostLake({
  apiKey: "sk_live_…",                 // create one in the dashboard under API Keys
  baseUrl: "https://api.postlake.dev", // override for tests
  fetch: customFetch,                  // inject a fetch implementation
});
```

## Prefer not to write code at all

PostLake runs a hosted MCP server, so Claude, Cursor, ChatGPT or any MCP-capable agent can post, schedule and read analytics directly. Point it at `https://api.postlake.dev/mcp` and approve once over OAuth. See [postlake.dev/mcp](https://postlake.dev/mcp).

For coding agents there are ready-made skills:

```bash
npx skills add postlake/postlake-mcp --all
```

## Pricing

Free to start: 20 credits a month, no card. Paid plans start at $13/month for 2,000 posts. Unlimited connected accounts on every plan. [Full pricing](https://postlake.dev/pricing).

## Links

- Documentation: https://docs.postlake.dev
- Quickstart: https://docs.postlake.dev/quickstart
- Error reference: https://docs.postlake.dev/errors
- Free tools, no signup: https://postlake.dev/tools/
- For LLMs: https://postlake.dev/llms.txt

## License

MIT
