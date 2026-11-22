# Latex Suite 1.14.5: notes for modifying it

The source at git tag `1.14.5` builds to the same `main.js`, `styles.css` and `manifest.json` as the official 1.14.5 release, byte for byte. Work happens on branch `v1.14.5-base` of the fork `abd-v/obsidian-latex-suite`. Branch `v1.14.0-base` is the older version the vault had installed.

Remotes: `origin` is the fork, `upstream` is `artisticat1/obsidian-latex-suite`. Upstream `main` has unreleased commits after 1.14.5.

## Build and install

```bash
npm ci                                        # the lockfile at 1.14.5 is in sync
npx tsc --noEmit -skipLibCheck                # type check (passes)
npx jiti esbuild.config.mts production        # writes ./main.js (minified)
npx jiti esbuild.config.mts                   # dev build: unminified, inline sourcemap
```

To install, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/obsidian-latex-suite/`. Leave `data.json` alone, because it holds the user's settings and snippets.

Tests (`tests/*.test.ts`) are integration tests. They run inside a real Obsidian instance over CDP (`obsidian-integration-testing`), so they cannot run without an Obsidian executable.

The `postinstall` step regenerates the Lezer parser `src/parser/mathjax/latex-parser.js` from `latex.grammar`. Re-run `npm run generator:latex` after editing the grammar.

## How a keystroke flows through the plugin

1. `keyboardEventPlugin.onKeydown` (`src/latex_suite.ts`). `onInput` handles mobile and IME, where key events are unreliable.
2. `handleKeydown` handles single printable keys. It runs the **automatic** snippets (option `A`) on every keystroke and evaluates them against the line as it will be after the key is inserted (`line + key`).
3. Otherwise `runScopeHandlers(view, event, "latex-suite")` runs the keymaps built by `getKeymaps()`. Their order matters:
   1. Backspace auto-deletes `$`.
   2. Snippet trigger keys run non-automatic snippets (Tab by default) and per-snippet `triggerKey`s.
   3. Next and previous tabstop.
   4. Autofraction (`/`).
   5. Matrix shortcuts (Tab, Enter, Shift-Enter inside the env names in `matrixShortcutsEnvNames`).
   6. Tabout (Tab, plus `)`, `]` and `}` over an existing closer).
   7. Reverse tabout (`reverseTaboutTrigger`, Shift-Tab). It runs only when no tabstop is active, because previous-tabstop also uses Shift-Tab and comes earlier in the list.

   When a handler succeeds, the keydown handler returns `true`, so CodeMirror both prevents the default action and stops other handlers from seeing the key.
4. The keymaps live in `snippetStateField` (provided through the `keymap` facet). They are rebuilt only on reconfigure or when the file path changes, because snippets can be filtered per path with `includedPaths`.

## Snippet pipeline

| Stage | File | Notes |
|---|---|---|
| Source text | `data.json` → `snippets` (a JS module string) or snippet files and folders | Loaded with `import()` from a Blob URL. `require("latex-suite")` is injected and returns `snippetVariables`, `tabstop_node`, `text_node`, `capture_node`, `ALL_MACROS`, `addRawConcealMaps`, `addMathlessMacros`, `addUpdateHandler` |
| Validation | `snippets/parse.ts` `RawSnippetSchema` (valibot) | Fields: `trigger`, `triggerAfter`, `replacement` (string, node[] or fn), `options`, `flags`, `priority`, `description`, `triggerKey`, `language`, `excludedMacros`, `excludedEnvironments`, `includedMacros`, `includedPaths` (glob or fn), `context` (fn) |
| Normalisation | `parseSnippet()` | Splits into `RegexSnippet`, `StringSnippet` or `VisualSnippet`. Substitutes `${VARS}`, wraps regexes as `(?:…)$` and `triggerAfter` as `^(?:…)`, and adds built-in `EXCLUSIONS` (for example `->` is excluded in `\ce`). A `triggerKey` on an `A` snippet produces two snippets |
| Ordering | `snippets/sort.ts` | Priority descending, then trigger length descending (a regex counts by its source length) |
| Matching | `features/run_snippets.ts` `runSnippetCursor` | Per cursor: mode check (`Options.snippetShouldRunInMode`), then included scope (macros or `context` fn), `process()`, excluded scope, and word boundary (`w`). The first match wins. Trailing whitespace is trimmed in inline math |
| Replacement | `snippets/luasnip_api/node.ts` | `[[n]]` captures are expanded first, then `$n` and `${n:default}` tabstops. Functions may return a string, `false` (skip) or `BaseNode[]` |
| Expansion | `snippets/snippet_management.ts` `queueSnippet` → `expandSnippets` | All cursors are queued and dispatched together. The trigger key is inserted and then undone (`isolateHistory`), so Undo leaves the typed text. Tabstops become `TabstopGroup` decorations (`snippets/tabstop.ts`, `codemirror/tabstops_state_field.ts`). Indentation and callout `>` prefixes are preserved on newlines in the replacement |
| Recursion | `snippetRecursion` setting | Loops `runSnippets` again with no key |

### Option letters (`editor_context/options.ts`)

| Letter | Meaning |
|---|---|
| `A` | Automatic |
| `r` | Regex |
| `w` | Word boundary, using the `wordDelimiters` setting |
| `v` | Visual |
| `U` | Do not reinsert the trigger key on undo |
| `m` | Inline and block math |
| `n` | Inline math only |
| `M` | Block math only |
| `t` | Text |
| `T` | Inside `\text{}`-like macros in math |
| `c` | Code block (the `language` field narrows it) |
| `C` | Inline code |

If no mode letter is given, the snippet runs in every mode.

## Context and mode detection

- The plugin has its **own parser**. `parser/mathjax-parser.ts` combines `@lezer/markdown`, a custom `$`/`$$` inline and block math parser, HTML and the LaTeX grammar in `parser/mathjax/latex.grammar`, using `parseMixed`. `parser/language.ts` runs it incrementally in the background (a copy of CodeMirror's parse worker). Use `modifiedSyntaxTree(state)`, not Obsidian's `syntaxTree`, to get LaTeX nodes.
- `editor_context/mathbounds.ts` (`MathBoundsPlugin`) collects math regions in the **visible ranges** only: `$…$`, `$$…$$`, fenced code in `forceMathLanguages`, `$…$` math inside fenced code in `forceLatexLanguages` (default `latex`), `<span class="math">` in HTML, and the Excalidraw whole-document case. Lookups use binary search.
- `editor_context/context.ts` (`Context`, a ViewPlugin that updates lazily through `init()`) builds the `Mode` flags. `getEnvNames(pos)` walks the LaTeX tree outward and yields `{kind: environment | command | math, bounds, node}`. Excluded and included macros and the text or restricted macros (`default_text_areas.ts`, plus the `textMacros` setting) are resolved from this stack, including the argument index (for example `colorbox` arg 1 is text and arg 0 is restricted).

## Other features

| Feature | File | Notes |
|---|---|---|
| Autofraction | `features/autofraction.ts` | Scans back from the cursor for the numerator, skipping balanced brackets |
| Tabout | `features/tabout.ts` | Token-based (`utils/tokenizer.ts`). Handles `\left`/`\right` and exits the equation at the end of a line. `reversetabout` walks the LaTeX tree backwards to the previous opening delimiter |
| Matrix shortcuts | `features/matrix_shortcuts.ts` | Tab inserts ` & `, Enter inserts ` \\` plus a newline, Shift-Enter exits |
| Auto-enlarge brackets | `features/auto_enlarge_brackets.ts` | Adds `\left`/`\right` when the bracket contents contain trigger words |
| Commands | `features/editor_commands.ts` | Box or select the equation, toggle features or conceal, Vim mappings |
| Conceal | `editor_extensions/conceal.ts`, `conceal_fns.ts`, `conceal_maps.ts` | Tree-driven. Built by `mkConcealPlugin(settings)`. Options: `concealLinewise` and `concealLogLevel`. Maps can be extended by the user (`concealMaps` JSON) or from snippet files. `function_macros` lists macros that are not concealed |
| Math preview tooltip | `editor_extensions/math_tooltip.ts` | Built by `createMathTooltipExtension(settings)`. Uses Obsidian `renderMath`. With `mathElementsClickable`, clicking a rendered equation (in the preview or in the editor) moves the cursor to the matching spot in the source |
| Theming | `styles.css` `/* @settings */` block | Colours for tabstop placeholders, coloured and mismatched brackets, and `$` highlighting can be changed through the Style Settings plugin |
| Bracket colouring and highlighting | `editor_extensions/highlight_brackets.ts` | |
| `$` highlighting | `editor_extensions/highlight_dollar.ts` | |

## Settings

- `settings/settings.ts` defines `DEFAULT_SETTINGS` (raw and persisted) and `processLatexSuiteSettings()`, which produces `LatexSuiteCMSettings` (the parsed form). The parsed settings reach every CodeMirror extension through the `latexSuiteConfig` facet: `getLatexSuiteConfig(view|state)`.
- `main.ts` `setEditorExtensions()` pushes the extensions conditionally. `app.workspace.updateOptions()` then reconfigures the editors. To add a new setting, add it to the interface and defaults, the settings UI (`settings/settings_tab.ts`, strings in `src/i18n/locales/en/settings.json`) and the processing step, then read it through the facet.
- `settings/file_watch.ts` loads snippet and variable files or folders from the vault and watches them.

## Public and plugin API

`main.ts` exposes `snippet()`, `modifiedSyntaxTree`, `disableMath`, `onUpdate`, and `api.{effects, fields, plugin, shortcuts, snippetApi}`. Typings are in `src/api.d.ts`.

## Customisations in this fork (branch `custom`)

The `custom` branch is built on `v1.14.5-base`.

| Change | Files | Notes |
|---|---|---|
| **Center display math** setting (Appearance section, on by default) | `styles.css`, `src/main.ts` (`updateAppearance`, `CENTER_DISPLAY_MATH_CLASS`), `src/settings/settings.ts`, `src/settings/empty_settings.ts`, `src/settings/settings_tab.ts`, `src/settings/settings_tab2.ts`, `src/i18n/locales/en/settings.json` | Pure CSS behind the body class `latex-suite-center-display-math`, which is toggled on the main window and on pop-outs. The rule centers the cells of top-level, one-column, right-aligned MathJax tables: `align`, `align*`, `aligned` and `split` without `&`. Tables with `&` columns, `multline` (marked by `data-width-includes-label`) and `array{l}` keep their layout. Verified against MathJax 3.2.2 CHTML output, with and without equation numbering |
