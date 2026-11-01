import { Option, Schema } from "effect"
import type { Url } from "foldkit/url"

/** Whether someone is signed in: unknown until `/auth/session` answers. */
export const Status = Schema.TaggedUnion({
  CheckingSession: {},
  SignedOut: {},
  SignedIn: { email: Schema.String },
})
export type Status = typeof Status.Type

export const Model = Schema.Struct({
  status: Status,
  emailInput: Schema.String,
  isSending: Schema.Boolean,
  // The email the last link was sent to.
  sentTo: Schema.Option(Schema.String),
  // The path the sign-in link brings the user back to: where they asked for it.
  returnTo: Schema.String,
  // An expired link, or a call that failed.
  notice: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

export const expiredLinkNotice = "That sign-in link expired or isn't valid: ask for a new one."

/** The `auth=expired` query the server sends a bad or expired link back to. */
const isExpiredLinkUrl = (url: Url) => Option.exists(url.search, (search) => new URLSearchParams(search).get("auth") === "expired")

// The query as it was, unless it has `auth` to drop.
const searchWithoutAuth = (search: string) => {
  const params = new URLSearchParams(search)
  if (!params.has("auth")) return `?${search}`
  params.delete("auth")
  const rest = params.toString()
  if (rest === "") return ""
  return `?${rest}`
}

const hashOf = (url: Url) => Option.match(url.hash, { onNone: () => "", onSome: (hash) => `#${hash}` })

/** The path, query and fragment of `url`, without the `auth` query, for the link to come back to. */
export const returnPathOf = (url: Url) => `${url.pathname}${Option.match(url.search, { onNone: () => "", onSome: searchWithoutAuth })}${hashOf(url)}`

export const initModel = (url: Url): Model => ({
  status: Status.cases.CheckingSession.make({}),
  emailInput: "",
  isSending: false,
  sentTo: Option.none(),
  returnTo: returnPathOf(url),
  notice: Option.some(expiredLinkNotice).pipe(Option.filter(() => isExpiredLinkUrl(url))),
})

/** The signed-in email, if any. */
export const signedInEmail = (model: Model): Option.Option<string> => {
  if (model.status._tag !== "SignedIn") return Option.none()
  return Option.some(model.status.email)
}
