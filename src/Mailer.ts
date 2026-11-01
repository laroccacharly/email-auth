import { Context, Effect, Schema } from "effect"

export class MailerError extends Schema.TaggedError<MailerError>()("MailerError", {
  cause: Schema.Defect(),
}) {}

export interface Mail {
  readonly to: string
  readonly subject: string
  readonly text: string
}

/** Sends one plain-text email. Provided by the app. */
export class Mailer extends Context.Service<Mailer, {
  send(mail: Mail): Effect.Effect<void, MailerError>
}>()("email-auth/Mailer") {}
