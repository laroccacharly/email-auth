import { Runtime } from "foldkit"
import { init, Message, Model, update, view } from "./app.ts"

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.querySelector("#root"),
  routing: {
    onUrlRequest: (request) => Message.ClickedLink({ request }),
    onUrlChange: (url) => Message.ChangedUrl({ url }),
  },
})

Runtime.run(application)
