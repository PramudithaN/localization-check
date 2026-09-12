const vscode = require("vscode");
const { RELEVANT_LANGUAGES, CONFIG_SECTION, SOURCE_NAME } = require("./constants");
const { findHardcodedRangesInLine, findStandaloneJsxTextRange } = require("./detector");
const { isDocumentChanged } = require("./git");

/**
 * Returns the configured DiagnosticSeverity (Warning or Error).
 * @returns {vscode.DiagnosticSeverity}
 */
function getDiagnosticSeverity() {
    const configuredSeverity = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get("diagnosticSeverity", "error");

    return configuredSeverity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
}

/**
 * Scans a text document for hardcoded strings and updates the DiagnosticCollection.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").DiagnosticCollection} diagnostics
 */
function scanDocument(document, diagnostics) {
    if (!RELEVANT_LANGUAGES.has(document.languageId)) return;

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (!config.get("liveScan", true)) {
        diagnostics.delete(document.uri);
        return;
    }

    if (config.get("liveScanOnlyChangedFiles", true) && !isDocumentChanged(document)) {
        diagnostics.delete(document.uri);
        return;
    }

    const results = [];
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const hits = findHardcodedRangesInLine(line.text);
        const standaloneJsxTextHit = findStandaloneJsxTextRange(document, i);
        if (standaloneJsxTextHit) hits.push(standaloneJsxTextHit);

        hits.forEach(hit => {
            const range = new vscode.Range(i, hit.start, i, hit.end);
            const diagnostic = new vscode.Diagnostic(
                range,
                hit.message,
                getDiagnosticSeverity(),
            );
            diagnostic.source = SOURCE_NAME;
            results.push(diagnostic);
        });
    }

    diagnostics.set(document.uri, results);
}

/**
 * Scans all open text documents.
 * @param {import("vscode").DiagnosticCollection} diagnostics
 */
function scanAllOpenDocuments(diagnostics) {
    vscode.workspace.textDocuments.forEach(doc => scanDocument(doc, diagnostics));
}

module.exports = {
    getDiagnosticSeverity,
    scanDocument,
    scanAllOpenDocuments,
};
