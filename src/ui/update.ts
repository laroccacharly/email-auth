import { Option } from "effect"
import type { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { Url } from "foldkit/url"
import { FetchSession, SendSignInLink, SignOut } from "./command.ts"
import { Message, OutMessage } from "./message.ts"
import { initModel, type Model, returnPathOf, Status } from "./model.ts"

export type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

/** The model for the page at `url`, and the call that finds out who is signed in. */
export const init = (url: Url): Update.Return<Model, Message> => ({ model: initModel(url), commands: [FetchSession()] })

/** Follows the app to a new page, so a link asked for there comes back to it. */
export const reflectUrl = (model: Model, url: Url): Model => modifyFields(model, { returnTo: () => returnPathOf(url) })

const signedIn = (model: Model, email: string): UpdateReturn => ({
  model: modifyFields(model, { status: () => Status.cases.SignedIn.make({ email }), notice: () => Option.none() }),
  outMessage: OutMessage.SignedIn({ email }),
})

const freshForm = { emailInput: () => "", isSending: () => false, sentTo: () => Option.none<string>() }

// A fresh form, and the app hears it once: when someone was signed in, or it wasn't known yet.
const signedOut = (model: Model, notice: Option.Option<string> = model.notice): UpdateReturn => {
  if (model.status._tag === "SignedOut") return { model: modifyFields(model, { isSending: () => false, notice: () => notice }) }
  return {
    model: modifyFields(model, { status: () => Status.cases.SignedOut.make({}), ...freshForm, notice: () => notice }),
    outMessage: OutMessage.SignedOut(),
  }
}

/**
 * For the app, when one of its own calls gets a 401: the session is gone, so the form shows, and the app hears
 * `SignedOut` once however many 401s follow. Fold it with `Update.foldChildStep`.
 */
export const loseSession = (model: Model): UpdateReturn => signedOut(model)

const sendSignInLink = (model: Model): UpdateReturn => {
  const email = model.emailInput.trim()
  if (model.status._tag !== "SignedOut" || model.isSending || email === "") return { model }
  return {
    model: modifyFields(model, { isSending: () => true, notice: () => Option.none() }),
    commands: [SendSignInLink({ email, redirect: model.returnTo })],
  }
}

const withNotice = (model: Model, error: string): Model => modifyFields(model, { notice: () => Option.some(error) })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchSession: ({ email }) => signedIn(model, email),
    FailedFetchSession: ({ error }) => signedOut(model, Option.some(error)),
    LostSession: () => loseSession(model),
    ChangedEmail: ({ value }) => ({ model: modifyFields(model, { emailInput: () => value }) }),
    SubmittedSignIn: () => sendSignInLink(model),
    SentSignInLink: ({ email }) => ({ model: modifyFields(model, { isSending: () => false, sentTo: () => Option.some(email) }) }),
    FailedSendSignInLink: ({ error }) => ({ model: withNotice(modifyFields(model, { isSending: () => false }), error) }),
    ClickedSignOut: () => ({ model, commands: [SignOut()] }),
    SucceededSignOut: () => signedOut(model, Option.none()),
    FailedSignOut: ({ error }) => ({ model: withNotice(model, error) }),
    ClickedDismissNotice: () => ({ model: modifyFields(model, { notice: () => Option.none() }) }),
  })
