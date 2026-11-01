import { defineConfig } from "oxlint"
import tsLint from "ts-lint/config"
import foldkit from "./oxlint.foldkit.ts"

export default defineConfig({
  extends: [tsLint, foldkit],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    "ts-lint/no-unknown": "error",
    "ts-lint/no-try-promise": "off",
  },
})
