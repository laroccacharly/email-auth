import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

export const Message = defineMessageUnion({
  SucceededFetchSession: { email: Schema.String },
  FailedFetchSession: { error: Schema.String },
  // The server answered 401: no session, or one that expired or was signed out of. The app sends it too, when one of
  // its own calls gets a 401.
  LostSession: {},
  ChangedEmail: { value: Schema.String },
  SubmittedSignIn: {},
  SentSignInLink: { email: Schema.String },
  FailedSendSignInLink: { error: Schema.String },
  ClickedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: { error: Schema.String },
  ClickedDismissNotice: {},
})
export type Message = typeof Message.Type

/** What the app hears: who signed in, and when they're signed out, so it can load or drop their data. */
export const OutMessage = defineMessageUnion({
  SignedIn: { email: Schema.String },
  SignedOut: {},
})
export type OutMessage = typeof OutMessage.Type
