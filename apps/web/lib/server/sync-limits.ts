/** Clients push at most 200 changes per request (`runSync` in @rock_ht/sync); this is the hard cap. */
export const MAX_PUSH_CHANGES = 500
/** Clients pull with `limit=200`; larger requests are clamped to this. */
export const MAX_PULL_LIMIT = 500
export const DEFAULT_PULL_LIMIT = 200
