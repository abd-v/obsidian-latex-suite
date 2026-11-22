/**
 * Identifiers that differ between this custom build and the original Latex Suite
 * (plugin id `obsidian-latex-suite`), so both can be installed side by side without
 * sharing state. The plugin id itself lives in manifest.json, the Style Settings id in
 * styles.css, and the global used while importing snippets in src/snippets/parse.ts
 * (`__latex_suite_custom_require`).
 */

/** Plugin id of the original Latex Suite. */
export const ORIGINAL_PLUGIN_ID = "obsidian-latex-suite";

/**
 * CodeMirror keymap scope of this plugin's key bindings. The original uses "latex-suite";
 * a shared scope would make each plugin run the other's bindings.
 */
export const KEYMAP_SCOPE = "latex-suite-custom";
