import { Clock, Config, Context, Duration, Effect, Layer, Redacted, Schema } from "effect"
import { Mac, SecureRandom } from "effect/crypto"
import { Base64Url } from "effect/encoding"
import { HttpApiError } from "effect/http-api"
import { Jwk, Jwt } from "effect/jose"

const LinkClaims = Schema.Struct({ email: Schema.String, redirect: Schema.String, exp: Schema.Int })
const SessionClaims = Schema.Struct({ email: Schema.String, exp: Schema.Int })

export type LinkClaims = typeof LinkClaims.Type
export type SessionClaims = typeof SessionClaims.Type

const linkTyp = "email-auth-link"
const sessionTyp = "email-auth-session"
const maxTokenLength = 4096

export interface TokensOptions {
  /** At least 32 bytes, e.g. `openssl rand -base64 32`. */
  readonly secret: Config.Config<Redacted.Redacted<string>>
  readonly linkTtl: Duration.Input
  readonly sessionTtl: Duration.Input
}

const importSecretKey = (secret: Redacted.Redacted<string>) =>
  Jwk.importSecret(Redacted.make({ kty: "oct", k: Base64Url.encode(Redacted.value(secret)) } as const), "HS256")

const expiresInSeconds = (ttl: Duration.Input) =>
  Effect.map(Clock.currentTimeMillis, (now) => Math.floor((now + Duration.toMillis(ttl)) / 1000))

const unauthorized = () => new HttpApiError.Unauthorized({})

/** Signs and verifies link and session tokens: HS256 JWTs told apart by their `typ` header. */
export class Tokens extends Context.Service<Tokens, {
  signLink(email: string, redirect: string): Effect.Effect<string>
  verifyLink(token: string): Effect.Effect<LinkClaims, HttpApiError.Unauthorized>
  signSession(email: string): Effect.Effect<string>
  verifySession(token: string): Effect.Effect<SessionClaims, HttpApiError.Unauthorized>
}>()("email-auth/Tokens") {
  static readonly layer = (options: TokensOptions) =>
    Layer.effect(
      Tokens,
      Effect.gen(function* () {
        const key = yield* importSecretKey(yield* options.secret)
        const mac = yield* Mac.Mac

        const sign = <S extends typeof LinkClaims | typeof SessionClaims>(schema: S, claims: S["Type"], typ: string) =>
          Jwt.sign(schema, claims, key, { typ }).pipe(
            Effect.map(Redacted.value),
            Effect.provideService(Mac.Mac, mac),
            Effect.orDie,
          )

        const verify = Effect.fnUntraced(function* <S extends typeof LinkClaims | typeof SessionClaims>(
          schema: S,
          token: string,
          typ: string,
        ): Effect.fn.Return<S["Type"], HttpApiError.Unauthorized, Mac.Mac> {
          if (token.length > maxTokenLength) return yield* unauthorized()
          const verified = yield* Jwt.verify(schema, token, key, { typ, requiredClaims: ["exp"] }).pipe(
            Effect.mapError(unauthorized),
          )
          return verified.claims
        }, Effect.provideService(Mac.Mac, mac))

        return Tokens.of({
          signLink: (email, redirect) =>
            Effect.flatMap(expiresInSeconds(options.linkTtl), (exp) => sign(LinkClaims, { email, redirect, exp }, linkTyp)),
          verifyLink: (token) => verify(LinkClaims, token, linkTyp),
          signSession: (email) =>
            Effect.flatMap(expiresInSeconds(options.sessionTtl), (exp) => sign(SessionClaims, { email, exp }, sessionTyp)),
          verifySession: (token) => verify(SessionClaims, token, sessionTyp),
        })
      }),
    ).pipe(Layer.provide(Mac.layerWebCrypto), Layer.provide(SecureRandom.layerWebCrypto))
}
