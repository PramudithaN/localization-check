const vscode = require("vscode");
const { RELEVANT_LANGUAGES, CONFIG_SECTION, SOURCE_NAME } = require("./constants");
const {
    findHardcodedRangesInLine,
    findStandaloneJsxTextRange,
    findNotificationHits,
    findMultilineHardcodedHits,
} = require("./detector");
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
 * @param {boolean} [force]
 */
function scanDocument(document, diagnostics, force = false) {
    if (!RELEVANT_LANGUAGES.has(document.languageId)) return;

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (!config.get("liveScan", true)) {
        diagnostics.delete(document.uri);
        return;
    }

    if (!force && config.get("liveScanOnlyChangedFiles", true) && !isDocumentChanged(document)) {
        diagnostics.delete(document.uri);
        return;
    }

    const results = [];
    const severity = getDiagnosticSeverity();

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
                severity,
            );
            diagnostic.source = SOURCE_NAME;
            results.push(diagnostic);
        });
    }

    const fullText = document.getText();

    // Multiline properties and attributes (e.g. label:\n "...", description:\n "...")
    const multilineHits = findMultilineHardcodedHits(fullText);
    multilineHits.forEach(hit => {
        const startPos = document.positionAt(hit.startOffset);
        const endPos = document.positionAt(hit.endOffset);
        const range = new vscode.Range(startPos, endPos);
        const alreadyExists = results.some(
            d => d.range.start.line === range.start.line && d.range.start.character === range.start.character,
        );
        if (!alreadyExists) {
            const diagnostic = new vscode.Diagnostic(
                range,
                hit.message,
                severity,
            );
            diagnostic.source = SOURCE_NAME;
            results.push(diagnostic);
        }
    });

    // Multiline and single-line notification function checks across the document
    const notificationHits = findNotificationHits(fullText);
    notificationHits.forEach(hit => {
        const startPos = document.positionAt(hit.startOffset);
        const endPos = document.positionAt(hit.endOffset);
        const range = new vscode.Range(startPos, endPos);
        const alreadyExists = results.some(
            d => d.range.start.line === range.start.line && d.range.start.character === range.start.character,
        );
        if (!alreadyExists) {
            const diagnostic = new vscode.Diagnostic(
                range,
                hit.message,
                severity,
            );
            diagnostic.source = SOURCE_NAME;
            results.push(diagnostic);
        }
    });

    diagnostics.set(document.uri, results);
}

/**
 * Scans all open text documents.
 * @param {import("vscode").DiagnosticCollection} diagnostics
 * @param {boolean} [force]
 */
function scanAllOpenDocuments(diagnostics, force = false) {
    vscode.workspace.textDocuments.forEach(doc => scanDocument(doc, diagnostics, force));
}

module.exports = {
    getDiagnosticSeverity,
    scanDocument,
    scanAllOpenDocuments,
};

