const vscode = require("vscode");
const { CONFIG_SECTION } = require("./constants");

/**
 * Strips code fences, markdown wrapping, property/attribute prefixes,
 * unnecessary outer quotes, and trailing punctuation (commas, semicolons).
 * @param {string} text
 * @returns {string}
 */
function cleanModelResponse(text) {
    let cleaned = text.trim();

    // Remove markdown code fence ```lang ... ``` or ``` ... ```
    const codeBlockMatch = cleaned.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    // If the model wrapped the replacement in inline backticks `...`
    if (cleaned.startsWith("`") && cleaned.endsWith("`") && cleaned.length > 2 && !cleaned.slice(1, -1).includes("`")) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    // If the model prefixed the response with property name or attribute name, e.g. `title: t(...)` or `placeholder={t(...)}`
    const keyPrefixMatch = cleaned.match(/^[a-zA-Z0-9_-]+\s*[:=]\s*([\s\S]+)$/);
    if (keyPrefixMatch) {
        cleaned = keyPrefixMatch[1].trim();
    }

    // Strip trailing semicolons or commas (e.g. `t("key"),` -> `t("key")`)
    cleaned = cleaned.replace(/[;,]+$/, "").trim();

    // If model wrapped a localization call in outer quotes, e.g. "t('key')" or 't('key')'
    if (
        (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
        const inner = cleaned.slice(1, -1).trim();
        if (
            /^(?:i18n\.)?t\s*\(/.test(inner) ||
            /^(?:intl\.)?formatMessage\s*\(/.test(inner) ||
            /^useTranslation\b/.test(inner) ||
            inner.startsWith("{")
        ) {
            cleaned = inner;
        }
    }

    return cleaned;
}

/**
 * Formats the cleaned model replacement according to the surrounding syntax context.
 * @param {string} rawReplacement
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").Range} range
 * @returns {string}
 */
function formatReplacement(rawReplacement, document, range) {
    let result = cleanModelResponse(rawReplacement);
    if (!result) return "";

    const line = document.lineAt(range.start.line).text;
    const beforeText = line.slice(0, range.start.character).trimEnd();
    const afterText = line.slice(range.end.character).trimStart();
    const isJsxFile = document.languageId.includes("react") || document.languageId.endsWith("jsx") || document.languageId.endsWith("tsx");

    // Check if replacing inside a JSX attribute: e.g. `placeholder="`
    const isJsxAttribute = /=\s*$/.test(beforeText);

    // Check if replacing inside JSX child text: e.g. `>text<` or standalone JSX line
    const isJsxText = />\s*$/.test(beforeText) || (/^\s*<\//.test(afterText) && isJsxFile);

    // Check if replacing an object property or JS function argument: e.g. `title:` or `fn(`
    const isJsExpression = /:\s*$/.test(beforeText) || /[,\(]\s*$/.test(beforeText);

    if (isJsxAttribute || isJsxText) {
        // In JSX attributes and JSX children, localization calls must be wrapped in JSX expression braces `{...}`
        if (!result.startsWith("{") && !result.endsWith("}")) {
            if (/^(?:i18n\.)?t\s*\(/.test(result) || /^(?:intl\.)?formatMessage\s*\(/.test(result)) {
                result = `{${result}}`;
            }
        }
    } else if (isJsExpression) {
        // In JS object properties (`title: ...`) or function arguments (`fn(...)`), it must NOT be wrapped in `{}` unless it's a valid object argument
        if (result.startsWith("{") && result.endsWith("}")) {
            const inner = result.slice(1, -1).trim();
            // If it's `{t('...')}`, strip the outer braces
            if (/^(?:i18n\.)?t\s*\(/.test(inner)) {
                result = inner;
            }
        }
    }

    return result;
}

/**
 * Extracts relevant file context around the given range to assist the language model.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").Range} range
 * @returns {{ contextSnippet: string, targetText: string }}
 */
function getSurroundingContext(document, range) {
    const targetText = document.getText(range);
    const startLine = Math.max(0, range.start.line - 15);
    const endLine = Math.min(document.lineCount - 1, range.end.line + 15);

    const contextRange = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length),
    );

    const contextSnippet = document.getText(contextRange);
    return { contextSnippet, targetText };
}

/**
 * Requests GitHub Copilot Language Model to convert the hardcoded string into a localized expression and applies it.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").Range} range
 * @returns {Promise<boolean>}
 */
async function localizeWithCopilot(document, range) {
    if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
        vscode.window.showErrorMessage(
            "Language Model API is not available in this version of VS Code. Please update VS Code.",
        );
        return false;
    }

    try {
        let models = await vscode.lm.selectChatModels({ vendor: "copilot" });
        if (!models || models.length === 0) {
            // Fallback to any available language model
            models = await vscode.lm.selectChatModels();
        }

        if (!models || models.length === 0) {
            vscode.window.showErrorMessage(
                "GitHub Copilot language model is not available. Please ensure GitHub Copilot is installed and active.",
            );
            return false;
        }

        const model = models[0];
        const { contextSnippet, targetText } = getSurroundingContext(document, range);

        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const customPromptHint = config.get("copilotPromptHint", "");

        const prompt = [
            `You are an expert internationalization (i18n) and localization assistant in a ${document.languageId} codebase.`,
            `Your task is to replace the hardcoded string: "${targetText}" with the appropriate localization code expression or JSX based on the project conventions shown in the surrounding code.`,
            customPromptHint ? `User instructions: ${customPromptHint}` : "",
            "",
            "Surrounding code context:",
            "```" + document.languageId,
            contextSnippet,
            "```",
            "",
            `Target hardcoded text to replace: "${targetText}"`,
            "",
            "Rules:",
            "1. Output ONLY the exact replacement expression/JSX that should directly substitute the target text in the code.",
            "2. Do NOT include surrounding property names or keys (e.g. if replacing the value in 'title: \"...\"', output ONLY the localization expression, NOT 'title: ...').",
            "3. Do NOT include trailing commas (,) or semicolons (;).",
            "4. Do NOT output explanations, markdown headers, or code comments.",
            "5. Do NOT include enclosing markdown code blocks (```).",
            "6. Match existing i18n conventions in the file if present (such as t('key'), formatMessage({ id: '...' }), useTranslation, etc.).",
            "7. Generate a clear, kebab-case, camelCase, or dot-notation key as suitable for the string.",
        ].filter(Boolean).join("\n");

        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Localizing "${targetText.length > 25 ? targetText.slice(0, 22) + '...' : targetText}" with Copilot...`,
                cancellable: true,
            },
            async (_progress, token) => {
                const messages = [vscode.LanguageModelChatMessage.User(prompt)];
                const response = await model.sendRequest(messages, {}, token);

                let accumulated = "";
                for await (const chunk of response.text) {
                    if (token.isCancellationRequested) {
                        return false;
                    }
                    accumulated += chunk;
                }

                const replacement = formatReplacement(accumulated, document, range);
                if (!replacement) {
                    vscode.window.showWarningMessage("Copilot did not return a valid replacement.");
                    return false;
                }

                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, range, replacement);
                const applied = await vscode.workspace.applyEdit(edit);

                if (applied) {
                    vscode.window.showInformationMessage(
                        `Localized "${targetText}" ➔ ${replacement}`,
                    );
                    return true;
                } else {
                    vscode.window.showErrorMessage("Failed to apply localization edit to document.");
                    return false;
                }
            },
        );
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            vscode.window.showErrorMessage(`Copilot LM Error: ${err.message} (${err.code || 'unknown'})`);
        } else if (err && err.message) {
            vscode.window.showErrorMessage(`Localization failed: ${err.message}`);
        } else {
            vscode.window.showErrorMessage("An unexpected error occurred during Copilot localization.");
        }
        return false;
    }
}

/**
 * Localizes all detected hardcoded strings in the document in a single batch request to GitHub Copilot.
 * @param {import("vscode").TextDocument} document
 * @param {vscode.Diagnostic[]} diagnostics
 * @returns {Promise<boolean>}
 */
async function localizeAllInDocument(document, diagnostics) {
    if (!diagnostics || diagnostics.length === 0) {
        vscode.window.showInformationMessage("No hardcoded strings detected in this file.");
        return false;
    }

    if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
        vscode.window.showErrorMessage(
            "Language Model API is not available in this version of VS Code. Please update VS Code.",
        );
        return false;
    }

    try {
        let models = await vscode.lm.selectChatModels({ vendor: "copilot" });
        if (!models || models.length === 0) {
            models = await vscode.lm.selectChatModels();
        }

        if (!models || models.length === 0) {
            vscode.window.showErrorMessage(
                "GitHub Copilot language model is not available. Please ensure GitHub Copilot is installed and active.",
            );
            return false;
        }

        const model = models[0];
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const customPromptHint = config.get("copilotPromptHint", "");

        // Prepare items list with index identifiers
        const items = diagnostics.map((d, index) => ({
            id: index + 1,
            text: document.getText(d.range),
            range: d.range,
            line: d.range.start.line + 1,
        }));

        const itemsPrompt = items
            .map(item => `[${item.id}] Line ${item.line}: "${item.text}"`)
            .join("\n");

        const prompt = [
            `You are an expert internationalization (i18n) and localization assistant in a ${document.languageId} codebase.`,
            `Your task is to provide localization replacements for all ${items.length} hardcoded strings detected in the file.`,
            customPromptHint ? `User instructions: ${customPromptHint}` : "",
            "",
            "Full file content:",
            "```" + document.languageId,
            document.getText(),
            "```",
            "",
            "Hardcoded items to replace:",
            itemsPrompt,
            "",
            "Rules:",
            "1. Output ONLY a valid JSON array of objects mapping each item id to its replacement code expression/JSX.",
            '2. Format: [{"id": 1, "replacement": "t(\'save\')"}, {"id": 2, "replacement": "formatMessage({ id: \'submit\' })"}]',
            "3. Do NOT include surrounding property names/keys, do NOT include trailing commas (,) or semicolons (;).",
            "4. Do NOT wrap output in markdown fences, do NOT include explanations.",
            "5. Match the exact i18n patterns/libraries already used or imported in the file where possible.",
            "6. Ensure valid JSON syntax only.",
        ].filter(Boolean).join("\n");

        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Localizing ${items.length} strings in file with Copilot...`,
                cancellable: true,
            },
            async (_progress, token) => {
                const messages = [vscode.LanguageModelChatMessage.User(prompt)];
                const response = await model.sendRequest(messages, {}, token);

                let accumulated = "";
                for await (const chunk of response.text) {
                    if (token.isCancellationRequested) {
                        return false;
                    }
                    accumulated += chunk;
                }

                let jsonText = cleanModelResponse(accumulated);
                // Extract JSON array if surrounded by any remaining text
                const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    jsonText = arrayMatch[0];
                }

                let parsedReplacements;
                try {
                    parsedReplacements = JSON.parse(jsonText);
                } catch {
                    vscode.window.showErrorMessage(
                        "Copilot returned an unexpected response format. Please try again or localize items individually.",
                    );
                    return false;
                }

                if (!Array.isArray(parsedReplacements) || parsedReplacements.length === 0) {
                    vscode.window.showWarningMessage("No valid replacements received from Copilot.");
                    return false;
                }

                const replacementMap = new Map();
                parsedReplacements.forEach(entry => {
                    if (entry && entry.id !== undefined && entry.replacement) {
                        replacementMap.set(Number(entry.id), String(entry.replacement));
                    }
                });

                // Apply edits in reverse order (bottom of document to top) to maintain position integrity
                const sortedItems = [...items].sort((a, b) => {
                    if (b.range.start.line !== a.range.start.line) {
                        return b.range.start.line - a.range.start.line;
                    }
                    return b.range.start.character - a.range.start.character;
                });

                const edit = new vscode.WorkspaceEdit();
                let appliedCount = 0;

                for (const item of sortedItems) {
                    const rawReplacement = replacementMap.get(item.id);
                    if (rawReplacement) {
                        const replacement = formatReplacement(rawReplacement, document, item.range);
                        if (replacement) {
                            edit.replace(document.uri, item.range, replacement);
                            appliedCount++;
                        }
                    }
                }

                if (appliedCount === 0) {
                    vscode.window.showWarningMessage("Could not match any replacements to the file.");
                    return false;
                }

                const applied = await vscode.workspace.applyEdit(edit);
                if (applied) {
                    vscode.window.showInformationMessage(
                        `Successfully localized ${appliedCount} string${appliedCount > 1 ? "s" : ""} in file with Copilot!`,
                    );
                    return true;
                } else {
                    vscode.window.showErrorMessage("Failed to apply batch localization edits to document.");
                    return false;
                }
            },
        );
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            vscode.window.showErrorMessage(`Copilot LM Error: ${err.message} (${err.code || 'unknown'})`);
        } else if (err && err.message) {
            vscode.window.showErrorMessage(`Batch localization failed: ${err.message}`);
        } else {
            vscode.window.showErrorMessage("An unexpected error occurred during batch localization.");
        }
        return false;
    }
}

module.exports = {
    cleanModelResponse,
    formatReplacement,
    getSurroundingContext,
    localizeWithCopilot,
    localizeAllInDocument,
};