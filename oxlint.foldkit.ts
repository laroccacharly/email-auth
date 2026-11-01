import recommended from "@foldkit/oxlint-plugin/recommended.json" with { type: "json" }
import { defineConfig } from "oxlint"

const rules = Object.fromEntries(
  Object.entries(recommended.rules).map(
    ([rule, level]): [string, "error" | "off"] => {
      if (level === "off") {
        return [rule, "off"]
      }
      return [rule, "error"]
    }
  )
)

/**
 * FoldKit's recommended rules (every `foldkit/*` rule as an error), applied to
 * the UI (`email-auth/ui` and the demo app the browser tests drive) only, so the server code is not held to browser-app conventions.
 *
 * The UI also follows FoldKit's own conventions where they clash with the
 * shared presets: `Array<T>` / `ReadonlyArray<T>` generics, a Schema value and
 * its type sharing one name (`const Model` + `type Model`), camelCase module
 * names, and Effect's `Effect.catch` / `Array.map(array, fn)` which the
 * promise and unicorn rules mistake for Promise and native array methods.
 */
export default defineConfig({
  jsPlugins: recommended.jsPlugins,
  overrides: [
    {
      files: ["src/ui/**/*.ts", "test/browser/demo/**/*.ts"],
      rules: {
        ...rules,
        "no-redeclare": "off",
        "promise/prefer-await-to-callbacks": "off",
        "promise/prefer-await-to-then": "off",
        "typescript/array-type": ["error", { default: "generic" }],
        "unicorn/filename-case": [
          "error",
          { cases: { camelCase: true, kebabCase: true } },
        ],
        "unicorn/no-array-method-this-argument": "off",
      },
    },
  ],
})
