# email-auth

Stateless email sign-in for Effect `HttpApi` servers: a user clicks a link
sent to their mailbox, and their browser gets a signed session cookie.
Nothing is stored but one secret. `email-auth/ui` is the sign-in UI for
a Foldkit app.

## Requirements

- `effect` 4.1.1 or later
- `foldkit` 0.170, for `email-auth/ui`
- Bun or Cloudflare Workers (any runtime with Web Crypto)

## Installation

```sh
bun add github:laroccacharly/email-auth#v0.2.1
```
