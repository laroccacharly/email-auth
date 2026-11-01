import { Config, DateTime, Duration, Effect, Layer, Redacted } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApi, HttpApiBuilder, type HttpApiEndpoint, type HttpApiGroup } from "effect/http-api"
import type { JoseError } from "effect/jose"
import { EmailAuthGroup } from "./EmailAuthGroup.ts"
import { KnownEmail } from "./KnownEmail.ts"
import { Mailer } from "./Mailer.ts"
import { Session, sessionCookie, SignedInEmail } from "./Session.ts"
import { Tokens } from "./Tokens.ts"

export interface EmailAuthOptions {
  /** At least 32 bytes, e.g. `openssl rand -base64 32`. */
  readonly secret: Config.Config<Redacted.Redacted<string>>
  /** The app's public origin; the link is `${baseUrl}/auth/callback?token=…`. */
  readonly baseUrl: Config.Config<string>
  /** Named in the email's subject and body. */
  readonly appName: string
  readonly linkTtl?: Duration.Input
  readonly sessionTtl?: Duration.Input
}

const expiredLinkRedirect = "/?auth=expired"

const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const

const callbackUrl = (baseUrl: string, token: string) => {
  const url = new URL("/auth/callback", baseUrl)
  url.searchParams.set("token", token)
  return url.toString()
}

const signInMail = (to: string, appName: string, link: string, linkTtl: Duration.Input) => ({
  to,
  subject: `Sign in to ${appName}`,
  text: [
    `Click this link to sign in to ${appName}:`,
    "",
    link,
    "",
    `The link expires in ${Math.round(Duration.toMinutes(linkTtl))} minutes. If you didn't ask for it, ignore this email.`,
  ].join("\n"),
})

const redirectWithSession = (location: string, sessionToken: string, sessionTtl: Duration.Input) =>
  HttpServerResponse.redirect(location, { status: 303 }).pipe(
    HttpServerResponse.setCookie(sessionCookie.key, sessionToken, { ...cookieOptions, maxAge: sessionTtl }),
    Effect.orDie,
  )

const noContentClearingSession = HttpServerResponse.empty({ status: 204 }).pipe(
  HttpServerResponse.expireCookie(sessionCookie.key, cookieOptions),
  Effect.orDie,
)

// The handlers are typed against this API; at runtime they use the app's API, whose annotations they read.
const EmailAuthApi = HttpApi.make("email-auth").add(EmailAuthGroup)

const authHandlers = (
  api: typeof EmailAuthApi,
  options: EmailAuthOptions & { readonly linkTtl: Duration.Input; readonly sessionTtl: Duration.Input },
) =>
  HttpApiBuilder.group(api, "auth", Effect.fnUntraced(function* (handlers) {
    const tokens = yield* Tokens
    const knownEmail = yield* KnownEmail
    const mailer = yield* Mailer
    const baseUrl = yield* options.baseUrl

    const sendLinkIfKnown = Effect.fnUntraced(function* (email: string, redirect: string) {
      if (!(yield* knownEmail.check(email))) return
      const token = yield* tokens.signLink(email, redirect)
      yield* mailer.send(signInMail(email, options.appName, callbackUrl(baseUrl, token), options.linkTtl))
    }, Effect.catchTag("MailerError", (error) => Effect.logError("email-auth: sending the sign-in link failed", error)))

    const signInFromLink = (token: string) =>
      tokens.verifyLink(token).pipe(
        Effect.flatMap((link) =>
          Effect.flatMap(tokens.signSession(link.email), (session) =>
            redirectWithSession(link.redirect, session, options.sessionTtl))
        ),
        Effect.catchTag("Unauthorized", () => Effect.succeed(HttpServerResponse.redirect(expiredLinkRedirect, { status: 303 }))),
      )

    const currentSession = Effect.flatMap(HttpApiBuilder.securityDecode(sessionCookie), (cookie) =>
      Effect.map(tokens.verifySession(Redacted.value(cookie)), (session) => ({
        email: session.email,
        expires_at: DateTime.makeUnsafe(session.exp * 1000),
      })))

    return handlers.handleAll({
      login: ({ payload }) => sendLinkIfKnown(payload.email, payload.redirect ?? "/"),
      callback: ({ query }) => signInFromLink(query.token ?? ""),
      logout: () => noContentClearingSession,
      session: () => currentSession,
    })
  }))

const sessionMiddleware = Layer.effect(
  Session,
  Effect.gen(function* () {
    const tokens = yield* Tokens
    return Session.of({
      cookie: (httpEffect, { credential }) =>
        Effect.flatMap(tokens.verifySession(Redacted.value(credential)), (session) =>
          Effect.provideService(httpEffect, SignedInEmail, session.email)),
    })
  }),
)

/** The app's `auth` group: `EmailAuthGroup`, with any middleware the app added to its whole `HttpApi`. */
type AuthGroupOf<Groups> = Extract<Groups, { readonly identifier: "auth" }>

/** The middleware the app put on the `auth` endpoints, and what it needs, which their handlers then need too. */
type AppMiddlewareOf<Groups> = Exclude<
  | HttpApiEndpoint.Middleware<HttpApiGroup.Endpoints<AuthGroupOf<Groups>>>
  | HttpApiEndpoint.MiddlewareServices<HttpApiGroup.Endpoints<AuthGroupOf<Groups>>>,
  Session
>

/** A compile error, naming the problem, for an `HttpApi` without `EmailAuthGroup`. */
type RequireAuthGroup<Groups> = [AuthGroupOf<Groups>] extends [never] ? { readonly "the HttpApi must add EmailAuthGroup": never } : object

/**
 * The `auth` handlers and the `Session` middleware, for an app whose `HttpApi` includes `EmailAuthGroup`. Middleware the
 * app adds to its whole API (`HttpApi.middleware`) runs on the `auth` endpoints too, so the layer needs it provided.
 */
export const layer = <ApiId extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<ApiId, Groups> & RequireAuthGroup<Groups>,
  options: EmailAuthOptions,
): Layer.Layer<
  HttpApiGroup.Service<ApiId, "auth"> | Session,
  Config.ConfigError | JoseError.JoseError,
  KnownEmail | Mailer | AppMiddlewareOf<Groups>
> => {
  const resolved = { ...options, linkTtl: options.linkTtl ?? "15 minutes", sessionTtl: options.sessionTtl ?? "30 days" }
  const handlers = authHandlers(api as never as typeof EmailAuthApi, resolved) as Layer.Layer<
    HttpApiGroup.Service<ApiId, "auth">,
    Config.ConfigError,
    KnownEmail | Mailer | Tokens | Session | AppMiddlewareOf<Groups>
  >
  return handlers.pipe(Layer.provideMerge(sessionMiddleware), Layer.provide(Tokens.layer(resolved)))
}
