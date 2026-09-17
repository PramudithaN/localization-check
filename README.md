# Localization Check

![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

> A VS Code extension that flags hardcoded user-facing text in changed JavaScript and TypeScript files.

## Features

- Highlights hardcoded JSX text in `.js`, `.jsx`, `.ts`, and `.tsx` files.
- Detects user-facing prop values such as `label`, `title`, `placeholder`, `tooltip`, `aria-label`, `alt`, `description`, `helperText`, and `buttonText`.
- Detects object values such as `title: "Save"`, `label: "Name"`, `text: "Continue"`, and `message: "Updated"`.
- Detects notification and toast function arguments (e.g. `showNotification("error", "Failed to connect", "Try again later")`), skipping the 1st type/status argument and detecting subsequent user-facing messages.
- Multiline and single-line notification function checks (e.g. `showNotification`).
- Scans only files changed in Git or unsaved editor buffers by default.
- Shows diagnostics as errors by default in the Problems panel.
- **Direct GitHub Copilot Integration**: Automatically extracts and localizes hardcoded strings using GitHub Copilot via Quick Fix (💡) or interactive CodeLens buttons.
- **Auto-Defines Translation Function**: Detects if `useTranslation` / `t` hook and imports are missing in the active component and inserts them automatically.
- **Auto-Syncs Translation Dictionaries**: Discovers `en.json` (and sibling locale files like `sin.json` / `es.json`) in the workspace and automatically appends the generated key-value pairs into the dictionary.
- **Learn & Flag Hardcoded Patterns**: One-click action to flag previously unflagged JSX tags, attributes, or object properties. Automatically updates local settings and submits an issue to GitHub to improve detection for everyone.
- **Ignore False Positives**: Easily ignore non-user-facing strings, technical identifiers, or custom attributes across your workspace and report false positive exceptions.

## Commands

- **Localization: Run Full Check (git staged)**: executes the project's localization check script on git-staged changes and displays results in the output panel.
- **Localization: Re-scan Current File**: manually scans the active file again.
- **Localization: Add Localization with Copilot**: sends the selected or underlined hardcoded string to GitHub Copilot's Language Model, inserts missing imports/hooks, updates the dictionary, and replaces the string inline with the localized expression (e.g. `t('...')` or `formatMessage(...)`).
- **Localization: Localize All in Current File with Copilot**: sends all detected hardcoded strings in the current file to GitHub Copilot in a single batch request and automatically updates the whole document and translation dictionaries at once.
- **Localization: Flag Pattern as Hardcoded Rule (Report & Learn)**: detects the JSX tag, attribute, or property at cursor, adds it to your project rules, immediately re-scans the workspace, and creates a rule suggestion issue on GitHub.
- **Localization: Mark / Ignore as False Positive (Report & Learn)**: ignores a specific word, attribute, or property so it is never flagged again, and creates a false positive report on GitHub.

## Configuration

Add settings in your project's `.vscode/settings.json` when you want to customize the extension:

```json
{
  "localizationCheck.scriptPath": "scripts/check-localization.js",
  "localizationCheck.liveScan": true,
  "localizationCheck.diagnosticSeverity": "error",
  "localizationCheck.liveScanOnlyChangedFiles": true,
  "localizationCheck.warnOnStage": true,
  "localizationCheck.enableCodeLens": true,
  "localizationCheck.copilotPromptHint": "",
  "localizationCheck.dictionaryPath": "",
  "localizationCheck.autoUpdateDictionary": true,
  "localizationCheck.autoImportTranslation": true,
  "localizationCheck.customAttributes": ["caption", "headerTitle"],
  "localizationCheck.customProperties": ["subTitle", "bannerText"],
  "localizationCheck.customTags": ["Typography", "Badge", "Heading"],
  "localizationCheck.ignoredWords": ["primary-dark", "UUID"],
  "localizationCheck.ignoredAttributes": ["data-testid"],
  "localizationCheck.ignoredProperties": ["id", "key"],
  "localizationCheck.ignoredTags": ["code", "pre", "script", "style"],
  "localizationCheck.githubRepo": "PramudithaN/localization-check"
}
```

### Settings

- `localizationCheck.scriptPath`: optional relative path to a localization check script in the workspace root. Default: `"scripts/check-localization.js"`.
- `localizationCheck.liveScan`: enables or disables live scanning. Default: `true`.
- `localizationCheck.diagnosticSeverity`: controls whether matches appear as `"error"` or `"warning"`. Default: `"error"`.
- `localizationCheck.liveScanOnlyChangedFiles`: scans only changed files and unsaved buffers when enabled. Default: `true`.
- `localizationCheck.warnOnStage`: displays a notification warning when files staged for commit contain unlocalized text. Default: `true`.
- `localizationCheck.enableCodeLens`: displays clickable `Add localization with Copilot` CodeLens buttons above detected hardcoded strings. Default: `true`.
- `localizationCheck.copilotPromptHint`: optional custom instructions passed to Copilot (e.g. `"Use react-intl formatMessage"` or `"Use i18next"`). Default: `""`.
- `localizationCheck.dictionaryPath`: optional relative path or glob to primary dictionary file (e.g. `"src/utils/localization/lang-json/en.json"`). Default: `""` (auto-detects `en.json`).
- `localizationCheck.autoUpdateDictionary`: automatically appends generated translation keys and English values into `en.json` (and sibling locale files). Default: `true`.
- `localizationCheck.autoImportTranslation`: automatically inserts missing i18n imports (e.g. `useTranslation`) and hook declarations (`const { t } = useTranslation();`) into the file. Default: `true`.
- `localizationCheck.customAttributes`: array of additional JSX/HTML attribute names to flag as hardcoded strings. Default: `[]`.
- `localizationCheck.customProperties`: array of additional object property names to flag as hardcoded strings. Default: `[]`.
- `localizationCheck.customTags`: array of additional JSX/HTML component/tag names whose inner text should be flagged. Default: `[]`.
- `localizationCheck.ignoredWords`: array of words or phrases that should never be flagged. Default: `[]`.
- `localizationCheck.ignoredAttributes`: array of attribute names to ignore and never flag. Default: `[]`.
- `localizationCheck.ignoredProperties`: array of property names to ignore and never flag. Default: `[]`.
- `localizationCheck.ignoredTags`: array of tag names whose text should be ignored. Default: `["code", "pre", "script", "style"]`.
- `localizationCheck.githubRepo`: target repository (`owner/repo`) for submitting automated rule suggestions and false positives. Default: `"PramudithaN/localization-check"`.

## Try It Locally

1. Open this extension folder in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. In the new VS Code window, open a JavaScript or TypeScript project.
4. Edit a changed `.tsx`, `.jsx`, `.ts`, or `.js` file.
5. Add hardcoded UI text, for example:

```tsx
<button title="Submit now">Save</button>
```

The extension should underline `Submit now` and `Save` as localization errors.

Clean, unchanged files are ignored by default. To scan every open file, set:

```json
{
  "localizationCheck.liveScanOnlyChangedFiles": false
}
```

## Install From VSIX

1. Install the VS Code packaging tool:

```bash
npm install -g @vscode/vsce
```

2. Package the extension from this folder:

```bash
vsce package
```

3. Install the generated `.vsix` file:

```bash
code --install-extension localization-check-0.4.1.vsix
```

You can also install it from VS Code with **Extensions** > **...** > **Install from VSIX**.

## Development & Architecture

This extension has no runtime npm dependencies. The codebase is organized modularly under `src/`:

- `extension.js`: Main entry point and activation lifecycle handler.
- `src/constants.js`: Shared regex patterns, configuration keys, and language targets.
- `src/detector.js`: Detection rules for attributes, JSX text, and object properties.
- `src/dictionary.js`: Translation dictionary discovery and JSON synchronization for `en.json` and sibling locale files.
- `src/copilot.js`: Direct GitHub Copilot Language Model integration and workspace edit handler.
- `src/providers.js`: CodeAction (Quick Fix) and CodeLens providers.
- `src/git.js`: Git extension integration and change detection watchers.
- `src/diagnostics.js`: Diagnostics collection and severity mapping.
- `src/commands.js`: Command handlers for manual, workspace checks, and Copilot localization.
- `src/rules.js`: Interactive rule learning, false positive management, and automated GitHub issue creation.
- `package.json`: Extension manifest and configuration contribution settings.
