import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { AppPath, Email } from "./Email.ts"
import { Session } from "./Session.ts"

export const SessionInfo = Schema.Struct({
  email: Schema.String,
  expires_at: Schema.DateTimeUtcFromString,
})

/** The `auth` endpoints, added by the app to its `HttpApi`. */
export class EmailAuthGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/auth/login", {
      payload: Schema.Struct({ email: Email, redirect: Schema.optionalKey(AppPath) }),
      success: HttpApiSchema.NoContent,
    }),
    HttpApiEndpoint.get("callback", "/auth/callback", {
      query: { token: Schema.optionalKey(Schema.String) },
      success: HttpApiSchema.Empty(303),
    }),
    HttpApiEndpoint.post("logout", "/auth/logout", {
      success: HttpApiSchema.NoContent,
      error: HttpApiError.Unauthorized,
    }).middleware(Session),
    HttpApiEndpoint.get("session", "/auth/session", {
      success: SessionInfo,
      error: HttpApiError.Unauthorized,
    }),
  ) {}
