const vscode = require("vscode");
const path = require("path");
const { execFile } = require("child_process");
const { CONFIG_SECTION, DEFAULT_SCRIPT_PATH } = require("./constants");
const { scanDocument } = require("./diagnostics");

/**
 * Runs the workspace check-localization.js script on staged files and shows the output.
 * @param {import("vscode").OutputChannel} outputChannel
 */
function runFullCheck(outputChannel) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("Localization Check: no workspace folder is open.");
        return;
    }

    const root = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const scriptRelPath = config.get("scriptPath", DEFAULT_SCRIPT_PATH);
    const scriptPath = path.join(root, scriptRelPath);

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`Running ${scriptRelPath} ...\n`);

    execFile("node", [scriptPath], { cwd: root, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (stdout) outputChannel.appendLine(stdout);
        if (stderr) outputChannel.appendLine(stderr);

        if (error) {
            vscode.window.showErrorMessage(
                "Localization check failed — see the 'Localization Check' output panel.",
            );
        } else {
            vscode.window.showInformationMessage("Localization check passed.");
        }
    });
}

/**
 * Re-scans the currently active file for unlocalized strings.
 * @param {import("vscode").DiagnosticCollection} diagnostics
 */
function scanCurrentFile(diagnostics) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        scanDocument(editor.document, diagnostics);
    }
}

module.exports = {
    runFullCheck,
    scanCurrentFile,
};
