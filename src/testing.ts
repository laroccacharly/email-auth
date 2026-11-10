import { Config, type Duration, Effect, type Redacted, Schema } from "effect"
import type { JoseError } from "effect/jose"
import { Email } from "./Email.ts"
import { sessionCookie as sessionCookieSecurity } from "./Session.ts"
import { Tokens } from "./Tokens.ts"

export interface SessionCookieOptions {
  /** The app's `EmailAuth.layer` secret. */
  readonly secret: Redacted.Redacted<string>
  readonly email: string
  readonly sessionTtl?: Duration.Input
}

/**
 * A cookie's name and value, as a `Cookie` header takes them, with the `path` and `secure` its `__Host-` name needs: a
 * browser test adds the `domain` (`localhost`), since a browser turns `secure` off for an `http://` url.
 */
export interface SessionCookie {
  readonly name: string
  readonly value: string
  readonly path: "/"
  readonly secure: true
}

/**
 * The `__Host-session` cookie a sign-in link would set for `email`, signed with the app's secret, so an app's tests start
 * signed in without sending or clicking a link. Whoever holds the secret could sign it anyway; nothing is opened up.
 */
export const sessionCookie = Effect.fnUntraced(function* (
  options: SessionCookieOptions,
): Effect.fn.Return<SessionCookie, Config.ConfigError | JoseError.JoseError | Schema.SchemaError> {
  const email = yield* Schema.decodeEffect(Email)(options.email)
  const value = yield* Tokens.use((tokens) => tokens.signSession(email)).pipe(
    Effect.provide(Tokens.layer({
      secret: Config.succeed(options.secret),
      linkTtl: "15 minutes",
      sessionTtl: options.sessionTtl ?? "30 days",
    })),
  )
  return { name: sessionCookieSecurity.key, value, path: "/", secure: true }
})
