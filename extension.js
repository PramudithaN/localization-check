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
    /^[a-z][a-zA-Z0-9]*(Id|ID|Code|No|Number|Type|Key)$/.test(value);

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

function findHardcodedRangesInLine(lineText) {
    const hits = [];

    let match;
    ATTRIBUTE_PATTERN.lastIndex = 0;
    while ((match = ATTRIBUTE_PATTERN.exec(lineText))) {
        const value = match[2];
        if (!ignoredValue(value) && !/^\s*t\s*\(/.test(value)) {
            hits.push({
                start: match.index,
                end: match.index + match[0].length,
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

// ---- diagnostics (live, per open file) ----

function scanDocument(document, diagnostics) {
    if (!RELEVANT_LANGUAGES.has(document.languageId)) return;

    const config = vscode.workspace.getConfiguration("localizationCheck");
    if (!config.get("liveScan", true)) {
        diagnostics.delete(document.uri);
        return;
    }

    const results = [];
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const hits = findHardcodedRangesInLine(line.text);
        hits.forEach(hit => {
            const range = new vscode.Range(i, hit.start, i, hit.end);
            const diagnostic = new vscode.Diagnostic(
                range,
                hit.message,
                vscode.DiagnosticSeverity.Warning,
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
}

function deactivate() {}

module.exports = { activate, deactivate };
