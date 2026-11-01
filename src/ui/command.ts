import { Effect, Predicate, Schema } from "effect"
import { HttpClientError } from "effect/http"
import { HttpApi, HttpApiClient } from "effect/http-api"
import { Command, Http } from "foldkit"
import { EmailAuthGroup } from "../EmailAuthGroup.ts"
import { Message } from "./message.ts"

const AuthApi = HttpApi.make("email-auth").add(EmailAuthGroup)

type AuthClient = HttpApiClient.ForApi<typeof AuthApi>

// On the page's own origin, which serves the `auth` endpoints and gets the session cookie.
const authClient = HttpApiClient.make(AuthApi).pipe(Effect.provide(Http.layer))

const isTooManyRequests = (error: HttpClientError.HttpClientError) => "response" in error.reason && error.reason.response.status === 429

const describeHttpFailure = (error: HttpClientError.HttpClientError) => {
  if (error.reason._tag === "TransportError") return "Couldn't reach the server: check your connection and try again."
  if (isTooManyRequests(error)) return "Too many requests: try again in a few seconds."
  return error.message
}

/** What went wrong, in words. */
export const describeFailure = (error: { readonly _tag: string }) => {
  if (HttpClientError.isHttpClientError(error)) return describeHttpFailure(error)
  if (error._tag === "SchemaError") return "That doesn't look like an email address."
  if (Predicate.hasProperty(error, "message") && Predicate.isString(error.message) && error.message !== "") return error.message
  return error._tag
}

// A 401 means there's no session, whatever the call.
const callAuth = <A extends Message, B extends Message, E extends { readonly _tag: string }>(
  call: (client: AuthClient) => Effect.Effect<A, E>,
  onFailure: (error: string) => B,
) =>
  authClient.pipe(
    Effect.flatMap(call),
    Effect.catch((error): Effect.Effect<B | typeof Message.LostSession.Type> => {
      if (error._tag === "Unauthorized") return Effect.succeed(Message.LostSession())
      return Effect.succeed(onFailure(describeFailure(error)))
    }),
  )

/** Who is signed in, if anyone. */
export const FetchSession = Command.define("FetchSession", {
  messages: [Message.SucceededFetchSession, Message.FailedFetchSession, Message.LostSession],
  execute: callAuth(
    (client) => client.auth.session().pipe(Effect.map((session) => Message.SucceededFetchSession({ email: session.email }))),
    (error) => Message.FailedFetchSession({ error }),
  ),
})

/** Asks the server to email a sign-in link, which brings the user back to `redirect`. */
export const SendSignInLink = Command.define("SendSignInLink", {
  args: { email: Schema.String, redirect: Schema.String },
  messages: [Message.SentSignInLink, Message.FailedSendSignInLink, Message.LostSession],
  execute: ({ email, redirect }) =>
    callAuth(
      (client) => client.auth.login({ payload: { email, redirect } }).pipe(Effect.as(Message.SentSignInLink({ email }))),
      (error) => Message.FailedSendSignInLink({ error }),
    ),
})

/** Clears the session cookie; the server answers 401 when there was none, which is signed out too. */
export const SignOut = Command.define("SignOut", {
  messages: [Message.SucceededSignOut, Message.FailedSignOut, Message.LostSession],
  execute: callAuth(
    (client) => client.auth.logout().pipe(Effect.as(Message.SucceededSignOut())),
    (error) => Message.FailedSignOut({ error }),
  ),
})
