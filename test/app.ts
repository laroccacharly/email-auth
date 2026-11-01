import { Clock, Config, type Duration, Effect, Layer, Redacted, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { TestClock } from "effect/testing"
import { EmailAuth, EmailAuthGroup, KnownEmail, type Mail, Mailer, MailerError, Session, SignedInEmail } from "../src/index.ts"

class MeGroup extends HttpApiGroup.make("me")
  .add(HttpApiEndpoint.get("whoami", "/api/me", { success: Schema.Struct({ email: Schema.String }) }))
  .middleware(Session) {}

class TestApi extends HttpApi.make("test").add(EmailAuthGroup).add(MeGroup) {}

const meHandlers = HttpApiBuilder.group(TestApi, "me", (handlers) =>
  handlers.handle("whoami", () =>
    Effect.gen(function* () {
      return { email: yield* SignedInEmail }
    })))

export const baseUrl = "https://notes.example"

interface TestAppOptions {
  readonly knownEmails: ReadonlyArray<string>
  readonly mailerFails?: boolean
}

/** The test app as a fetch handler, with the mail it sent and a clock the test moves. */
export const makeTestApp = async (options: TestAppOptions) => {
  const sent: Array<Mail> = []
  const clock = await Effect.runPromise(Effect.scoped(TestClock.make()))

  const knownEmail = Layer.succeed(KnownEmail, {
    check: (email) => Effect.succeed(options.knownEmails.includes(email)),
  })
  const mailer = Layer.succeed(Mailer, {
    send: (mail) => {
      if (options.mailerFails) return Effect.fail(new MailerError({ cause: "provider down" }))
      return Effect.sync(() => void sent.push(mail))
    },
  })
  const emailAuth = EmailAuth.layer(TestApi, {
    secret: Config.succeed(Redacted.make("a-test-secret-that-is-at-least-32-bytes-long")),
    baseUrl: Config.succeed(baseUrl),
    appName: "Notes",
  }).pipe(Layer.provide([knownEmail, mailer]))

  const routes = HttpApiBuilder.layer(TestApi).pipe(
    Layer.provide(meHandlers),
    Layer.provide(emailAuth),
    Layer.provide(HttpServer.layerServices),
    Layer.provide(Layer.succeed(Clock.Clock, clock)),
  )
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true })

  const request = (path: string, init?: RequestInit) => handler(new Request(`${baseUrl}${path}`, init))
  const advance = (duration: Duration.Input) => Effect.runPromise(clock.adjust(duration))
  return { request, advance, sent, dispose }
}

export const postJson = (body: { readonly email: string; readonly redirect?: string }): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/** Pulls the sign-in link out of an email, as a user clicking it would, and returns its path. */
export const linkPath = (mail: Mail) => {
  const link = mail.text.match(/https:\/\/\S+/)?.[0]
  if (link === undefined) throw new Error(`no link in: ${mail.text}`)
  const url = new URL(link)
  return `${url.pathname}${url.search}`
}

/** The `name=value` pair of the session cookie set by a response, to send back as a `Cookie` header. */
export const sessionCookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? ""
