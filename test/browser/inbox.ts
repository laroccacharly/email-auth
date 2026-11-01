// Reading the test server's inbox, the way a user opens theirs.

import type { Mail } from "../../src/index.ts"
import { origin } from "./server.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mailTo = async (email: string): Promise<ReadonlyArray<Mail>> =>
  (await fetch(`${origin}/test/mail?to=${encodeURIComponent(email)}`)).json() as Promise<ReadonlyArray<Mail>>

const linkIn = (mail: Mail) => /http:\/\/\S+\/auth\/callback\?token=\S+/u.exec(mail.text)?.[0]

/** The link of the first sign-in email sent to `email`, waiting for it to arrive. */
export const signInLink = async (email: string) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const link = (await mailTo(email)).map(linkIn).find((found) => found !== undefined)
    if (link !== undefined) return link
    await sleep(50)
  }
  throw new Error(`no sign-in link reached ${email}`)
}

/** Whether any email was sent to `email`. */
export const hasMail = async (email: string) => (await mailTo(email)).length > 0

/** An email no other test uses, so tests share nothing. */
export const uniqueEmail = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}@notes.example`
