const vscode = require("vscode");
const { CONFIG_SECTION } = require("./constants");
const { hasLocalizationErrors, scanAllOpenDocuments } = require("./diagnostics");

// Matches commands starting dev/build processes (e.g. yarn start, npm run dev, npm start, pnpm build, vite, etc.)
const BLOCKED_COMMAND_REGEX =
    /\b(yarn|npm|pnpm|bun)\s+(run\s+)?(start|dev|build|serve|compile)\b|\b(tsc|vite|webpack|next\s+(dev|build))\b/i;

/**
 * Checks whether a given terminal command line represents a build, start, or dev command.
 * @param {string} commandLine
 * @returns {boolean}
 */
function isBlockedCommandLine(commandLine) {
    if (!commandLine || typeof commandLine !== "string") return false;
    return BLOCKED_COMMAND_REGEX.test(commandLine.trim());
}

/**
 * Checks whether a VS Code task represents a build, start, or dev task.
 * @param {import("vscode").Task} task
 * @returns {boolean}
 */
function isBlockedTask(task) {
    if (!task) return false;
    if (task.group === vscode.TaskGroup.Build || task.group === vscode.TaskGroup.Rebuild) {
        return true;
    }
    const name = (task.name || "").toLowerCase();
    const detail = (task.detail || "").toLowerCase();
    return (
        /\b(build|start|dev|compile|serve)\b/i.test(name) ||
        /\b(build|start|dev|compile|serve)\b/i.test(detail)
    );
}

/**
 * Prompts the user with an error notification and an action to open the Problems panel.
 * @param {string} message
 */
function notifyBlockedAction(message) {
    vscode.window.showErrorMessage(message, "Show Problems").then(choice => {
        if (choice === "Show Problems") {
            vscode.commands.executeCommand("workbench.actions.view.problems");
        }
    });
}

/**
 * Registers listeners to intercept terminal executions, VS Code tasks, and debug sessions.
 * @param {import("vscode").ExtensionContext} context
 * @param {import("vscode").DiagnosticCollection} diagnostics
 */
function registerInterceptors(context, diagnostics) {
    // 1. Terminal Shell Execution Interceptor (VS Code 1.84+)
    if (typeof vscode.window.onDidStartTerminalShellExecution === "function") {
        context.subscriptions.push(
            vscode.window.onDidStartTerminalShellExecution(event => {
                const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
                if (!config.get("blockTerminalCommands", true)) return;

                const commandLine = event.commandLine ? event.commandLine.value : "";
                if (!isBlockedCommandLine(commandLine)) return;

                // Ensure latest diagnostics are collected
                scanAllOpenDocuments(diagnostics);

                if (hasLocalizationErrors(diagnostics)) {
                    // Send interrupt signal (Ctrl+C) to stop the terminal command
                    event.terminal.sendText("\x03", true);

                    notifyBlockedAction(
                        `Execution of "${commandLine.trim()}" was stopped: Hardcoded unlocalized strings detected in changed files.`,
                    );
                }
            }),
        );
    }

    // 2. VS Code Task Execution Interceptor (Ctrl+Shift+B / Run Task)
    if (vscode.tasks && typeof vscode.tasks.onDidStartTask === "function") {
        context.subscriptions.push(
            vscode.tasks.onDidStartTask(event => {
                const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
                if (!config.get("blockBuildTasks", true)) return;

                const task = event.execution ? event.execution.task : null;
                if (!isBlockedTask(task)) return;

                scanAllOpenDocuments(diagnostics);

                if (hasLocalizationErrors(diagnostics)) {
                    event.execution.terminate();
                    notifyBlockedAction(
                        `Task "${task ? task.name : "Build"}" was cancelled: Hardcoded unlocalized strings detected in changed files.`,
                    );
                }
            }),
        );
    }

    // 3. Debug / Launch Interceptor (F5 / Run & Debug)
    if (vscode.debug && typeof vscode.debug.registerDebugConfigurationProvider === "function") {
        context.subscriptions.push(
            vscode.debug.registerDebugConfigurationProvider("*", {
                resolveDebugConfiguration(_folder, config) {
                    const lcConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
                    if (!lcConfig.get("blockBuildTasks", true)) return config;

                    scanAllOpenDocuments(diagnostics);

                    if (hasLocalizationErrors(diagnostics)) {
                        notifyBlockedAction(
                            "Launch / Debug aborted: Hardcoded unlocalized strings detected in changed files.",
                        );
                        return undefined; // Cancels debug session
                    }

                    return config;
                },
            }),
        );
    }
}

module.exports = {
    isBlockedCommandLine,
    isBlockedTask,
    registerInterceptors,
};
