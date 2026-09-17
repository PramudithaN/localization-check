const vscode = require("vscode");
const path = require("path");
const { execFile } = require("child_process");
const { CONFIG_SECTION, DEFAULT_SCRIPT_PATH, SOURCE_NAME } = require("./constants");
const { scanDocument } = require("./diagnostics");
const { localizeWithCopilot, localizeAllInDocument } = require("./copilot");

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

/**
 * Handles the "Add localization with Copilot" command.
 * Can be invoked via CodeAction/CodeLens with arguments or directly from editor context.
 * @param {import("vscode").TextDocument} [document]
 * @param {import("vscode").Range} [range]
 */
async function handleLocalizeWithCopilot(document, range) {
    if (document && range) {
        await localizeWithCopilot(document, range);
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("No active editor found to localize.");
        return;
    }

    const targetDoc = editor.document;
    const targetRange = editor.selection.isEmpty
        ? targetDoc.getWordRangeAtPosition(editor.selection.active)
        : new vscode.Range(editor.selection.start, editor.selection.end);

    if (!targetRange) {
        vscode.window.showWarningMessage("Please select the hardcoded text to localize.");
        return;
    }

    await localizeWithCopilot(targetDoc, targetRange);
}

/**
 * Handles the "Localize All in File with Copilot" command.
 * @param {vscode.DiagnosticCollection} diagnosticsCollection
 * @param {import("vscode").TextDocument} [document]
 */
async function handleLocalizeAllInFile(diagnosticsCollection, document) {
    const targetDoc = document || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
    if (!targetDoc) {
        vscode.window.showWarningMessage("No active document found to localize.");
        return;
    }

    const diagnostics = (diagnosticsCollection.get(targetDoc.uri) || []).filter(
        d => d.source === SOURCE_NAME,
    );

    if (diagnostics.length === 0) {
        vscode.window.showInformationMessage("No hardcoded strings detected in this file.");
        return;
    }

    await localizeAllInDocument(targetDoc, diagnostics);
}

module.exports = {
    runFullCheck,
    scanCurrentFile,
    handleLocalizeWithCopilot,
    handleLocalizeAllInFile,
};
