# email-auth

Stateless email sign-in for Effect `HttpApi` servers: a user clicks a link
sent to their mailbox, and their browser gets a signed session cookie.
Nothing is stored but one secret.

## Requirements

- `effect` 4.1.1 or later
- Bun or Cloudflare Workers (any runtime with Web Crypto)

## Installation

```sh
bun add github:laroccacharly/email-auth#v0.1.1
```
