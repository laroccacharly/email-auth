import { Context, Effect } from "effect"

/** Whether an email (already trimmed and lowercased) may sign in. Provided by the app. */
export class KnownEmail extends Context.Service<KnownEmail, {
  check(email: string): Effect.Effect<boolean>
}>()("email-auth/KnownEmail") {}
