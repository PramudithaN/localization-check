const vscode = require("vscode");
const path = require("path");
const { execFile } = require("child_process");
const { CONFIG_SECTION, DEFAULT_SCRIPT_PATH, SOURCE_NAME } = require("./constants");
const { scanDocument } = require("./diagnostics");
const { localizeWithCopilot, localizeAllInDocument } = require("./copilot");
const { handleFlagAsHardcoded, handleMarkAsFalsePositive } = require("./rules");

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
        scanDocument(editor.document, diagnostics, true);
    }
}

/**
 * Resolves a TextDocument from various possible inputs (Uri, plain object with uri/fsPath, or undefined).
 * @param {import("vscode").TextDocument | import("vscode").Uri | any} [docOrUri]
 * @returns {Promise<import("vscode").TextDocument | null>}
 */
async function resolveDocument(docOrUri) {
    if (!docOrUri) {
        return vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : null;
    }

    // Already a TextDocument instance
    if (typeof docOrUri.getText === "function" && docOrUri.uri) {
        return docOrUri;
    }

    // vscode.Uri instance
    if (docOrUri instanceof vscode.Uri) {
        const openDoc = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === docOrUri.toString(),
        );
        if (openDoc) return openDoc;

        try {
            return await vscode.workspace.openTextDocument(docOrUri);
        } catch {
            return null;
        }
    }

    // Plain object with uri or path (e.g., from command serialization)
    const uriCandidate = docOrUri.uri || docOrUri;
    if (uriCandidate) {
        if (typeof uriCandidate.fsPath === "string") {
            try {
                const uri = vscode.Uri.file(uriCandidate.fsPath);
                const openDoc = vscode.workspace.textDocuments.find(
                    d => d.uri.toString() === uri.toString(),
                );
                if (openDoc) return openDoc;
                return await vscode.workspace.openTextDocument(uri);
            } catch {
                // fallback
            }
        } else if (typeof uriCandidate.path === "string" && typeof uriCandidate.scheme === "string") {
            try {
                const uri = vscode.Uri.from(uriCandidate);
                const openDoc = vscode.workspace.textDocuments.find(
                    d => d.uri.toString() === uri.toString(),
                );
                if (openDoc) return openDoc;
                return await vscode.workspace.openTextDocument(uri);
            } catch {
                // fallback
            }
        }
    }

    return vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : null;
}

/**
 * Resolves a Range instance from a Range, plain object, or active selection.
 * @param {import("vscode").Range | any} [rawRange]
 * @returns {import("vscode").Range | null}
 */
function resolveRange(rawRange) {
    if (!rawRange) return null;

    if (rawRange instanceof vscode.Range) {
        return rawRange;
    }

    if (
        rawRange.start &&
        rawRange.end &&
        typeof rawRange.start.line === "number" &&
        typeof rawRange.start.character === "number" &&
        typeof rawRange.end.line === "number" &&
        typeof rawRange.end.character === "number"
    ) {
        return new vscode.Range(
            rawRange.start.line,
            rawRange.start.character,
            rawRange.end.line,
            rawRange.end.character,
        );
    }

    if (Array.isArray(rawRange) && rawRange.length === 2 && rawRange[0] && rawRange[1]) {
        return new vscode.Range(
            rawRange[0].line,
            rawRange[0].character,
            rawRange[1].line,
            rawRange[1].character,
        );
    }

    return null;
}

/**
 * Adjusts range to include surrounding quotes if cursor or partial selection was placed inside quotes.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").Range} range
 * @returns {import("vscode").Range}
 */
function adjustRangeForQuotes(document, range) {
    const text = document.getText(range);
    if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'")) ||
        (text.startsWith("`") && text.endsWith("`"))
    ) {
        return range;
    }

    const line = document.lineAt(range.start.line).text;
    const charBefore = range.start.character > 0 ? line[range.start.character - 1] : "";
    const charAfter = range.end.character < line.length ? line[range.end.character] : "";

    if (
        (charBefore === '"' && charAfter === '"') ||
        (charBefore === "'" && charAfter === "'") ||
        (charBefore === "`" && charAfter === "`")
    ) {
        return new vscode.Range(
            range.start.line,
            range.start.character - 1,
            range.end.line,
            range.end.character + 1,
        );
    }

    return range;
}

/**
 * Handles the "Add localization with Copilot" command.
 * Can be invoked via CodeAction/CodeLens with arguments or directly from editor context.
 * @param {import("vscode").TextDocument | import("vscode").Uri | any} [documentOrUri]
 * @param {import("vscode").Range | any} [rawRange]
 */
async function handleLocalizeWithCopilot(documentOrUri, rawRange) {
    const document = await resolveDocument(documentOrUri);
    if (!document) {
        vscode.window.showWarningMessage("No active editor or document found to localize.");
        return;
    }

    let range = resolveRange(rawRange);
    if (!range) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === document.uri.toString()) {
            if (!editor.selection.isEmpty) {
                range = new vscode.Range(editor.selection.start, editor.selection.end);
            } else {
                range = document.getWordRangeAtPosition(editor.selection.active) || null;
            }
        }
    }

    if (!range) {
        vscode.window.showWarningMessage("Please select or place cursor on the hardcoded text to localize.");
        return;
    }

    range = adjustRangeForQuotes(document, range);
    await localizeWithCopilot(document, range);
}

/**
 * Handles the "Localize All in File with Copilot" command.
 * @param {vscode.DiagnosticCollection} diagnosticsCollection
 * @param {import("vscode").TextDocument | import("vscode").Uri | any} [documentOrUri]
 */
async function handleLocalizeAllInFile(diagnosticsCollection, documentOrUri) {
    const document = await resolveDocument(documentOrUri);
    if (!document) {
        vscode.window.showWarningMessage("No active document found to localize.");
        return;
    }

    let diagnostics = (diagnosticsCollection.get(document.uri) || []).filter(
        d => d.source === SOURCE_NAME,
    );

    if (diagnostics.length === 0) {
        scanDocument(document, diagnosticsCollection);
        diagnostics = (diagnosticsCollection.get(document.uri) || []).filter(
            d => d.source === SOURCE_NAME,
        );
    }

    if (diagnostics.length === 0) {
        vscode.window.showInformationMessage("No hardcoded strings detected in this file.");
        return;
    }

    await localizeAllInDocument(document, diagnostics);
}

/**
 * Handles the "Flag as Hardcoded" command.
 * @param {vscode.DiagnosticCollection} diagnosticsCollection
 * @param {import("vscode").TextDocument | import("vscode").Uri | any} [documentOrUri]
 * @param {import("vscode").Range | any} [rawRange]
 */
async function handleFlagHardcodedCommand(diagnosticsCollection, documentOrUri, rawRange) {
    const document = await resolveDocument(documentOrUri);
    const range = resolveRange(rawRange);
    await handleFlagAsHardcoded(diagnosticsCollection, document, range);
}

/**
 * Handles the "Mark as False Positive" command.
 * @param {vscode.DiagnosticCollection} diagnosticsCollection
 * @param {import("vscode").TextDocument | import("vscode").Uri | any} [documentOrUri]
 * @param {import("vscode").Range | any} [rawRange]
 */
async function handleMarkFalsePositiveCommand(diagnosticsCollection, documentOrUri, rawRange) {
    const document = await resolveDocument(documentOrUri);
    const range = resolveRange(rawRange);
    await handleMarkAsFalsePositive(diagnosticsCollection, document, range);
}

module.exports = {
    runFullCheck,
    scanCurrentFile,
    handleLocalizeWithCopilot,
    handleLocalizeAllInFile,
    handleFlagHardcodedCommand,
    handleMarkFalsePositiveCommand,
};
