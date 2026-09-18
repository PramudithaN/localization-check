const vscode = require("vscode");
const { SOURCE_NAME, CONFIG_SECTION } = require("./constants");

/**
 * Provides Quick Fix CodeActions for detected hardcoded string diagnostics.
 */
class LocalizationCodeActionProvider {
    /**
     * @param {import("vscode").DiagnosticCollection} diagnosticCollection
     */
    constructor(diagnosticCollection) {
        this.diagnosticCollection = diagnosticCollection;
    }

    /**
     * @param {import("vscode").TextDocument} document
     * @param {import("vscode").Range | import("vscode").Selection} range
     * @param {import("vscode").CodeActionContext} context
     * @returns {import("vscode").CodeAction[]}
     */
    provideCodeActions(document, range, context) {
        const diagnostics = context.diagnostics.filter(d => d.source === SOURCE_NAME);
        if (!diagnostics || diagnostics.length === 0) return [];

        const actions = [];

        // Individual quick fixes
        diagnostics.forEach(diagnostic => {
            const action = new vscode.CodeAction(
                "Add localization with Copilot",
                vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.command = {
                command: "localizationCheck.localizeWithCopilot",
                title: "Add localization with Copilot",
                arguments: [document.uri, diagnostic.range],
            };
            actions.push(action);

            const ignoreAction = new vscode.CodeAction(
                "Mark / Ignore as False Positive",
                vscode.CodeActionKind.QuickFix,
            );
            ignoreAction.diagnostics = [diagnostic];
            ignoreAction.command = {
                command: "localizationCheck.markFalsePositive",
                title: "Mark as False Positive",
                arguments: [document.uri, diagnostic.range],
            };
            actions.push(ignoreAction);

            const flagAction = new vscode.CodeAction(
                "Flag Pattern as Hardcoded Rule",
                vscode.CodeActionKind.QuickFix,
            );
            flagAction.diagnostics = [diagnostic];
            flagAction.command = {
                command: "localizationCheck.flagHardcoded",
                title: "Flag as Hardcoded Rule",
                arguments: [document.uri, diagnostic.range],
            };
            actions.push(flagAction);
        });

        // Batch fix for the whole document if there are multiple occurrences
        const allDocDiagnostics = (this.diagnosticCollection.get(document.uri) || []).filter(
            d => d.source === SOURCE_NAME,
        );

        if (allDocDiagnostics.length > 1) {
            const batchAction = new vscode.CodeAction(
                `Localize ALL hardcoded strings in file with Copilot (${allDocDiagnostics.length} items)`,
                vscode.CodeActionKind.QuickFix,
            );
            batchAction.diagnostics = diagnostics;
            batchAction.command = {
                command: "localizationCheck.localizeAllInFile",
                title: "Localize All in File with Copilot",
                arguments: [document.uri],
            };
            actions.push(batchAction);
        }

        return actions;
    }
}

/**
 * Provides CodeLens buttons above hardcoded strings.
 */
class LocalizationCodeLensProvider {
    /**
     * @param {import("vscode").DiagnosticCollection} diagnosticCollection
     */
    constructor(diagnosticCollection) {
        this.diagnosticCollection = diagnosticCollection;
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }

    refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * @param {import("vscode").TextDocument} document
     * @returns {import("vscode").CodeLens[]}
     */
    provideCodeLenses(document) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        if (!config.get("enableCodeLens", true)) {
            return [];
        }

        const diagnostics = this.diagnosticCollection.get(document.uri);
        if (!diagnostics || diagnostics.length === 0) {
            return [];
        }

        const codeLenses = [];
        diagnostics.forEach(diagnostic => {
            if (diagnostic.source === SOURCE_NAME) {
                const codeLens = new vscode.CodeLens(diagnostic.range, {
                    title: "$(sparkle) Add localization with Copilot",
                    tooltip: "Use GitHub Copilot to extract and replace this hardcoded string with localized code",
                    command: "localizationCheck.localizeWithCopilot",
                    arguments: [document.uri, diagnostic.range],
                });
                codeLenses.push(codeLens);
            }
        });

        return codeLenses;
    }
}

module.exports = {
    LocalizationCodeActionProvider,
    LocalizationCodeLensProvider,
};