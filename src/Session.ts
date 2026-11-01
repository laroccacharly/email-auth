import { Context } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

/** The signed-in email, provided by `Session` to the handlers of the groups it protects. */
export class SignedInEmail extends Context.Service<SignedInEmail, string>()("email-auth/SignedInEmail") {}

export const sessionCookie = HttpApiSecurity.apiKey({ in: "cookie", key: "session" })

/** Reads the `session` cookie; a group that adds it answers `401` without a valid one. */
export class Session extends HttpApiMiddleware.Service<Session, {
  provides: SignedInEmail
}>()("email-auth/Session", {
  security: { cookie: sessionCookie },
  error: HttpApiError.Unauthorized,
}) {}
