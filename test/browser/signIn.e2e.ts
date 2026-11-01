// Signing in and out by email in a real browser: the demo app, its sign-in UI and the test app's endpoints, on one origin.

import { expect, type Page, test } from "@playwright/test"
import { hasMail, signInLink, uniqueEmail } from "./inbox.ts"

const emailField = (page: Page) => page.getByLabel("Email")
const sendButton = (page: Page) => page.getByRole("button", { name: "Email me a sign-in link" })
const signOutButton = (page: Page) => page.getByRole("button", { name: "Sign out" })

/** Asks for a link on the page open now, as a user does: the email in the form, then the button. */
const askForLink = async (page: Page, email: string) => {
  await emailField(page).fill(email)
  await sendButton(page).click()
  await expect(page.getByRole("status")).toHaveText(`Check your inbox: a sign-in link is on its way to ${email}.`)
}

/** Asks for a link on the page open now, then opens it from the inbox. */
const signIn = async (page: Page, email: string) => {
  await askForLink(page, email)
  await page.goto(await signInLink(email))
  await expect(signOutButton(page)).toBeVisible()
}

test("the emailed link signs in, opens the protected route, and leaves a cookie scripts can't read", async ({ page }) => {
  const email = uniqueEmail("me")
  await page.goto("/")
  await signIn(page, email)
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("banner")).toContainText(email)
  await expect(page.getByText(`The protected route says: ${email}`)).toBeVisible()
  await expect(emailField(page)).toBeHidden()
  const [cookie] = await page.context().cookies()
  expect(cookie).toMatchObject({ name: "session", httpOnly: true, secure: true, sameSite: "Lax" })
  expect(await page.evaluate(() => document.cookie)).toBe("")
})

test("the session survives a reload", async ({ page }) => {
  const email = uniqueEmail("reload")
  await page.goto("/")
  await signIn(page, email)
  await page.reload()
  await expect(page.getByText(`The protected route says: ${email}`)).toBeVisible()
})

test("a link asked for on a deep page comes back to it", async ({ page }) => {
  await page.goto("/notes/42?tab=all")
  await signIn(page, uniqueEmail("deep"))
  await expect(page).toHaveURL("/notes/42?tab=all")
  await expect(page.getByText("On /notes/42")).toBeVisible()
})

test("an email that may not sign in sees the same answer, and gets no mail", async ({ page }) => {
  const email = uniqueEmail("unknown")
  await page.goto("/")
  await askForLink(page, email)
  expect(await hasMail(email)).toBe(false)
})

test("a bad link shows the form with a notice, and a link asked there comes back without it", async ({ page }) => {
  await page.goto("/auth/callback?token=not-a-token")
  await expect(page).toHaveURL("/?auth=expired")
  await expect(page.getByRole("alert")).toContainText("expired")
  await signIn(page, uniqueEmail("expired"))
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("alert")).toBeHidden()
})

test("signing out shows the form, even after a reload", async ({ page }) => {
  await page.goto("/")
  await signIn(page, uniqueEmail("leaving"))
  await signOutButton(page).click()
  await expect(emailField(page)).toBeVisible()
  await expect(page.getByText("The protected route says")).toBeHidden()
  await page.reload()
  await expect(emailField(page)).toBeVisible()
})
