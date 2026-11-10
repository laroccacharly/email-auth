import { Context, Effect, Layer, Schema } from "effect"
import { Email } from "./Email.ts"

/** `S` if it reads as one email (`local@domain`, no spaces), else `never`. A plain `string` is left to the runtime check. */
type EmailLiteral<S extends string> = string extends S ? S
  : S extends `${string} ${string}` | `${string}@${string}@${string}` | `@${string}` | `${string}@` ? never
  : S extends `${string}@${string}` ? S
  : never

type EmailLiterals<Emails extends ReadonlyArray<string>> = { readonly [K in keyof Emails]: EmailLiteral<Emails[K]> }

const isIn = (allowed: ReadonlySet<string>) => KnownEmail.of({ check: (email) => Effect.succeed(allowed.has(email)) })

/**
 * Whether an email (already trimmed and lowercased) may sign in. The app provides it, picking `KnownEmail.anyone`,
 * `KnownEmail.allowList([...])`, or its own check.
 */
export class KnownEmail extends Context.Service<KnownEmail, {
  check(email: string): Effect.Effect<boolean>
}>()("email-auth/KnownEmail") {
  /** Every email may sign in. */
  static readonly anyone: Layer.Layer<KnownEmail> = Layer.succeed(KnownEmail, { check: () => Effect.succeed(true) })

  /**
   * Only these emails may sign in. The list can't be empty (use `anyone` for that), and every entry must be an email:
   * checked by the compiler for literals, and when the layer is built for the rest, which then fails.
   */
  static allowList<const Emails extends readonly [string, ...Array<string>]>(
    emails: Emails & EmailLiterals<Emails>,
  ): Layer.Layer<KnownEmail, Schema.SchemaError> {
    return Layer.effect(
      KnownEmail,
      Effect.map(Schema.decodeUnknownEffect(Schema.NonEmptyArray(Email))(emails), (list) => isIn(new Set(list))),
    )
  }
}
