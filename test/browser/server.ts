// The browser tests' server: the test app's endpoints with a real clock, the demo app on every other path, and the mail
// it sent at `/test/mail?to=`, which the tests read like an inbox. Every email may sign in but `unknown@…` ones.

import { Effect, Layer } from "effect"
import { KnownEmail, type Mail } from "../../src/index.ts"
import { makeAppHandler } from "../app.ts"
import demo from "./demo/index.html"

export const port = 3610
export const origin = `http://localhost:${port}`

const sent: Array<Mail> = []

const app = makeAppHandler({
  baseUrl: origin,
  clock: Layer.empty,
  knownEmail: Layer.succeed(KnownEmail, { check: (email) => Effect.succeed(!email.startsWith("unknown")) }),
  send: (mail) => Effect.sync(() => void sent.push(mail)),
})

const handler = (request: Request) => app.handler(request)

const mailTo = (request: Request) => {
  const to = new URL(request.url).searchParams.get("to")
  return Response.json(sent.filter((mail) => mail.to === to))
}

if (import.meta.main) {
  Bun.serve({
    port,
    development: false,
    routes: {
      "/auth/*": handler,
      "/api/*": handler,
      "/test/mail": mailTo,
      "/*": demo,
    },
  })
  console.log(`Serving the demo app at ${origin}`)
}
