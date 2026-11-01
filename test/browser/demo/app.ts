// The app the browser tests drive: it embeds the sign-in UI, and once signed in calls its protected route, `/api/me`.

import { Effect, Option, Schema } from "effect"
import { Command, type Runtime, Update } from "foldkit"
import type { Document, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { load, pushUrl, UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { toString as urlToString, Url } from "foldkit/url"
import * as SignIn from "../../../src/ui/index.ts"

export const Model = Schema.Struct({
  signIn: SignIn.Model,
  path: Schema.String,
  // What the protected route answered.
  me: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigation: {},
  GotSignInMessage: { message: SignIn.Message },
  SucceededFetchMe: { email: Schema.String },
})
export type Message = typeof Message.Type

const toGotSignInMessage = (message: SignIn.Message) => Message.GotSignInMessage({ message })

const navigateTo = (url: string, isExternal: boolean) => {
  if (isExternal) return load(url)
  return pushUrl(url)
}

const Navigate = Command.define("Navigate", {
  args: { url: Schema.String, isExternal: Schema.Boolean },
  messages: [Message.CompletedNavigation],
  execute: ({ url, isExternal }) => Effect.as(navigateTo(url, isExternal), Message.CompletedNavigation()),
})

// A 401 goes to the sign-in UI, as it would from any of an app's calls.
const FetchMe = Command.define("FetchMe", {
  messages: [Message.SucceededFetchMe, Message.GotSignInMessage],
  execute: Effect.promise(async () => {
    const response = await fetch("/api/me")
    if (!response.ok) return toGotSignInMessage(SignIn.Message.LostSession())
    const { email } = (await response.json()) as { readonly email: string }
    return Message.SucceededFetchMe({ email })
  }),
})

const foldSignInOutMessage = SignIn.OutMessage.match<Update.Step<Model, Message>>({
  SignedIn: () => (model) => ({ model, commands: [FetchMe()] }),
  SignedOut: () => (model) => ({ model: modifyFields(model, { me: () => Option.none() }) }),
})

const foldSignIn = Update.foldChild({
  update: SignIn.update,
  read: (model: Model) => Option.some(model.signIn),
  write: (model, signIn) => modifyFields(model, { signIn: () => signIn }),
  toParentMessage: toGotSignInMessage,
  foldOutMessage: foldSignInOutMessage,
})

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url) =>
  Update.foldChildInit(SignIn.init(url), {
    toParentModel: (signIn) => ({ signIn, path: url.pathname, me: Option.none() }),
    toParentMessage: toGotSignInMessage,
  })

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<Update.Return<Model, Message>>(request, {
        Internal: ({ url }) => ({ model, commands: [Navigate({ url: urlToString(url), isExternal: false })] }),
        External: ({ href }) => ({ model, commands: [Navigate({ url: href, isExternal: true })] }),
      }),
    ChangedUrl: ({ url }) => ({ model: modifyFields(model, { path: () => url.pathname, signIn: (signIn) => SignIn.reflectUrl(signIn, url) }) }),
    CompletedNavigation: () => ({ model }),
    GotSignInMessage: ({ message: signInMessage }) => foldSignIn(model, signInMessage),
    SucceededFetchMe: ({ email }) => ({ model: modifyFields(model, { me: () => Option.some(email) }) }),
  })

const meView = (model: Model, h: HtmlBuilder<Message>) =>
  Option.toArray(Option.map(model.me, (email) => h.p([], [`The protected route says: ${email}`])))

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Notes",
  body: h.div(
    [],
    [
      h.header(
        [],
        [
          h.a([h.Href("/")], ["Notes"]),
          h.submodel({ slotId: "account", view: SignIn.accountView, model: model.signIn, viewInputs: {}, toParentMessage: toGotSignInMessage }),
        ],
      ),
      h.main(
        [],
        [
          h.p([], [`On ${model.path}`]),
          h.submodel({ slotId: "sign-in", view: SignIn.formView, model: model.signIn, viewInputs: {}, toParentMessage: toGotSignInMessage }),
          ...meView(model, h),
        ],
      ),
    ],
  ),
})
