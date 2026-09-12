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
- **Terminal & Task Interceptor**: Automatically halts terminal commands (like `yarn start`, `npm run dev`, `yarn build`) and cancels VS Code build tasks/debug sessions when unlocalized text is detected.

## Commands

- **Localization: Run Full Check (git staged)**: executes the project's localization check script on git-staged changes and displays results in the output panel.
- **Localization: Re-scan Current File**: manually scans the active file again.

## Configuration

Add settings in your project's `.vscode/settings.json` when you want to customize the extension:

```json
{
  "localizationCheck.scriptPath": "scripts/check-localization.js",
  "localizationCheck.liveScan": true,
  "localizationCheck.diagnosticSeverity": "error",
  "localizationCheck.liveScanOnlyChangedFiles": true,
  "localizationCheck.warnOnStage": true,
  "localizationCheck.blockTerminalCommands": true,
  "localizationCheck.blockBuildTasks": true
}
```

### Settings

- `localizationCheck.scriptPath`: optional relative path to a localization check script in the workspace root. Default: `"scripts/check-localization.js"`.
- `localizationCheck.liveScan`: enables or disables live scanning. Default: `true`.
- `localizationCheck.diagnosticSeverity`: controls whether matches appear as `"error"` or `"warning"`. Default: `"error"`.
- `localizationCheck.liveScanOnlyChangedFiles`: scans only changed files and unsaved buffers when enabled. Default: `true`.
- `localizationCheck.warnOnStage`: displays a notification warning when files staged for commit contain unlocalized text. Default: `true`.
- `localizationCheck.blockTerminalCommands`: stops dev/build terminal commands (e.g. `yarn start`, `npm run dev`, `yarn build`) when unlocalized strings are detected. Default: `true`.
- `localizationCheck.blockBuildTasks`: cancels VS Code build tasks (`Ctrl+Shift+B`) and debug launches (`F5`) when unlocalized strings are detected. Default: `true`.

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
code --install-extension localization-check-0.1.6.vsix
```

You can also install it from VS Code with **Extensions** > **...** > **Install from VSIX**.

## Development & Architecture

This extension has no runtime npm dependencies. The codebase is organized modularly under `src/`:

- `extension.js`: Main entry point and activation lifecycle handler.
- `src/constants.js`: Shared regex patterns, configuration keys, and language targets.
- `src/detector.js`: Detection rules for attributes, JSX text, and object properties.
- `src/git.js`: Git extension integration and change detection watchers.
- `src/diagnostics.js`: Diagnostics collection and severity mapping.
- `src/interceptor.js`: Terminal shell execution, VS Code build task, and debug session interceptors.
- `src/commands.js`: Command handlers for manual and workspace checks.
- `package.json`: Extension manifest and configuration contribution settings.
