import { Schema, SchemaTransformation } from "effect"

/** An email address, trimmed and lowercased so `Me@X.com` and `me@x.com` are the same person. */
export const Email = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim()),
  Schema.decode(SchemaTransformation.toLowerCase()),
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/), Schema.isMaxLength(254)),
)

/**
 * Percent-encodes every character outside printable ASCII, and `"` and `\`, so the path is a valid `Location`
 * value and needs no escaping in the token's JSON. Existing `%xx` escapes are left as they are.
 */
const percentEncodeUnsafe = (path: string) => path.replace(/[^\x21-\x7E]|["\\]/gu, encodeURIComponent)

/** A slash or backslash, literal or percent-encoded, right after the leading `/` would make a protocol-relative URL. */
const startsLikeProtocolRelative = /^\/(?:[/\\]|%2f|%5c)/i

/**
 * A path on the app, such as `/` or `/jobs/abc`; never `//evil.com` or `https://…`, so it can't be an open
 * redirect. Decoded to a valid `Location` header value, short enough that the link token stays verifiable.
 */
export const AppPath = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\//),
    Schema.makeFilter((path) => !startsLikeProtocolRelative.test(path)),
    Schema.makeFilter((path) => path.isWellFormed()),
  ),
  Schema.decode(SchemaTransformation.transform({ decode: percentEncodeUnsafe, encode: (path: string) => path })),
  Schema.check(Schema.isMaxLength(2048)),
)
