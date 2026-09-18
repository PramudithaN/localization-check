const vscode = require("vscode");
const https = require("https");
const {
    CONFIG_SECTION,
    DEFAULT_GITHUB_REPO,
    SOURCE_NAME,
} = require("./constants");
const { parseSource, inspectCodeContextAtPosition } = require("./ast");
const { scanAllOpenDocuments, scanDocument } = require("./diagnostics");

/**
 * Creates a GitHub issue via the GitHub REST API using the user's authentication token.
 * @param {string} repo - "owner/repo"
 * @param {string} token - GitHub OAuth/PAT token
 * @param {string} title
 * @param {string} body
 * @param {string[]} labels
 * @returns {Promise<{ number: number, html_url: string }>}
 */
function createGitHubIssueViaApi(repo, token, title, body, labels = []) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            title,
            body,
            labels,
        });

        const [owner, repoName] = repo.split("/");
        if (!owner || !repoName) {
            return reject(new Error(`Invalid repository format: "${repo}". Expected "owner/repo".`));
        }

        const options = {
            hostname: "api.github.com",
            path: `/repos/${owner}/${repoName}/issues`,
            method: "POST",
            headers: {
                "User-Agent": "VSCode-Localization-Check-Extension",
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
            timeout: 10000,
        };

        const req = https.request(options, res => {
            let data = "";
            res.on("data", chunk => {
                data += chunk;
            });
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({
                            number: parsed.number,
                            html_url: parsed.html_url,
                        });
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(
                        new Error(
                            `GitHub API error (${res.statusCode}): ${data || res.statusMessage}`,
                        ),
                    );
                }
            });
        });

        req.on("timeout", () => {
            req.destroy();
            reject(new Error("GitHub API request timed out."));
        });

        req.on("error", err => {
            reject(err);
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Creates a pre-filled web URL to open a GitHub issue in the browser as a fallback.
 * @param {string} repo
 * @param {string} title
 * @param {string} body
 * @param {string[]} labels
 * @returns {vscode.Uri}
 */
function getPrefilledIssueUrl(repo, title, body, labels = []) {
    const query = new URLSearchParams({
        title,
        body,
        labels: labels.join(","),
    });
    return vscode.Uri.parse(`https://github.com/${repo}/issues/new?${query.toString()}`);
}

/**
 * Appends a unique item to an array setting in VS Code configuration.
 * @param {string} settingKey
 * @param {string} newItem
 * @returns {Promise<boolean>}
 */
async function appendToConfigArray(settingKey, newItem) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const current = config.get(settingKey, []);
    const list = Array.isArray(current) ? [...current] : [];

    const cleanItem = newItem.trim();
    if (!cleanItem) return false;

    if (!list.some(item => item.toLowerCase() === cleanItem.toLowerCase())) {
        list.push(cleanItem);
        const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;

        try {
            await config.update(settingKey, list, target);
            return true;
        } catch (err) {
            // If VS Code schema is not refreshed yet, try updating globally or notify user
            try {
                await config.update(settingKey, list, vscode.ConfigurationTarget.Global);
                return true;
            } catch {
                // Ignore schema registration error if setting was written
            }
        }
    }

    return false;
}

/**
 * Inspects the cursor position or selection in a document to find potential candidates.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").Range | import("vscode").Selection | import("vscode").Position} rangeOrPos
 * @param {import("vscode").DiagnosticCollection} [diagnostics]
 * @returns {{
 *   tag: string | null,
 *   attribute: string | null,
 *   property: string | null,
 *   selectedText: string | null,
 *   lineText: string
 * }}
 */
function inspectCodeContext(document, rangeOrPos, diagnostics) {
    const pos = rangeOrPos instanceof vscode.Position
        ? rangeOrPos
        : (rangeOrPos ? rangeOrPos.start : new vscode.Position(0, 0));

    const lineText = document.lineAt(pos.line).text;
    let selectedText = (rangeOrPos instanceof vscode.Range && !rangeOrPos.isEmpty)
        ? document.getText(rangeOrPos).trim()
        : "";

    // If selection is empty, check for a string under cursor
    if (!selectedText) {
        const quoteRegex = /(["'`])([^"'`]+)\1/g;
        let qm;
        while ((qm = quoteRegex.exec(lineText))) {
            const start = qm.index;
            const end = start + qm[0].length;
            if (pos.character >= start && pos.character <= end) {
                selectedText = qm[2].trim();
                break;
            }
        }
    }

    // Check if a diagnostic on current line has detected text
    if (!selectedText && diagnostics) {
        const docDiags = (diagnostics.get(document.uri) || []).filter(
            d => d.source === SOURCE_NAME,
        );
        const matchingDiag = docDiags.find(d => d.range.contains(pos)) ||
            docDiags.find(d => d.range.start.line === pos.line);
        if (matchingDiag) {
            const rawDiagText = document.getText(matchingDiag.range).trim();
            selectedText = rawDiagText.replace(/^["'`]|["'`]$/g, "").trim();
        }
    }

    // Inspect JSX Tag, Attribute, and Property using AST parser when available
    let tag = null;
    let attribute = null;
    let property = null;

    const { ast } = parseSource(document.getText(), document.fileName);
    if (ast) {
        const astContext = inspectCodeContextAtPosition(ast, pos.line, pos.character);
        if (astContext.tag) tag = astContext.tag;
        if (astContext.attribute) attribute = astContext.attribute;
        if (astContext.property) property = astContext.property;
        if (astContext.selectedText && !selectedText) selectedText = astContext.selectedText;
    }

    if (!tag) {
        const tagMatch = lineText.match(/<\/?([A-Za-z][\w.-]*)/);
        if (tagMatch) {
            tag = tagMatch[1];
        } else {
            // Look up previous lines for unclosed tag
            for (let i = pos.line - 1; i >= Math.max(0, pos.line - 15); i--) {
                const prevText = document.lineAt(i).text.trim();
                const prevTagMatch = prevText.match(/<([A-Za-z][\w.-]*)/);
                if (prevTagMatch) {
                    tag = prevTagMatch[1];
                    break;
                }
            }
        }
    }

    if (!attribute) {
        const attrMatch = lineText.match(/\b([a-zA-Z0-9_-]+)\s*=\s*(["'])([^"']*)\2/);
        if (attrMatch) {
            attribute = attrMatch[1];
        }
    }

    if (!property) {
        const propMatch = lineText.match(/\b([a-zA-Z0-9_$]+)\s*:\s*(["'`])([^"'`]*)\2/);
        if (propMatch) {
            property = propMatch[1];
        }
    }

    return {
        tag,
        attribute,
        property,
        selectedText: selectedText || null,
        lineText: lineText.trim(),
    };
}

/**
 * Handles the "Flag as Hardcoded" command: allows user to select rule type,
 * saves it to settings, and creates a GitHub issue in the background.
 * @param {import("vscode").DiagnosticCollection} diagnostics
 * @param {import("vscode").TextDocument} [doc]
 * @param {import("vscode").Range | import("vscode").Selection} [range]
 */
async function handleFlagAsHardcoded(diagnostics, doc, range) {
    const editor = vscode.window.activeTextEditor;
    const document = doc || (editor ? editor.document : null);
    if (!document) {
        vscode.window.showWarningMessage("Localization Check: No active editor found.");
        return;
    }

    const targetRange = range || (editor ? editor.selection : new vscode.Range(0, 0, 0, 0));
    const contextInfo = inspectCodeContext(document, targetRange, diagnostics);

    const options = [];

    if (contextInfo.selectedText) {
        options.push({
            label: `$(tag) Flag Exact Text / String: "${contextInfo.selectedText}"`,
            description: `Flag occurrences of "${contextInfo.selectedText}" as hardcoded across your project`,
            type: "customWords",
            value: contextInfo.selectedText,
            typeName: "Exact String / Word",
        });
    }

    if (contextInfo.tag) {
        options.push({
            label: `$(tag) Flag Tag: <${contextInfo.tag}>`,
            description: `Flag all text inside <${contextInfo.tag}> elements as hardcoded`,
            type: "customTags",
            value: contextInfo.tag,
            typeName: "JSX/HTML Tag",
        });
    }

    if (contextInfo.attribute) {
        options.push({
            label: `$(tag) Flag Attribute: ${contextInfo.attribute}="..."`,
            description: `Flag all string values in ${contextInfo.attribute} attributes`,
            type: "customAttributes",
            value: contextInfo.attribute,
            typeName: "Attribute",
        });
    }

    if (contextInfo.property) {
        options.push({
            label: `$(tag) Flag Property: ${contextInfo.property}: "..."`,
            description: `Flag all string values in ${contextInfo.property} object properties`,
            type: "customProperties",
            value: contextInfo.property,
            typeName: "Object Property",
        });
    }

    options.push({
        label: "$(edit) Custom Identifier...",
        description: "Enter a custom attribute, tag, or property name to flag",
        type: "custom",
        value: null,
        typeName: "Custom",
    });

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: "Select which pattern to flag as hardcoded text across your project:",
    });

    if (!selected) return;

    let targetSetting = selected.type;
    let targetValue = selected.value;
    let typeName = selected.typeName;

    if (targetSetting === "custom") {
        const inputType = await vscode.window.showQuickPick(
            [
                { label: "Exact Word / String", value: "customWords" },
                { label: "Attribute", value: "customAttributes" },
                { label: "JSX/HTML Tag", value: "customTags" },
                { label: "Object Property", value: "customProperties" },
            ],
            { placeHolder: "Select rule type" },
        );
        if (!inputType) return;

        const input = await vscode.window.showInputBox({
            prompt: `Enter ${inputType.label} name to flag as hardcoded`,
            placeHolder: inputType.value === "customTags" ? "Typography" : "customTitle",
        });
        if (!input || !input.trim()) return;

        targetSetting = inputType.value;
        targetValue = input.trim();
        typeName = inputType.label;
    }

    // 1. Save rule to settings
    await appendToConfigArray(targetSetting, targetValue);

    // 2. Immediately force re-scan the active document and all open documents
    scanDocument(document, diagnostics, true);
    scanAllOpenDocuments(diagnostics, true);

    vscode.window.showInformationMessage(
        `$(check) Flagged "${targetValue}" as hardcoded (${typeName}). Re-scanned files!`,
    );

    // 3. Create GitHub issue in background asynchronously (non-blocking)
    submitRuleToGitHub({
        actionType: "flag-hardcoded",
        typeName,
        identifier: targetValue,
        snippet: contextInfo.lineText,
        languageId: document.languageId,
    }).catch(() => {});
}

/**
 * Handles the "Mark as False Positive" command: allows user to ignore a word,
 * attribute, or property, saves it to settings, and creates a GitHub issue in the background.
 * @param {import("vscode").DiagnosticCollection} diagnostics
 * @param {import("vscode").TextDocument} [doc]
 * @param {import("vscode").Range | import("vscode").Selection} [range]
 */
async function handleMarkAsFalsePositive(diagnostics, doc, range) {
    const editor = vscode.window.activeTextEditor;
    const document = doc || (editor ? editor.document : null);
    if (!document) {
        vscode.window.showWarningMessage("Localization Check: No active editor found.");
        return;
    }

    const targetRange = range || (editor ? editor.selection : new vscode.Range(0, 0, 0, 0));
    const contextInfo = inspectCodeContext(document, targetRange, diagnostics);

    const options = [];

    if (contextInfo.selectedText) {
        options.push({
            label: `$(shield) Ignore Exact String: "${contextInfo.selectedText}"`,
            description: "Never flag this specific word/phrase again",
            type: "ignoredWords",
            value: contextInfo.selectedText,
            typeName: "Ignored Word/Phrase",
        });
    }

    if (contextInfo.attribute) {
        options.push({
            label: `$(shield) Ignore Attribute: ${contextInfo.attribute}="..."`,
            description: `Ignore all values inside ${contextInfo.attribute} attributes`,
            type: "ignoredAttributes",
            value: contextInfo.attribute,
            typeName: "Ignored Attribute",
        });
    }

    if (contextInfo.property) {
        options.push({
            label: `$(shield) Ignore Object Property: ${contextInfo.property}: "..."`,
            description: `Ignore all values in ${contextInfo.property} object properties`,
            type: "ignoredProperties",
            value: contextInfo.property,
            typeName: "Ignored Property",
        });
    }

    if (contextInfo.tag) {
        options.push({
            label: `$(shield) Ignore Tag: <${contextInfo.tag}>`,
            description: `Ignore text inside <${contextInfo.tag}> elements`,
            type: "ignoredTags",
            value: contextInfo.tag,
            typeName: "Ignored Tag",
        });
    }

    options.push({
        label: "$(edit) Custom Word or Identifier to Ignore...",
        description: "Enter a custom word, attribute, or property to ignore",
        type: "custom",
        value: null,
        typeName: "Custom",
    });

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: "Select what to ignore as false positive:",
    });

    if (!selected) return;

    let targetSetting = selected.type;
    let targetValue = selected.value;
    let typeName = selected.typeName;

    if (targetSetting === "custom") {
        const inputType = await vscode.window.showQuickPick(
            [
                { label: "Word / Exact String", value: "ignoredWords" },
                { label: "Attribute", value: "ignoredAttributes" },
                { label: "Object Property", value: "ignoredProperties" },
                { label: "JSX/HTML Tag", value: "ignoredTags" },
            ],
            { placeHolder: "Select type to ignore" },
        );
        if (!inputType) return;

        const input = await vscode.window.showInputBox({
            prompt: `Enter ${inputType.label} to ignore`,
            placeHolder: inputType.value === "ignoredWords" ? "primary-dark" : "data-testid",
        });
        if (!input || !input.trim()) return;

        targetSetting = inputType.value;
        targetValue = input.trim();
        typeName = inputType.label;
    }

    // 1. Save rule to settings
    await appendToConfigArray(targetSetting, targetValue);

    // 2. Immediately force re-scan the active document and all open documents
    scanDocument(document, diagnostics, true);
    scanAllOpenDocuments(diagnostics, true);

    vscode.window.showInformationMessage(
        `$(shield) Ignored "${targetValue}" (${typeName}). False positive cleared!`,
    );

    // 3. Create GitHub issue in background asynchronously (non-blocking)
    submitRuleToGitHub({
        actionType: "false-positive",
        typeName,
        identifier: targetValue,
        snippet: contextInfo.lineText,
        languageId: document.languageId,
    }).catch(() => {});
}

/**
 * Submits a rule or false positive report as a GitHub issue.
 * @param {{
 *   actionType: "flag-hardcoded" | "false-positive",
 *   typeName: string,
 *   identifier: string,
 *   snippet: string,
 *   languageId: string
 * }} info
 */
async function submitRuleToGitHub(info) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const repo = config.get("githubRepo", DEFAULT_GITHUB_REPO);

    const isFlag = info.actionType === "flag-hardcoded";
    const title = isFlag
        ? `[Rule Suggestion] Flag "${info.identifier}" as hardcoded text (${info.typeName})`
        : `[False Positive] Ignore "${info.identifier}" (${info.typeName})`;

    const labels = isFlag
        ? ["rule-suggestion", "hardcoded-text"]
        : ["false-positive", "rule-exception"];

    const body = `### ${isFlag ? "Rule Suggestion: Flag Hardcoded Text" : "False Positive Report"}

- **Type**: ${info.typeName}
- **Identifier / Value**: \`${info.identifier}\`
- **Language**: \`${info.languageId}\`

#### Context Snippet:
\`\`\`${info.languageId || "javascript"}
${info.snippet || info.identifier}
\`\`\`

*Reported automatically from VS Code Localization Check Extension.*
`;

    try {
        // Request GitHub authentication session
        const session = await vscode.authentication.getSession("github", ["public_repo"], {
            createIfNone: true,
        });

        if (session && session.accessToken) {
            const result = await createGitHubIssueViaApi(repo, session.accessToken, title, body, labels);
            const viewAction = "View Issue";
            vscode.window
                .showInformationMessage(
                    `$(github) GitHub issue #${result.number} created in ${repo}!`,
                    viewAction,
                )
                .then(choice => {
                    if (choice === viewAction && result.html_url) {
                        vscode.env.openExternal(vscode.Uri.parse(result.html_url));
                    }
                });
            return;
        }
    } catch (err) {
        // If API fails or user denied permission, fallback to opening pre-filled issue URL on request
        const openIssueAction = "Open Issue on GitHub";
        vscode.window
            .showInformationMessage(
                `Rule saved locally! Would you like to share this rule on GitHub?`,
                openIssueAction,
            )
            .then(choice => {
                if (choice === openIssueAction) {
                    const fallbackUri = getPrefilledIssueUrl(repo, title, body, labels);
                    vscode.env.openExternal(fallbackUri);
                }
            });
    }
}

module.exports = {
    createGitHubIssueViaApi,
    getPrefilledIssueUrl,
    appendToConfigArray,
    inspectCodeContext,
    handleFlagAsHardcoded,
    handleMarkAsFalsePositive,
    submitRuleToGitHub,
};
