const vscode = require("vscode");
const { RELEVANT_LANGUAGES, CONFIG_SECTION, SOURCE_NAME } = require("./constants");
const { findHardcodedHits, getCustomRules } = require("./detector");
const { isDocumentChanged } = require("./git");

const CONFIDENCE_LEVELS = {
    low: 1,
    medium: 2,
    high: 3,
};

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
 * Scans a text document for hardcoded strings using AST visitor and updates DiagnosticCollection.
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

    const rules = getCustomRules();
    const minConfidence = rules.minimumConfidence || "high";
    const minConfidenceRank = CONFIDENCE_LEVELS[minConfidence] || 3;

    const fullText = document.getText();
    const hits = findHardcodedHits(fullText, document.fileName, rules);

    const severity = getDiagnosticSeverity();
    const results = [];

    hits.forEach(hit => {
        const hitRank = CONFIDENCE_LEVELS[hit.confidence] || 1;
        if (hitRank < minConfidenceRank) {
            return;
        }

        const range = new vscode.Range(
            hit.startLine,
            hit.startCol,
            hit.endLine,
            hit.endCol,
        );

        const diagnostic = new vscode.Diagnostic(
            range,
            hit.message,
            severity,
        );
        diagnostic.source = SOURCE_NAME;
        diagnostic.code = hit.confidence; // e.g. "high", "medium", "low"
        results.push(diagnostic);
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
