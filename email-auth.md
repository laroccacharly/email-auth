# email-auth

Stateless email sign-in for Effect `HttpApi` servers. A user types their
email, clicks the link they receive, and their browser holds a signed
cookie saying "this browser proved it reads this mailbox, until this
date". Nothing is stored: no users, no sessions, no pending links. The
only state is one secret.

The library knows nothing about the app's data. The app tells it which
emails may sign in and how to send mail; the library signs, verifies and
serves the HTTP endpoints.

### 1. The flow

```
browser                     app (with email-auth)              mailbox
   | POST /auth/login {email} ->|                                  |
   |                            | knownEmail(email)? yes:          |
   |                            |   sign link token, send mail ---->|
   |<----------- 204 -----------|  (204 either way)                |
   |                                                               |
   |<-------------------- user clicks the link --------------------|
   | GET /auth/callback?token=… ->|                                  |
   |                            | verify link token                |
   |<-- 303 to `redirect`,      |                                  |
   |    Set-Cookie: session=…   |                                  |
   |                                                               |
   | GET /api/anything, Cookie ->| verify session cookie,          |
   |                            | provide the email to the handler |
```

The user never copies or pastes a token: clicking the link opens the
app, which sets the cookie and redirects. From then on the browser sends
the cookie by itself on every request to the app's origin.

### 2. Tokens

Two kinds, both HS256 JWTs, told apart by their `typ` header so one can
never be used as the other:

| Token   | Carried in                 | `typ`                | Claims                     | Lifetime (default) |
| ------- | -------------------------- | -------------------- | -------------------------- | ------------------ |
| Link    | The email's URL, `?token=` | `email-auth-link`    | `{ email, redirect, exp }` | 15 minutes         |
| Session | The `session` cookie       | `email-auth-session` | `{ email, exp }`           | 30 days            |

- Signed and verified with `Jwt` from `effect/jose`, on `Mac` from
  `effect/crypto` over Web Crypto, so it runs in Workers, Bun and browsers
  with no dependency beyond `effect`. The library provides these crypto
  layers itself.
- Verification compares the tag in constant time, then checks `typ` and
  `exp`. Tokens longer than 4096 characters are rejected before any
  crypto. Any failure is the same `Unauthorized`, with no detail.
- `exp` is a JWT NumericDate (Unix epoch seconds), read from Effect's
  `Clock`, so tests can move time.
- The secret's UTF-8 bytes are the HMAC key; `Jwk.importSecret` refuses
  fewer than 32, and the layer fails at startup.
- `email` is trimmed and lowercased before signing and before
  `knownEmail`, so `Me@X.com` and `me@x.com` are the same person.

#### Accepted trade-offs

- A link works as many times as you like until it expires. Email
  scanners that open links get a cookie they never use; nothing is
  consumed, so they can't break the link either.
- A session can't be revoked on its own. Changing the secret signs
  everyone out.
- Whoever gets a link before it expires, or a cookie, is signed in as
  that email.
- Nothing ties a link to the browser that asked for it, so you can ask on
  a laptop and click on a phone. The flip side: a site can send your
  browser to a link the attacker got for their own email, and you end up
  signed in as them. Binding the link to the asking browser would stop
  this but break cross-device sign-in.
- `POST /auth/login` waits for the mail to be sent, so a known email
  answers more slowly than an unknown one. The status is the same; the
  timing is not. Rate limiting (section 5) is the app's defence.

### 3. The cookie

```
Set-Cookie: session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

- `HttpOnly`: page scripts can't read it, so an XSS bug can't steal the
  session. The browser still sends it; nothing in the UI needs to touch it.
- `Secure`: only sent over HTTPS (browsers make an exception for
  `localhost`, so dev works).
- `SameSite=Lax`: other sites can't send it with their `POST`s (CSRF),
  but it does survive the top-level navigation from the email link.
- `Max-Age` matches the token's `exp`.

### 4. HTTP endpoints

An `HttpApiGroup` named `auth` that the app adds to its `HttpApi`:

- `POST /auth/login` `{ email, redirect? }`: `204` always, whether or not
  the email is known, so the status doesn't reveal who has an account.
  Sends the mail only when `knownEmail(email)` is true; a `MailerError`
  is logged and still answers `204`. An invalid email is a `400`. `redirect` is a
  path on the app (`/`, `/jobs/abc`); anything else (`//evil.com`,
  `/%2F%2Fevil.com`, `/\evil.com`, `https://…`, malformed Unicode) is a
  `400`, which stops it being used as an open redirect.
  Characters outside printable ASCII, `"` and `\` are percent-encoded
  (`/日本` becomes `/%E6%97%A5%E6%9C%AC`) so it is a valid `Location`
  header, and a path longer than 2048 characters after that is a `400`, so
  the link token stays under the 4096-character limit. Emails longer than 254 characters
  are a `400` too. Default `/`.
- `GET /auth/callback?token=…`: verifies the link token, sets the
  cookie, `303` to the token's `redirect`. A missing, bad or expired token: `303`
  to `/?auth=expired`, so the app can show "link expired, ask for a new one".
- `POST /auth/logout`: clears the cookie, `204`. Needs a valid session
  (`401` otherwise), so another site can't sign you out with a cross-site
  `POST`, which carries no `SameSite=Lax` cookie.
- `GET /auth/session`: `{ email, expires_at }`, or `401`. Lets the UI show
  who is signed in without reading the cookie.

### 5. Using it in an app

Five steps. The example is a small app whose `/api/notes` routes need a
signed-in user. Everything imported from `email-auth` is the library;
the rest is the app.

#### Step 1: install

```sh
bun add github:laroccacharly/email-auth#v0.1.0
```

`effect` must already be in the app; the library uses the app's copy.

#### Step 2: add the endpoints and protect your routes

The library exports:

- `EmailAuthGroup`: the `auth` group from section 4.
- `SessionInfo`: the schema of `GET /auth/session`'s body.
- `Session`: an `HttpApiMiddleware` reading the `session` cookie
  (`HttpApiSecurity.apiKey({ in: "cookie", key: "session" })`). A group
  that adds it answers `401` without a valid cookie.
- `SignedInEmail`: a `Context.Service` holding the signed-in email, which
  `Session` provides to the handlers of the groups it protects.

```ts
// src/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Schema } from "effect"
import { EmailAuthGroup, Session } from "email-auth"

class NotesGroup extends HttpApiGroup.make("notes")
  .add(HttpApiEndpoint.get("list", "/api/notes", { success: Schema.Array(Note) }))
  .middleware(Session) {}

export class AppApi extends HttpApi.make("app").add(EmailAuthGroup).add(NotesGroup) {}
```

Because the endpoints are part of the app's `HttpApi`, they show up in
its OpenAPI document and its `HttpApiClient`.

#### Step 3: read the signed-in email in your handlers

```ts
// src/server.ts
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SignedInEmail } from "email-auth"

const notesHandlers = HttpApiBuilder.group(AppApi, "notes", (handlers) =>
  handlers.handle("list", () =>
    Effect.gen(function* () {
      const email = yield* SignedInEmail // "me@example.com", already lowercased
      return yield* notes.forOwner(email)
    })))
```

`HttpApiBuilder.group` reads the `Session` middleware when its layer is
built, so the layer that provides it must sit below the group's handlers
(step 4).

The library never decides what an email may see; this is where the app
does.

#### Step 4: provide the two services and the options

The library needs to know who may sign in and how to send mail. The app
provides both as Layers:

```ts
// src/emailAuth.ts
import { Config, Effect, Layer } from "effect"
import { EmailAuth, KnownEmail, Mailer, MailerError } from "email-auth"

/** Whether `email` may sign in: here, anyone who owns a note. */
const knownEmail = Layer.effect(KnownEmail, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return {
    check: (email) => sql`SELECT 1 FROM notes WHERE owner = ${email} LIMIT 1`.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie,
    ),
  }
}))

/** Sends one plain-text email through the app's provider. */
const mailer = Layer.effect(Mailer, Effect.gen(function* () {
  const provider = yield* MyEmailProvider
  return {
    send: ({ to, subject, text }) => provider.send({ to, subject, text }).pipe(
      Effect.mapError((cause) => new MailerError({ cause })),
    ),
  }
}))

export const emailAuth = EmailAuth.layer(AppApi, {
  secret: Config.Redacted("EMAIL_AUTH_SECRET"), // at least 32 bytes
  baseUrl: Config.String("PUBLIC_URL"),          // the link is `${baseUrl}/auth/callback?token=…`
  appName: "Notes",                              // in the email's subject and body
  linkTtl: "15 minutes",                         // optional, this is the default
  sessionTtl: "30 days",                         // optional, this is the default
}).pipe(Layer.provide([knownEmail, mailer]))
```

`EmailAuth.layer` takes the app's `HttpApi` (a compile error if it lacks
`EmailAuthGroup`) and provides the `auth` handlers and the `Session`
middleware. Provide it after the app's own handlers, so they get `Session`:

```ts
const routes = HttpApiBuilder.layer(AppApi).pipe(
  Layer.provide(notesHandlers),
  Layer.provide(emailAuth),
)
```

Generate the secret once and keep it in the environment, e.g. as a
Worker secret:

```sh
openssl rand -base64 32
```

#### Step 5: sign in from the browser

The UI is served from the same origin as the API, so the browser sends
the cookie by itself. The UI never reads or stores a token:

```ts
// Am I signed in?
const res = await fetch("/auth/session")
if (res.status === 401) showSignInForm()
else showApp((await res.json()).email)

// The sign-in form: ask for a link, then tell the user to check their inbox.
await fetch("/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, redirect: location.pathname }),
})
showMessage("Check your inbox for a sign-in link.")

// Back from the link with `?auth=expired`: the link was too old.
if (new URLSearchParams(location.search).get("auth") === "expired") showMessage("That link expired. Ask for a new one.")

// Sign out.
await fetch("/auth/logout", { method: "POST" })
```

An Effect UI can call the same endpoints through
`HttpApiClient.make(AppApi)` instead of `fetch`.

#### What stays with the app

- **Rate limiting.** `POST /auth/login` sends mail, so anyone can make the
  app email someone. The library is stateless and can't count, so the app
  puts its own limiter in front of the route.
- **What a signed-in email may do.** The library only says "this request
  comes from someone who reads `me@x.com`". The app maps that to its data.

### 6. Package

- Repo `github:laroccacharly/email-auth`, used as
  `bun add github:laroccacharly/email-auth#v0.1.0`.
- `effect` as a peer dependency (`^4.1.1`, the first with `effect/jose`),
  pinned in dev dependencies.
  No other runtime dependency.
- Source is TypeScript, imported directly (Bun and the Workers bundler
  both read `.ts`), so there's no build step.
- `bun run lint` (oxlint with type checking), `bun test`.

### 7. Testing

Through the public API only, in memory, well under 20 seconds:

- Build a test `HttpApi` with `EmailAuthGroup` and one protected group, serve
  it with `HttpRouter.toWebHandler`, and drive it with `fetch`-style
  requests.
- `Mailer` is a fake that keeps the sent messages, so tests pull the link
  out of the email text like a user would.
- A `TestClock`, provided as the app's `Clock`, moves time past `linkTtl`
  and `sessionTtl`.

Cases: a known email gets a link, and clicking it sets a cookie that
opens the protected route; an unknown email gets the same `204` and no
mail; an expired link redirects to `/?auth=expired`; an expired, tampered
or link-as-session token gets `401`; an absolute `redirect` gets `400`;
logout clears the cookie; the cookie has `HttpOnly`, `Secure`,
`SameSite=Lax`.

### 8. In bench

For reference, how bench would use it (bench.md owns the details):

- `KnownEmail`: `SELECT 1 FROM api_keys WHERE email = ? LIMIT 1`.
- `Mailer`: `cmail-client`'s `Cmail.sendEmail`, with `CMAIL_API_KEY` as a
  Worker secret.
- The UI moves onto the Worker as static assets, and the proxy goes. The
  UI's read endpoints use `Session` and show the jobs of every key whose
  `email` is the signed-in one. The CLI keeps using the bearer key.
- "Lost my key" then means: sign in by email, and from the UI create a new
  key for that email (or replace the old key's hash, keeping its `id` and
  its jobs).
- Emails aren't verified when a key is created, so someone could attach
  your email to their key and you'd see their jobs. Harmless, but
  bench.md should say so.
