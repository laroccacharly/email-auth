import { afterEach, describe, expect, test } from "bun:test"
import { linkPath, makeTestApp, postJson, sessionCookieOf } from "./app.ts"

let app: Awaited<ReturnType<typeof makeTestApp>>

afterEach(() => app.dispose())

const signIn = async (email: string, redirect?: string) => {
  await app.request("/auth/login", postJson({ email, redirect }))
  const mail = app.sent.at(-1)
  if (mail === undefined) throw new Error("no mail sent")
  return app.request(linkPath(mail))
}

const whoami = (cookie: string) => app.request("/api/me", { headers: { cookie } })

describe("sign in", () => {
  test("a known email gets a link, and clicking it opens the protected route", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })

    const login = await app.request("/auth/login", postJson({ email: " Me@Example.com ", redirect: "/jobs/abc" }))
    expect(login.status).toBe(204)
    expect(app.sent).toHaveLength(1)
    expect(app.sent[0]?.to).toBe("me@example.com")
    expect(app.sent[0]?.subject).toBe("Sign in to Notes")

    const callback = await app.request(linkPath(app.sent[0]!))
    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe("/jobs/abc")

    const me = await whoami(sessionCookieOf(callback))
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ email: "me@example.com" })
  })

  test("the session cookie is HttpOnly, Secure, SameSite=Lax, on / for 30 days", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const setCookie = (await signIn("me@example.com")).headers.get("set-cookie") ?? ""
    expect(setCookie).toMatch(/^session=[\w-]+\.[\w-]+\.[\w-]+;/)
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("SameSite=Lax")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain("Max-Age=2592000")
  })

  test("the app's API-wide middleware runs on the auth endpoints", async () => {
    app = await makeTestApp({ knownEmails: [] })
    const login = await app.request("/auth/login", postJson({ email: "me@example.com" }))
    expect(login.headers.get("x-stamp")).toBe("app")
  })

  test("redirect defaults to /", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    expect((await signIn("me@example.com")).headers.get("location")).toBe("/")
  })

  test("an unknown email gets the same 204 and no mail", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const login = await app.request("/auth/login", postJson({ email: "stranger@example.com" }))
    expect(login.status).toBe(204)
    expect(app.sent).toHaveLength(0)
  })

  test("a failing mailer still answers 204", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"], mailerFails: true })
    expect((await app.request("/auth/login", postJson({ email: "me@example.com" }))).status).toBe(204)
  })

  test.each(["//evil.com", "https://evil.com", "/\\evil.com", "/%2F%2Fevil.com", "/%5cevil.com", "jobs", "/\ud800"])("redirect %p is a 400", async (redirect) => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const login = await app.request("/auth/login", postJson({ email: "me@example.com", redirect }))
    expect(login.status).toBe(400)
    expect(app.sent).toHaveLength(0)
  })

  test("a non-ASCII redirect is percent-encoded", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    expect((await signIn("me@example.com", "/日本語?q=a b")).headers.get("location")).toBe(
      "/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=a%20b",
    )
  })

  test("the longest accepted redirect still gives a working link", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const redirect = `/${"a".repeat(2047)}`
    expect((await signIn("me@example.com", redirect)).headers.get("location")).toBe(redirect)
  })

  test("a redirect of quotes and backslashes still gives a working link", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const callback = await signIn("me@example.com", `/a${'"\\'.repeat(340)}`)
    expect(callback.headers.get("location")).toBe(`/a${"%22%5C".repeat(340)}`)
  })

  test("a redirect longer than 2048 characters is a 400", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const login = await app.request("/auth/login", postJson({ email: "me@example.com", redirect: `/${"a".repeat(2048)}` }))
    expect(login.status).toBe(400)
    expect(app.sent).toHaveLength(0)
  })

  test("an invalid email is a 400", async () => {
    app = await makeTestApp({ knownEmails: [] })
    expect((await app.request("/auth/login", postJson({ email: "not an email" }))).status).toBe(400)
  })
})

describe("expiry and tampering", () => {
  test("a link older than 15 minutes redirects to /?auth=expired without a cookie", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    await app.request("/auth/login", postJson({ email: "me@example.com" }))
    await app.advance("16 minutes")
    const callback = await app.request(linkPath(app.sent[0]!))
    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe("/?auth=expired")
    expect(callback.headers.get("set-cookie")).toBeNull()
  })

  test("a link can be used again before it expires", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    await app.request("/auth/login", postJson({ email: "me@example.com" }))
    await app.request(linkPath(app.sent[0]!))
    expect((await app.request(linkPath(app.sent[0]!))).headers.get("location")).toBe("/")
  })

  test("a session older than 30 days is a 401", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const cookie = sessionCookieOf(await signIn("me@example.com"))
    await app.advance("29 days")
    expect((await whoami(cookie)).status).toBe(200)
    await app.advance("2 days")
    expect((await whoami(cookie)).status).toBe(401)
  })

  test("a tampered session is a 401", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com", "you@example.com"] })
    const [header, , signature] = sessionCookieOf(await signIn("me@example.com")).split(".")
    const forged = Buffer.from(JSON.stringify({ email: "you@example.com", exp: 9999999999 })).toString("base64url")
    expect((await whoami(`${header}.${forged}.${signature}`)).status).toBe(401)
  })

  test("a link token used as a session is a 401", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    await app.request("/auth/login", postJson({ email: "me@example.com" }))
    const linkToken = new URL(linkPath(app.sent[0]!), "https://x").searchParams.get("token")
    expect((await whoami(`session=${linkToken}`)).status).toBe(401)
  })

  test("a session token used as a link redirects to /?auth=expired", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const sessionToken = sessionCookieOf(await signIn("me@example.com")).replace("session=", "")
    const callback = await app.request(`/auth/callback?token=${sessionToken}`)
    expect(callback.headers.get("location")).toBe("/?auth=expired")
  })

  test("a callback without a token redirects to /?auth=expired", async () => {
    app = await makeTestApp({ knownEmails: [] })
    expect((await app.request("/auth/callback")).headers.get("location")).toBe("/?auth=expired")
  })

  test("no cookie is a 401", async () => {
    app = await makeTestApp({ knownEmails: [] })
    expect((await app.request("/api/me")).status).toBe(401)
  })
})

describe("session and logout", () => {
  test("/auth/session returns the email and expiry, or 401", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    expect((await app.request("/auth/session")).status).toBe(401)

    const cookie = sessionCookieOf(await signIn("me@example.com"))
    const session = await app.request("/auth/session", { headers: { cookie } })
    expect(session.status).toBe(200)
    const body = await session.json()
    expect(body.email).toBe("me@example.com")
    expect(Date.parse(body.expires_at)).toBe(30 * 24 * 60 * 60 * 1000)
  })

  test("logout without a session is a 401 and clears nothing, so other sites can't sign you out", async () => {
    app = await makeTestApp({ knownEmails: [] })
    const logout = await app.request("/auth/logout", { method: "POST" })
    expect(logout.status).toBe(401)
    expect(logout.headers.get("set-cookie")).toBeNull()
  })

  test("logout clears the cookie", async () => {
    app = await makeTestApp({ knownEmails: ["me@example.com"] })
    const cookie = sessionCookieOf(await signIn("me@example.com"))
    const logout = await app.request("/auth/logout", { method: "POST", headers: { cookie } })
    expect(logout.status).toBe(204)
    const setCookie = logout.headers.get("set-cookie") ?? ""
    expect(setCookie).toMatch(/^session=;/)
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
  })
})
