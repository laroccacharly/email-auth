import { Context } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

/** The signed-in email, provided by `Session` to the handlers of the groups it protects. */
export class SignedInEmail extends Context.Service<SignedInEmail, string>()("email-auth/SignedInEmail") {}

// `__Host-`: browsers only keep it Secure, on `/`, without a `Domain`, so no cookie from a parent domain or a longer
// path can be sent ahead of it under the same name.
export const sessionCookie = HttpApiSecurity.apiKey({ in: "cookie", key: "__Host-session" })

/** Reads the `__Host-session` cookie; a group that adds it answers `401` without a valid one. */
export class Session extends HttpApiMiddleware.Service<Session, {
  provides: SignedInEmail
}>()("email-auth/Session", {
  security: { cookie: sessionCookie },
  error: HttpApiError.Unauthorized,
}) {}
