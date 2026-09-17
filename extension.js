const vscode = require("vscode");
const { SOURCE_NAME, RELEVANT_LANGUAGES } = require("./src/constants");
const { scanDocument, scanAllOpenDocuments } = require("./src/diagnostics");
const { runFullCheck, scanCurrentFile, handleLocalizeWithCopilot, handleLocalizeAllInFile } = require("./src/commands");
const { LocalizationCodeActionProvider, LocalizationCodeLensProvider } = require("./src/providers");
const { watchStagedChanges, watchChangedFiles } = require("./src/git");

/**
 * Activates the Localization Check extension.
 * @param {import("vscode").ExtensionContext} context
 */
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("Localization Check");
    const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE_NAME);
    const codeLensProvider = new LocalizationCodeLensProvider(diagnostics);

    context.subscriptions.push(outputChannel, diagnostics);

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand("localizationCheck.run", () =>
            runFullCheck(outputChannel),
        ),
        vscode.commands.registerCommand("localizationCheck.scanFile", () =>
            scanCurrentFile(diagnostics),
        ),
        vscode.commands.registerCommand(
            "localizationCheck.localizeWithCopilot",
            (doc, range) => handleLocalizeWithCopilot(doc, range),
        ),
        vscode.commands.registerCommand(
            "localizationCheck.localizeAllInFile",
            doc => handleLocalizeAllInFile(diagnostics, doc),
        ),
    );

    // Register CodeAction and CodeLens providers for supported languages
    const languageSelectors = Array.from(RELEVANT_LANGUAGES).map(lang => ({ language: lang }));

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            languageSelectors,
            new LocalizationCodeActionProvider(diagnostics),
            {
                providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
            },
        ),
        vscode.languages.registerCodeLensProvider(
            languageSelectors,
            codeLensProvider,
        ),
    );

    // Initial scan of currently open documents
    scanAllOpenDocuments(diagnostics);

    // Document lifecycle event handlers
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            scanDocument(doc, diagnostics);
            codeLensProvider.refresh();
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            scanDocument(doc, diagnostics);
            codeLensProvider.refresh();
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnostics.delete(doc.uri);
            codeLensProvider.refresh();
        }),
    );

    // Debounced scan on document edits
    let debounceTimer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                scanDocument(event.document, diagnostics);
                codeLensProvider.refresh();
            }, 400);
        }),
    );

    // Git watchers
    watchStagedChanges(context, outputChannel);
    watchChangedFiles(context, () => {
        scanAllOpenDocuments(diagnostics);
        codeLensProvider.refresh();
    });
}

function deactivate() {}

module.exports = { activate, deactivate };

