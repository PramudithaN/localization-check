const vscode = require("vscode");
const path = require("path");
const { execFile } = require("child_process");
const { CONFIG_SECTION, DEFAULT_SCRIPT_PATH } = require("./constants");

/**
 * Retrieves the Git extension API if available.
 * @param {import("vscode").OutputChannel} [outputChannel]
 * @returns {any | null}
 */
function getGitAPI(outputChannel = null) {
    try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
            if (outputChannel) outputChannel.appendLine("[debug] vscode.git extension not available.");
            return null;
        }
        const exports = gitExtension.isActive ? gitExtension.exports : null;
        return exports ? exports.getAPI(1) : null;
    } catch (err) {
        if (outputChannel) outputChannel.appendLine(`[debug] Error accessing Git API: ${err && err.message}`);
        return null;
    }
}

/**
 * Normalizes and compares two file paths case-insensitively.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function sameFile(left, right) {
    return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}

/**
 * Determines whether a text document has unsaved or git-staged/working-tree changes.
 * @param {import("vscode").TextDocument} document
 * @returns {boolean}
 */
function isDocumentChanged(document) {
    if (document.isDirty) return true;

    const gitAPI = getGitAPI();
    if (!gitAPI || !Array.isArray(gitAPI.repositories) || gitAPI.repositories.length === 0) {
        return true;
    }

    const docPath = document.uri ? document.uri.fsPath : "";
    if (!docPath) return true;

    return gitAPI.repositories.some(repo => {
        if (!repo || !repo.state) return false;

        const changes = [
            ...(repo.state.workingTreeChanges || []),
            ...(repo.state.indexChanges || []),
            ...(repo.state.untrackedChanges || []),
            ...(repo.state.mergeChanges || []),
        ];

        return changes.some(change => change && change.uri && sameFile(change.uri.fsPath, docPath));
    });
}

/**
 * Runs the check-localization script silently to test staged changes.
 * @param {string} root
 * @param {string} scriptPath
 * @returns {Promise<{ failed: boolean, output: string }>}
 */
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

/**
 * Monitors Git staged changes and displays a warning when unlocalized strings are detected.
 * @param {import("vscode").ExtensionContext} context
 * @param {import("vscode").OutputChannel} outputChannel
 */
function watchStagedChanges(context, outputChannel) {
    const gitAPI = getGitAPI();
    if (!gitAPI) return;

    // Tracks whether the last check for a given repo failed, so notification
    // only pops on the transition into a failing state.
    const lastFailedByRepo = new Map();
    const timers = new Map();

    function checkRepo(repo) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        if (!config.get("warnOnStage", true)) return;

        const hasStaged = repo.state.indexChanges.length > 0;
        if (!hasStaged) {
            lastFailedByRepo.set(repo.rootUri.fsPath, false);
            return;
        }

        const root = repo.rootUri.fsPath;
        const scriptRelPath = config.get("scriptPath", DEFAULT_SCRIPT_PATH);
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

/**
 * Watches git repository status changes to re-trigger document diagnostics.
 * @param {import("vscode").ExtensionContext} context
 * @param {() => void} onRepoChange
 */
function watchChangedFiles(context, onRepoChange) {
    const gitAPI = getGitAPI();
    if (!gitAPI) return;

    const timers = new Map();

    function attachRepo(repo) {
        context.subscriptions.push(
            repo.state.onDidChange(() => {
                const key = repo.rootUri.fsPath;
                clearTimeout(timers.get(key));
                timers.set(key, setTimeout(onRepoChange, 600));
            }),
        );
    }

    gitAPI.repositories.forEach(attachRepo);
    context.subscriptions.push(gitAPI.onDidOpenRepository(attachRepo));
}

module.exports = {
    getGitAPI,
    sameFile,
    isDocumentChanged,
    runCheckSilently,
    watchStagedChanges,
    watchChangedFiles,
};
