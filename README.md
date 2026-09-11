# Localization Check (VS Code extension)

Wraps your existing `scripts/check-localization.js` and adds live in-editor
warnings for hardcoded user-facing strings.

## What it does

- **Command: "Localization: Run Full Check (git staged)"** — runs your
  actual `scripts/check-localization.js` against `git diff --cached`,
  exactly like your pre-commit check does, and prints the result to an
  output panel.
- **Live diagnostics** — while editing `.ts` / `.tsx` / `.js` / `.jsx`
  files, hardcoded labels/JSX text are underlined in the Problems panel
  as you type/save (using the same detection rules as the script, just
  applied to the whole open file instead of the staged diff).
- **Command: "Localization: Re-scan Current File"** — manually re-run
  the live scan on the active file.
- **Automatic staging warning** — the moment you `git add` (or stage
  via the Source Control panel) a file with hardcoded text, a warning
  notification pops up with a "Show Details" button. It only fires
  once per repo when the state transitions from clean → failing, so
  it won't spam you while you keep editing. Turn this off with
  `localizationCheck.warnOnStage: false`.

**Important:** this notification is a heads-up only — it does **not**
block `git commit`. Nothing running inside VS Code reliably can,
since a commit can happen from any git client, not just this editor.
Your actual enforcement is still the pre-commit hook (husky) running
`check-localization.js` at the git level — keep that as-is. This
extension just surfaces the same problem earlier, before you even
open a terminal.

## Try it locally (free, no publishing needed)

1. Unzip this folder somewhere.
2. Open the folder in VS Code (`code localization-check-extension`).
3. Press **F5**. This launches an "Extension Development Host" window
   — a second VS Code window with the extension active.
4. In that new window, open your actual project folder (the one
   containing `scripts/check-localization.js`).
5. Edit a `.tsx` file and add a hardcoded string like
   `<button title="Submit now">` — you should see a warning squiggle.
6. Run **Cmd/Ctrl+Shift+P → "Localization: Run Full Check"** to run the
   real script against your staged changes.

No `npm install` is needed — this extension has zero dependencies
beyond the `vscode` API.

## Configuration

In your project's `.vscode/settings.json`:

```json
{
  "localizationCheck.scriptPath": "scripts/check-localization.js",
  "localizationCheck.liveScan": true
}
```

## Installing it for real (so it's there every time, no F5 needed)

You don't need to publish to the Marketplace to use this yourself or
share it with your team.

1. Install the packaging CLI once: `npm install -g @vscode/vsce`
2. From this folder: `vsce package` — produces
   `localization-check-0.1.0.vsix`
3. Install it: `code --install-extension localization-check-0.1.0.vsix`
   (or in VS Code: Extensions panel → `...` menu → "Install from VSIX")

Share the `.vsix` file with teammates and they can install it the same
way — no Marketplace account, no cost.

## Publishing to the Marketplace (optional, also free)

Only needed if you want `ext install` / Marketplace search to find it.
Requires a free Azure DevOps account for a Personal Access Token, then:

```
vsce login localisation.ex-publish
vsce publish
```

Before publishing, create the public repository at
`https://github.com/pramudithan/localization-check` and create the
`localisation.ex-publish` publisher in the Visual Studio Marketplace.
