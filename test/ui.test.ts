// The sign-in UI, through its views, in a DOM without a browser: what the user sees and does, the calls it makes and
// what it tells the app. The calls themselves run against a real server in test/browser.

import { afterAll, beforeAll, describe, expect as expectValue, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { Option } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { click, Command, expect, expectNoOutMessage, expectOutMessage, given, label, role, scene, submit, text, type } from "foldkit/scene"
import * as Story from "foldkit/story"
import { message, model, story } from "foldkit/story"
import { modifyFields } from "foldkit/struct"
import { fromString, type Url } from "foldkit/url"
import { accountView, FetchSession, formView, init, Message, type Model, OutMessage, reflectUrl, SendSignInLink, SignOut, Status, update } from "../src/ui/index.ts"

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const urlOf = (href: string): Url => Option.getOrThrow(fromString(href))

const pageAt = (href: string) => init(urlOf(href)).model

const signedOutAt = (href: string): Model => modifyFields(pageAt(href), { status: () => Status.cases.SignedOut.make({}) })

const signedIn = (email: string): Model => modifyFields(pageAt("https://notes.example/"), { status: () => Status.cases.SignedIn.make({ email }) })

// Both views, as an app shows them: the account in its header, the form in its page.
const page = (model: Model, h: HtmlBuilder<Message>) =>
  h.div([], [accountView(model, {}, h), formView(model, { intro: "Use the email you signed up with." }, h)])

const ui = { update, view: page }

const emailField = label("Email")
const sendButton = role("button", { name: "Email me a sign-in link" })
const sendingButton = role("button", { name: "Sending…" })
const signOutButton = role("button", { name: "Sign out" })

describe("opening the page", () => {
  test("asks who is signed in, and shows neither the form nor the account until it knows", () => {
    const { model, commands } = init(urlOf("https://notes.example/"))
    expectValue(commands?.map((command) => command.name)).toEqual([FetchSession.name])
    scene(ui, given(model), expect(emailField).toBeAbsent(), expect(signOutButton).toBeAbsent())
  })

  test("with a session: tells the app who signed in, and shows the email and a sign-out button", () => {
    story(
      update,
      Story.given(pageAt("https://notes.example/")),
      message(Message.SucceededFetchSession({ email: "me@x.com" })),
      model((signedInModel) => expectValue(signedInModel.status).toEqual(Status.cases.SignedIn.make({ email: "me@x.com" }))),
      Story.expectOutMessage(OutMessage.SignedIn({ email: "me@x.com" })),
    )
    scene(ui, given(signedIn("me@x.com")), expect(text("me@x.com")).toExist(), expect(signOutButton).toExist(), expect(emailField).toBeAbsent())
  })

  test("without one: tells the app, and shows the form", () => {
    story(
      update,
      Story.given(pageAt("https://notes.example/")),
      message(Message.LostSession()),
      model((signedOutModel) => expectValue(signedOutModel.status._tag).toBe("SignedOut")),
      Story.expectOutMessage(OutMessage.SignedOut()),
    )
    scene(
      ui,
      given(signedOutAt("https://notes.example/")),
      expect(role("heading", { name: "Sign in" })).toExist(),
      expect(text("Use the email you signed up with.")).toExist(),
      expect(emailField).toExist(),
    )
  })

  test("when the session can't be fetched: signs out with the error", () => {
    story(
      update,
      Story.given(pageAt("https://notes.example/")),
      message(Message.FailedFetchSession({ error: "Couldn't reach the server." })),
      model((failedModel) => {
        expectValue(failedModel.status._tag).toBe("SignedOut")
        expectValue(failedModel.notice).toEqual(Option.some("Couldn't reach the server."))
      }),
      Story.expectOutMessage(OutMessage.SignedOut()),
    )
  })

  test("back from an expired link: says so, and dismissing it hides it", () => {
    scene(
      ui,
      given(signedOutAt("https://notes.example/?auth=expired")),
      expect(role("alert")).toContainText("expired"),
      click(role("button", { name: "Dismiss" })),
      expect(role("alert")).toBeAbsent(),
    )
  })
})

describe("asking for a link", () => {
  test("sends the email typed and the page it was asked on, then says to check the inbox", () => {
    scene(
      ui,
      given(signedOutAt("https://notes.example/notes/42?q=a%20b&flag#comments")),
      type(emailField, " me@x.com "),
      submit(role("form")),
      expect(sendingButton).toBeDisabled(),
      Command.expectExact(SendSignInLink({ email: "me@x.com", redirect: "/notes/42?q=a%20b&flag#comments" })),
      Command.resolve(SendSignInLink, Message.SentSignInLink({ email: "me@x.com" })),
      expect(role("status")).toHaveText("Check your inbox: a sign-in link is on its way to me@x.com."),
      expect(sendButton).toBeEnabled(),
      expectNoOutMessage(),
    )
  })

  test("from the expired link's page, comes back to the page without `auth=expired`", () => {
    scene(
      ui,
      given(signedOutAt("https://notes.example/?auth=expired&tab=all")),
      type(emailField, "me@x.com"),
      submit(role("form")),
      Command.expectExact(SendSignInLink({ email: "me@x.com", redirect: "/?tab=all" })),
      Command.resolve(SendSignInLink, Message.SentSignInLink({ email: "me@x.com" })),
    )
  })

  test("after the app moved to another page, comes back to that one", () => {
    scene(
      ui,
      given(reflectUrl(signedOutAt("https://notes.example/"), urlOf("https://notes.example/notes/7"))),
      type(emailField, "me@x.com"),
      submit(role("form")),
      Command.expectExact(SendSignInLink({ email: "me@x.com", redirect: "/notes/7" })),
      Command.resolve(SendSignInLink, Message.SentSignInLink({ email: "me@x.com" })),
    )
  })

  test("with no email typed, sends nothing", () => {
    scene(ui, given(signedOutAt("https://notes.example/")), type(emailField, "  "), submit(role("form")), Command.expectNone())
  })

  test("a failure shows the error and lets the user try again", () => {
    scene(
      ui,
      given(signedOutAt("https://notes.example/")),
      type(emailField, "me@x.com"),
      submit(role("form")),
      Command.resolve(SendSignInLink, Message.FailedSendSignInLink({ error: "Too many requests: try again in a few seconds." })),
      expect(role("alert")).toContainText("Too many requests"),
      expect(sendButton).toBeEnabled(),
      expect(role("status")).toBeAbsent(),
    )
  })
})

describe("signing out", () => {
  test("shows a fresh form and tells the app", () => {
    scene(
      ui,
      given(signedIn("me@x.com")),
      click(signOutButton),
      Command.expectExact(SignOut),
      Command.resolve(SignOut, Message.SucceededSignOut()),
      expect(emailField).toHaveValue(""),
      expect(text("me@x.com")).toBeAbsent(),
      expectOutMessage(OutMessage.SignedOut()),
    )
  })

  test("a failure keeps the user signed in and shows the error", () => {
    scene(
      ui,
      given(signedIn("me@x.com")),
      click(signOutButton),
      Command.resolve(SignOut, Message.FailedSignOut({ error: "Couldn't reach the server." })),
      expect(role("alert")).toContainText("Couldn't reach the server."),
      expect(signOutButton).toExist(),
      expectNoOutMessage(),
    )
  })

  test("a 401 on one of the app's own calls signs out too, and the app hears it once", () => {
    story(
      update,
      Story.given(signedIn("me@x.com")),
      message(Message.LostSession()),
      Story.expectOutMessage(OutMessage.SignedOut()),
      message(Message.LostSession()),
      Story.expectNoOutMessage(),
    )
  })
})
