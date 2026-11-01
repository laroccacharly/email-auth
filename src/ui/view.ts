import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Message } from "./message.ts"
import type { Model } from "./model.ts"

/** The class of each part of the views. The defaults are Tailwind classes; an app without Tailwind gets plain HTML. */
export interface Classes {
  readonly form: string
  readonly heading: string
  readonly intro: string
  readonly fields: string
  readonly label: string
  readonly input: string
  readonly button: string
  readonly sent: string
  readonly notice: string
  readonly account: string
  readonly email: string
}

export const defaultClasses: Classes = {
  form: "mx-auto flex max-w-md flex-col gap-4 px-6 py-16",
  heading: "text-lg font-semibold",
  intro: "text-sm text-gray-600",
  fields: "flex flex-col gap-3",
  label: "flex flex-col gap-1 text-sm font-medium",
  input: "h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/25",
  button: "h-9 cursor-pointer rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-500 disabled:cursor-default disabled:opacity-60",
  sent: "text-sm",
  notice: "flex items-start justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900",
  account: "flex items-center gap-3 text-sm",
  email: "text-gray-600",
}

/** What the app may change in the views: the text under the heading, and any class. */
export interface ViewInputs {
  readonly intro?: string
  readonly classes?: Partial<Classes>
}

type H = HtmlBuilder<Message>

const classesOf = (viewInputs: ViewInputs): Classes => ({ ...defaultClasses, ...viewInputs.classes })

const sentText = (email: string) => `Check your inbox: a sign-in link is on its way to ${email}.`

const sendLabel = (isSending: boolean) => {
  if (isSending) return "Sending…"
  return "Email me a sign-in link"
}

const noticeView = (model: Model, classes: Classes, h: H): ReadonlyArray<Html> =>
  Option.toArray(
    Option.map(model.notice, (notice) =>
      h.div(
        [h.Role("alert"), h.Class(classes.notice)],
        [h.p([], [notice]), h.button([h.Type("button"), h.Class("cursor-pointer underline"), h.OnClick(Message.ClickedDismissNotice())], ["Dismiss"])],
      )),
  )

const sentView = (model: Model, classes: Classes, h: H): ReadonlyArray<Html> =>
  Option.toArray(Option.map(model.sentTo, (email) => h.p([h.Role("status"), h.Class(classes.sent)], [sentText(email)])))

const introView = (viewInputs: ViewInputs, classes: Classes, h: H): ReadonlyArray<Html> =>
  Option.toArray(Option.map(Option.fromUndefinedOr(viewInputs.intro), (intro) => h.p([h.Class(classes.intro)], [intro])))

const emailField = (model: Model, classes: Classes, h: H): Html =>
  h.label(
    [h.Class(classes.label)],
    [
      "Email",
      h.input([
        h.Type("email"),
        h.Required(true),
        h.Autocomplete("email"),
        h.Class(classes.input),
        h.Value(model.emailInput),
        h.OnInput((value) => Message.ChangedEmail({ value })),
      ]),
    ],
  )

/** The sign-in form, its notices and the "check your inbox" text, while signed out; nothing otherwise. */
export const formView = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
  if (model.status._tag !== "SignedOut") return null
  const classes = classesOf(viewInputs)
  return h.section(
    [h.Class(classes.form)],
    [
      h.h1([h.Class(classes.heading)], ["Sign in"]),
      ...introView(viewInputs, classes, h),
      ...noticeView(model, classes, h),
      h.form(
        [h.Class(classes.fields), h.OnSubmit(Message.SubmittedSignIn())],
        [emailField(model, classes, h), h.button([h.Type("submit"), h.Class(classes.button), h.Disabled(model.isSending)], [sendLabel(model.isSending)])],
      ),
      ...sentView(model, classes, h),
    ],
  )
})

/** The signed-in email and a sign-out button, with a notice if signing out failed; nothing while signed out. */
export const accountView = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
  if (model.status._tag !== "SignedIn") return null
  const classes = classesOf(viewInputs)
  return h.div(
    [h.Class(classes.account)],
    [
      h.span([h.Class(classes.email)], [model.status.email]),
      h.button([h.Type("button"), h.Class(classes.button), h.OnClick(Message.ClickedSignOut())], ["Sign out"]),
      ...noticeView(model, classes, h),
    ],
  )
})
