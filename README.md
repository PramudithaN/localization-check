# Localization Check

![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Git](https://img.shields.io/badge/Git-Changed%20Files-F05032?style=for-the-badge&logo=git&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

A VS Code extension that flags hardcoded user-facing text in changed JavaScript and TypeScript files.

## Features

- Highlights hardcoded JSX text in `.js`, `.jsx`, `.ts`, and `.tsx` files.
- Detects user-facing prop values such as `label`, `title`, `placeholder`, `tooltip`, `aria-label`, `alt`, `description`, `helperText`, and `buttonText`.
- Detects object values such as `title: "Save"`, `label: "Name"`, and `text: "Continue"`.
- Detects multiline JSX text, including text inside elements like `<kbd>` and text after spacing expressions like `{ " " }`.
- Scans only files changed in Git or unsaved editor buffers by default.
- Shows diagnostics as errors by default in the Problems panel.

## Commands

- **Localization: Re-scan Current File**: manually scans the active file again.

## Configuration

Add settings in your project's `.vscode/settings.json` when you want to customize the extension:

```json
{
  "localizationCheck.liveScan": true,
  "localizationCheck.diagnosticSeverity": "error",
  "localizationCheck.liveScanOnlyChangedFiles": true
}
```

### Settings

- `localizationCheck.liveScan`: enables or disables live scanning. Default: `true`.
- `localizationCheck.diagnosticSeverity`: controls whether matches appear as `"error"` or `"warning"`. Default: `"error"`.
- `localizationCheck.liveScanOnlyChangedFiles`: scans only changed files and unsaved buffers when enabled. Default: `true`.

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
code --install-extension localization-check-0.1.2.vsix
```

You can also install it from VS Code with **Extensions** > **...** > **Install from VSIX**.

## Development

This extension has no runtime npm dependencies. The main extension code is in `extension.js`, and contribution metadata is defined in `package.json`.
