// Public types for the PostLake SDK. These mirror the API's normalised response
// shapes (api/src/types.ts) so callers get full type-safety and autocomplete.

export type Platform =
  | "bluesky"
  | "threads"
  | "x"
  | "linkedin"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "pinterest";

export type PostState = "queued" | "scheduled" | "partial" | "published" | "failed";
export type TargetState = "queued" | "scheduled" | "published" | "failed";

export interface NormalisedError {
  type: string;
  message: string;
  platform?: Platform;
  retryable: boolean;
  /** `type` is the coarse category you route on and is deliberately small, so
   *  it cannot say WHICH input was wrong. These four turn a rejection into
   *  something an agent can act on rather than guess at:
   *    code   a stable, granular handle to branch on
   *    fix    the next action, in plain words
   *    docs   where the rule is written down
   *    param  the request field at fault
   *  All optional: an older API deployment simply omits them. */
  code?: string;
  fix?: string;
  docs?: string;
  param?: string;
}

/** One destination's verdict from `posts.validate`. */
export interface ValidateTargetResult {
  account: string;
  platform: Platform;
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The same code / fix / param a real publish would return, so a dry run
   *  teaches exactly what the live call teaches. */
  issues: { code: string; message: string; fix: string; param?: string; docs: string }[];
}

export interface ValidatePostResult {
  /** True only when every target validates. */
  ok: boolean;
  targets: ValidateTargetResult[];
}

export interface PinterestOptions {
  boardId?: string;
  link?: string;
  altText?: string;
}
export interface PlatformOptions {
  pinterest?: PinterestOptions;
}

export interface CreatePostInput {
  text: string;
  /** Connected social account ids (acc_…) to publish to. */
  accounts: string[];
  /** Media ids (med_…) from media.upload(). */
  media?: string[];
  /** ISO 8601 UTC. Omit to publish now. */
  scheduledAt?: string;
  /** IANA timezone (e.g. Europe/London). Interprets a naive scheduledAt as local time. */
  timezone?: string;
  platformOptions?: PlatformOptions;
}

export interface PostTarget {
  account: string;
  platform: Platform;
  state: TargetState;
  remoteId: string | null;
  url: string | null;
  publishedAt: string | null;
  error: NormalisedError | null;
}

export interface Post {
  id: string;
  state: PostState;
  createdAt: string;
  scheduledAt: string | null;
  timezone?: string;
  scheduledAtLocal?: string;
  text: string;
  media: string[];
  platformOptions?: PlatformOptions;
  warnings?: string[];
  targets: PostTarget[];
}

export interface ConnectedAccount {
  id: string;
  platform: Platform;
  handle: string;
  profileId: string | null;
  status: string;
}

export interface MediaAsset {
  id: string;
  url: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface Metrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  followers: number;
}
export interface PlatformAnalytics extends Metrics {
  platform: Platform;
}
export interface AnalyticsResponse {
  period: string;
  totals: Metrics;
  byPlatform: PlatformAnalytics[];
}

export interface PostAnalytics {
  postId: string;
  byTarget: Array<{ account: string; platform: Platform; metrics: Metrics | null }>;
  totals: Metrics;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  /** Present only in the create response, once. */
  secret?: string;
  createdAt: string;
}

export interface Account {
  id: string;
  email: string;
  platforms: Platform[];
  timezone?: string;
}

/** A page of results from a cursor-paginated list. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
