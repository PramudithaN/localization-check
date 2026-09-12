const vscode = require("vscode");
const { SOURCE_NAME } = require("./src/constants");
const { scanDocument, scanAllOpenDocuments } = require("./src/diagnostics");
const { runFullCheck, scanCurrentFile } = require("./src/commands");
const { watchStagedChanges, watchChangedFiles } = require("./src/git");
const { registerInterceptors } = require("./src/interceptor");

/**
 * Activates the Localization Check extension.
 * @param {import("vscode").ExtensionContext} context
 */
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("Localization Check");
    const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE_NAME);
    context.subscriptions.push(outputChannel, diagnostics);

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand("localizationCheck.run", () =>
            runFullCheck(outputChannel),
        ),
        vscode.commands.registerCommand("localizationCheck.scanFile", () =>
            scanCurrentFile(diagnostics),
        ),
    );

    // Register terminal and task interceptors
    registerInterceptors(context, diagnostics);

    // Initial scan of currently open documents
    scanAllOpenDocuments(diagnostics);

    // Document lifecycle event handlers
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => scanDocument(doc, diagnostics)),
        vscode.workspace.onDidSaveTextDocument(doc => scanDocument(doc, diagnostics)),
        vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri)),
    );

    // Debounced scan on document edits
    let debounceTimer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => scanDocument(event.document, diagnostics), 400);
        }),
    );

    // Git watchers
    watchStagedChanges(context, outputChannel);
    watchChangedFiles(context, () => scanAllOpenDocuments(diagnostics));
}

function deactivate() {}

module.exports = { activate, deactivate };

