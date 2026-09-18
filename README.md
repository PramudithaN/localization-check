# Localization Check

![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Babel AST](https://img.shields.io/badge/AST%20Parser-Babel-F9DC3E?style=for-the-badge&logo=babel&logoColor=black)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

> A production-grade VS Code extension that flags hardcoded user-facing text in changed JavaScript and TypeScript files using a robust Babel AST parser.

## Features

- **Robust AST-Based Detection**: Powered by `@babel/parser` and `@babel/traverse` with full support for JSX, TSX, TypeScript, and modern ECMAScript features. Tolerates in-progress code edits with graceful error recovery.
- **JSX Text & Attributes**: Detects hardcoded JSX text and UI prop values such as `label`, `title`, `placeholder`, `tooltip`, `aria-label`, `alt`, `description`, `helperText`, and `buttonText`.
- **Object Properties**: Detects user-facing object values such as `title: "Save"`, `label: "Name"`, `text: "Continue"`, and `message: "Updated"`.
- **Notification & Toast Functions**: Accurately detects `showNotification`, `showToast`, `notify`, and `displayNotification` arguments, automatically skipping the 1st severity/status argument.
- **Template Literals & String Concatenations**: Flags static text segments inside template literals (e.g. `` `Welcome back, ${name}!` ``) and binary string concatenations (`"Hello " + user.name`).
- **Confidence Scoring & Filtering**: Classifies detected strings by confidence (`high`, `medium`, `low`) and allows filtering via `localizationCheck.minimumConfidence`.
- **Unused Dictionary Key Finder**: Scans your workspace to identify translation keys in `en.json` that have zero usages in your codebase.
- **Safe Batch Localization with Preview**: Review and confirm proposed batch string replacements before committing changes and writing keys to `en.json`.
- **Direct GitHub Copilot Integration**: Automatically extracts and localizes hardcoded strings using GitHub Copilot via Quick Fix or interactive CodeLens buttons.
- **Auto-Defines Translation Hook**: Accurately detects missing `const { t } = useTranslation();` hook declarations inside React components and inserts both the hook and `import { useTranslation } from 'react-i18next';` automatically without creating unused imports.
- **Auto-Syncs Primary Dictionary (`en.json`)**: Discovers or creates `en.json` in the workspace and automatically appends generated key-value pairs, deduplicating common actions (e.g. *Save, Cancel, Submit, Delete, Edit, Search*) into the `common` namespace (`common.save`, `common.cancel`, etc.).
- **Learn & Flag Hardcoded Patterns**: One-click action to flag previously unflagged JSX tags, attributes, or object properties. Automatically updates local settings and submits an issue to GitHub to improve detection for everyone.
- **Ignore False Positives**: Easily ignore non-user-facing strings, technical identifiers, or custom attributes across your workspace and report false positive exceptions.

## Commands & Keyboard Shortcuts

All commands have default keyboard shortcuts configured and can be completely remapped to any key combination that suits your workflow.

| Action / Command | Windows & Linux | macOS | Command ID |
| :--- | :--- | :--- | :--- |
| **Add Localization with Copilot** | `Alt + L` | `⌥ Option + L` (`Cmd + Alt + L`) | `localizationCheck.localizeWithCopilot` |
| **Localize All in Current File** | `Alt + Shift + L` | `⌥ Option + ⇧ Shift + L` (`Cmd + Alt + Shift + L`) | `localizationCheck.localizeAllInFile` |
| **Find Unused Translation Keys** | `Alt + U` | `⌥ Option + U` (`Cmd + Alt + U`) | `localizationCheck.findUnusedKeys` |
| **Flag Pattern as Hardcoded Rule** | `Alt + F` | `⌥ Option + F` (`Cmd + Alt + F`) | `localizationCheck.flagHardcoded` |
| **Mark / Ignore as False Positive** | `Alt + M` | `⌥ Option + M` (`Cmd + Alt + M`) | `localizationCheck.markFalsePositive` |
| **Re-scan Current File** | `Alt + S` | `⌥ Option + S` (`Cmd + Alt + S`) | `localizationCheck.scanFile` |
| **Run Full Check (git staged)** | `Alt + R` | `⌥ Option + R` (`Cmd + Alt + R`) | `localizationCheck.run` |

### Customizing Shortcut Keys

You can customize any shortcut key in VS Code to match your preference:
1. Open **Keyboard Shortcuts** in VS Code:
   - Press `Ctrl + K, Ctrl + S` (Windows/Linux) or `Cmd + K, Cmd + S` (macOS).
   - Or navigate to **File** > **Preferences** > **Keyboard Shortcuts** (or **Code** > **Settings** > **Keyboard Shortcuts** on macOS).
2. Type `localizationCheck` or `Localization:` in the search bar.
3. Click on the edit icon or press `Enter` on any command to assign your preferred key combination.
4. Alternatively, edit your user `keybindings.json` directly.

### Command Descriptions

- **Localization: Run Full Check (git staged)** (`Alt + R`): executes the project's localization check script on git-staged changes and displays results in the output panel.
- **Localization: Re-scan Current File** (`Alt + S`): manually scans the active file again.
- **Localization: Find Unused Translation Keys** (`Alt + U`): scans your codebase for `t('...')` usages and reports defined dictionary keys in `en.json` that are unused.
- **Localization: Add Localization with Copilot** (`Alt + L`): sends the selected or underlined hardcoded string to GitHub Copilot's Language Model, inserts missing imports/hooks, updates the dictionary, and replaces the string inline with the localized expression (e.g. `t('...')` or `formatMessage(...)`).
- **Localization: Localize All in Current File with Copilot** (`Alt + Shift + L`): sends all detected hardcoded strings in the current file to GitHub Copilot in a single batch request, displays a confirmation dialog with diff preview, and automatically updates the document and dictionary.
- **Localization: Flag Pattern as Hardcoded Rule (Report & Learn)** (`Alt + F`): detects the JSX tag, attribute, or property at cursor, adds it to your project rules, immediately re-scans the workspace, and creates a rule suggestion issue on GitHub.
- **Localization: Mark / Ignore as False Positive (Report & Learn)** (`Alt + M`): ignores a specific word, attribute, or property so it is never flagged again, and creates a false positive report on GitHub.

## Configuration

Add settings in your project's `.vscode/settings.json` when you want to customize the extension:

```json
{
  "localizationCheck.scriptPath": "scripts/check-localization.js",
  "localizationCheck.liveScan": true,
  "localizationCheck.diagnosticSeverity": "error",
  "localizationCheck.minimumConfidence": "low",
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
- `localizationCheck.minimumConfidence`: minimum confidence required to flag hardcoded strings (`"low"`, `"medium"`, `"high"`). Default: `"low"`.
- `localizationCheck.liveScanOnlyChangedFiles`: scans only changed files and unsaved buffers when enabled. Default: `true`.
- `localizationCheck.warnOnStage`: displays a notification warning when files staged for commit contain unlocalized text. Default: `true`.
- `localizationCheck.enableCodeLens`: displays clickable `Add localization with Copilot` CodeLens buttons above detected hardcoded strings. Default: `true`.
- `localizationCheck.copilotPromptHint`: optional custom instructions passed to Copilot (e.g. `"Use react-intl formatMessage"` or `"Use i18next"`). Default: `""`.
- `localizationCheck.dictionaryPath`: optional relative path or glob to primary dictionary file (e.g. `"src/utils/localization/lang-json/en.json"`). Default: `""` (auto-detects `en.json`).
- `localizationCheck.autoUpdateDictionary`: automatically appends generated translation keys and English values into `en.json`. Default: `true`.
- `localizationCheck.autoImportTranslation`: automatically inserts missing i18n hook declarations (`const { t } = useTranslation();`) and imports (`import { useTranslation } from 'react-i18next';`) into the file. Default: `true`.
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
code --install-extension localization-check-0.5.0.vsix
```

You can also install it from VS Code with **Extensions** > **...** > **Install from VSIX**.

## Development & Architecture

The codebase is organized modularly under `src/`:

- `extension.js`: Main entry point and activation lifecycle handler.
- `src/ast.js`: Babel AST parser, visitor engine, React component scope analysis, and position-to-range mapping.
- `src/constants.js`: Shared constants, default tags, attributes, and language targets.
- `src/detector.js`: High-level detection manager wrapping AST visitors and configuration rules.
- `src/dictionary.js`: Translation dictionary discovery, unused key finder, and JSON synchronization for `en.json`.
- `src/copilot.js`: Direct GitHub Copilot Language Model integration and workspace edit handler with confirmation preview.
- `src/providers.js`: CodeAction (Quick Fix) and CodeLens providers with confidence indicator.
- `src/git.js`: Git extension integration, change detection watchers, and staged file monitoring.
- `src/diagnostics.js`: Diagnostics collection, confidence filtering, and severity mapping.
- `src/commands.js`: Command handlers for manual scans, full workspace checks, Copilot localization, and unused key detection.
- `src/rules.js`: Interactive rule learning, false positive management, and automated GitHub issue creation.
- `package.json`: Extension manifest and configuration contribution settings.
