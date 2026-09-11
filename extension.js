const vscode = require("vscode");
const path = require("path");
const { execFile } = require("child_process");

// ---- shared string-detection logic, mirrors scripts/check-localization.js ----

const ignoredValue = value =>
    !value ||
    value.length < 2 ||
    /^[A-Z0-9_./:-]+$/.test(value) ||
    /^https?:\/\//.test(value) ||
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^[{}$()[\]\\/_.:0-9-]+$/.test(value) ||
    /^[a-z][a-zA-Z0-9]*(Id|ID|Code|No|Number|Type|Key)$/.test(value) ||
    /\$\{/.test(value);

const ATTRIBUTE_PATTERN =
    /\b(label|title|placeholder|tooltip|aria-label|alt|description|helperText|buttonText)\s*=\s*["']([^"']+)["']/gi;
const TEXT_PATTERN = />\s*([A-Za-z][^<{]*?[A-Za-z0-9!?.,])\s*</g;
// Plain object-literal properties, e.g. `title: "Action"` in a column/config def
// (as opposed to a JSX attribute, which uses `=` and is covered above).
const OBJECT_PROPERTY_PATTERN =
    /\b(label|title|placeholder|tooltip|description|header|text|name|buttonText|helperText)\s*:\s*["']([^"']+)["']/gi;

const RELEVANT_LANGUAGES = new Set([
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
]);

function getDiagnosticSeverity() {
    const configuredSeverity = vscode.workspace
        .getConfiguration("localizationCheck")
        .get("diagnosticSeverity", "error");

    return configuredSeverity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
}

function sameFile(left, right) {
    return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}

function isDocumentChanged(document) {
    if (document.isDirty) return true;

    const gitAPI = getGitAPI();
    if (!gitAPI) return false;

    return gitAPI.repositories.some(repo => {
        const changes = [
            ...repo.state.workingTreeChanges,
            ...repo.state.indexChanges,
        ];

        return changes.some(change => sameFile(change.uri.fsPath, document.uri.fsPath));
    });
}

function findHardcodedRangesInLine(lineText) {
    const hits = [];

    let match;
    ATTRIBUTE_PATTERN.lastIndex = 0;
    while ((match = ATTRIBUTE_PATTERN.exec(lineText))) {
        const value = match[2];
        if (!ignoredValue(value) && !/^\s*t\s*\(/.test(value)) {
            const start = match.index + match[0].lastIndexOf(value);
            hits.push({
                start,
                end: start + value.length,
                message: `Hardcoded text in "${match[1]}" attribute: "${value}". Use t("...") instead.`,
            });
        }
    }

    TEXT_PATTERN.lastIndex = 0;
    while ((match = TEXT_PATTERN.exec(lineText))) {
        const value = match[1].trim();
        if (!ignoredValue(value)) {
            const start = match.index + match[0].indexOf(match[1]);
            hits.push({
                start,
                end: start + match[1].length,
                message: `Hardcoded JSX text: "${value}". Use t("...") instead.`,
            });
        }
    }

    OBJECT_PROPERTY_PATTERN.lastIndex = 0;
    while ((match = OBJECT_PROPERTY_PATTERN.exec(lineText))) {
        const value = match[2];
        if (!ignoredValue(value)) {
            const start = match.index + match[0].lastIndexOf(match[2]);
            hits.push({
                start,
                end: start + value.length,
                message: `Hardcoded value for "${match[1]}": "${value}". Use t("...") instead.`,
            });
        }
    }

    return hits;
}

function getNearestNonEmptyLine(document, lineNumber, direction) {
    for (let i = lineNumber + direction; i >= 0 && i < document.lineCount; i += direction) {
        const text = document.lineAt(i).text.trim();
        if (text) return text;
    }

    return "";
}

function isJsxBoundary(text) {
    return /[>}\)]\s*$/.test(text) || /^<\/?[A-Za-z][\w.-]*(\s|>|$)/.test(text) || /^\{/.test(text);
}

function isInsideJsxOpeningTag(document, lineNumber) {
    for (let i = lineNumber - 1; i >= 0; i--) {
        const text = document.lineAt(i).text.trim();
        if (!text) continue;
        if (/^\/?>$/.test(text)) return false;
        if (/^<\/[A-Za-z][\w.-]*/.test(text)) return false;
        if (/^<[A-Za-z][\w.-]*(\s|$)/.test(text)) return true;
    }

    return false;
}

function findStandaloneJsxTextRange(document, lineNumber) {
    const lineText = document.lineAt(lineNumber).text;
    const value = lineText.trim();

    if (
        !value ||
        !/[A-Za-z]/.test(value) ||
        ignoredValue(value) ||
        /^[a-z][A-Za-z0-9]*$/.test(value) && /[A-Z]/.test(value) ||
        /[<>{};=]/.test(value) ||
        /^(import|export|const|let|var|return|if|for|while|switch|case|function|class)\b/.test(value)
    ) {
        return null;
    }

    if (isInsideJsxOpeningTag(document, lineNumber)) return null;

    const previous = getNearestNonEmptyLine(document, lineNumber, -1);
    const next = getNearestNonEmptyLine(document, lineNumber, 1);
    if (!isJsxBoundary(previous) || !isJsxBoundary(next)) return null;

    const start = lineText.indexOf(value);
    return {
        start,
        end: start + value.length,
        message: `Hardcoded JSX text: "${value}". Use t("...") instead.`,
    };
}

// ---- diagnostics (live, per open file) ----

function scanDocument(document, diagnostics) {
    if (!RELEVANT_LANGUAGES.has(document.languageId)) return;

    const config = vscode.workspace.getConfiguration("localizationCheck");
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
            diagnostic.source = "localization-check";
            results.push(diagnostic);
        });
    }

    diagnostics.set(document.uri, results);
}

// ---- command: run the real git-staged check-localization.js script ----

function runFullCheck(outputChannel) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("Localization Check: no workspace folder is open.");
        return;
    }

    const root = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration("localizationCheck");
    const scriptRelPath = config.get("scriptPath", "scripts/check-localization.js");
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

// ---- automatic warning when staged changes contain problems ----

function getGitAPI() {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) return null;
    const exports = gitExtension.isActive ? gitExtension.exports : null;
    return exports ? exports.getAPI(1) : null;
}

function runCheckSilently(root, scriptPath) {
    return new Promise(resolve => {
        execFile(
            "node",
            [scriptPath],
            { cwd: root, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
                resolve({ failed: Boolean(error), output: `${stdout}\n${stderr}`.trim() });
            },
        );
    });
}

function watchStagedChanges(context, outputChannel) {
    const gitAPI = getGitAPI();
    if (!gitAPI) return;

    // Tracks whether the *last* check for a given repo failed, so we only
    // pop a notification on the transition into a failing state (not on
    // every keystroke/staging change while it's already failing).
    const lastFailedByRepo = new Map();
    const timers = new Map();

    function checkRepo(repo) {
        const config = vscode.workspace.getConfiguration("localizationCheck");
        if (!config.get("warnOnStage", true)) return;

        const hasStaged = repo.state.indexChanges.length > 0;
        if (!hasStaged) {
            lastFailedByRepo.set(repo.rootUri.fsPath, false);
            return;
        }

        const root = repo.rootUri.fsPath;
        const scriptRelPath = config.get("scriptPath", "scripts/check-localization.js");
        const scriptPath = path.join(root, scriptRelPath);

        runCheckSilently(root, scriptPath).then(({ failed, output }) => {
            const wasFailed = lastFailedByRepo.get(root) === true;
            lastFailedByRepo.set(root, failed);

            if (failed && !wasFailed) {
                vscode.window
                    .showWarningMessage(
                        "Staged changes include hardcoded text that hasn't been localized.",
                        "Show Details",
                    )
                    .then(choice => {
                        if (choice === "Show Details") {
                            outputChannel.clear();
                            outputChannel.appendLine(output);
                            outputChannel.show(true);
                        }
                    });
            }
        });
    }

    function attachRepo(repo) {
        checkRepo(repo);
        context.subscriptions.push(
            repo.state.onDidChange(() => {
                const key = repo.rootUri.fsPath;
                clearTimeout(timers.get(key));
                timers.set(
                    key,
                    setTimeout(() => checkRepo(repo), 600),
                );
            }),
        );
    }

    gitAPI.repositories.forEach(attachRepo);
    context.subscriptions.push(gitAPI.onDidOpenRepository(attachRepo));
}

function watchChangedFiles(context, diagnostics) {
    const gitAPI = getGitAPI();
    if (!gitAPI) return;

    const timers = new Map();

    function scanOpenDocuments() {
        vscode.workspace.textDocuments.forEach(doc => scanDocument(doc, diagnostics));
    }

    function attachRepo(repo) {
        context.subscriptions.push(
            repo.state.onDidChange(() => {
                const key = repo.rootUri.fsPath;
                clearTimeout(timers.get(key));
                timers.set(key, setTimeout(scanOpenDocuments, 600));
            }),
        );
    }

    gitAPI.repositories.forEach(attachRepo);
    context.subscriptions.push(gitAPI.onDidOpenRepository(attachRepo));
}

// ---- activation ----

function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("Localization Check");
    const diagnostics = vscode.languages.createDiagnosticCollection("localization-check");
    context.subscriptions.push(outputChannel, diagnostics);

    context.subscriptions.push(
        vscode.commands.registerCommand("localizationCheck.run", () =>
            runFullCheck(outputChannel),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("localizationCheck.scanFile", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) scanDocument(editor.document, diagnostics);
        }),
    );

    // Scan already-open documents on activation.
    vscode.workspace.textDocuments.forEach(doc => scanDocument(doc, diagnostics));

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => scanDocument(doc, diagnostics)),
    );
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => scanDocument(doc, diagnostics)),
    );

    // Debounce on-change scanning so it isn't running on every keystroke.
    let debounceTimer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => scanDocument(event.document, diagnostics), 400);
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri)),
    );

    watchStagedChanges(context, outputChannel);
    watchChangedFiles(context, diagnostics);
}

function deactivate() {}

module.exports = { activate, deactivate };
