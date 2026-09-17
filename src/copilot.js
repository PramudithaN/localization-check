const vscode = require("vscode");
const { CONFIG_SECTION } = require("./constants");
const {
    findPrimaryDictionary,
    getDictionaryContext,
    addEntriesToDictionaries,
} = require("./dictionary");

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
    const isJsxFile =
        document.languageId.includes("react") ||
        document.languageId.endsWith("jsx") ||
        document.languageId.endsWith("tsx");

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
 * Extracts key from a localization expression like `t("common.key")` or `t('key')` or `formatMessage({ id: 'key' })`.
 * @param {string} expression
 * @returns {string}
 */
function extractKeyFromExpression(expression) {
    if (!expression) return "";
    const tMatch = expression.match(/\bt\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (tMatch) return tMatch[1];

    const intlMatch = expression.match(/id\s*:\s*["'`]([^"'`]+)["'`]/);
    if (intlMatch) return intlMatch[1];

    return "";
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
 * Inserts missing imports and hook definitions into the document via WorkspaceEdit.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").WorkspaceEdit} edit
 * @param {string} [neededImport] e.g. "import { useTranslation } from 'react-i18next';"
 * @param {string} [neededHook] e.g. "const { t } = useTranslation();"
 * @param {number} [targetLine]
 */
function injectMissingImportAndHook(document, edit, neededImport, neededHook, targetLine = 0) {
    const fileContent = document.getText();

    // 1. Inject missing import if needed
    if (neededImport && neededImport.trim()) {
        const importIdentifierMatch = neededImport.match(/import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from/);
        const importedIdentifier = importIdentifierMatch
            ? (importIdentifierMatch[1] || importIdentifierMatch[2]).trim().split(",")[0].trim()
            : "useTranslation";

        const hasImport = new RegExp(`\\bimport\\b[\\s\\S]*?\\b${importedIdentifier}\\b[\\s\\S]*?\\bfrom\\b`).test(
            fileContent,
        );

        if (!hasImport) {
            // Find insertion point: after the last existing import statement
            let lastImportLine = -1;
            for (let i = 0; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text.trim();
                if (lineText.startsWith("import ") || lineText.startsWith("import{") || /^import\s*\(/.test(lineText)) {
                    lastImportLine = i;
                }
            }

            const insertPos = lastImportLine >= 0
                ? new vscode.Position(lastImportLine + 1, 0)
                : new vscode.Position(0, 0);

            const importText = neededImport.trim() + "\n";
            edit.insert(document.uri, insertPos, importText);
        }
    }

    // 2. Inject missing hook definition if needed
    if (neededHook && neededHook.trim()) {
        const hasHook =
            /\bconst\s*\{\s*t\s*[\},]/.test(fileContent) ||
            /\bconst\s*\[\s*t\s*[\],]/.test(fileContent) ||
            /\bconst\s+t\s*=/.test(fileContent);

        if (!hasHook) {
            // Find enclosing component or function start before targetLine
            let componentLine = -1;
            for (let i = Math.min(targetLine, document.lineCount - 1); i >= 0; i--) {
                const lineText = document.lineAt(i).text;
                if (
                    /^(?:export\s+)?(?:default\s+)?(?:function|const|let|var)\s+[A-Za-z0-9_$]+/.test(lineText) &&
                    (lineText.includes("=>") || lineText.includes("function") || lineText.includes("{"))
                ) {
                    componentLine = i;
                    break;
                }
            }

            if (componentLine >= 0) {
                // Find opening brace '{'
                let braceLine = componentLine;
                while (braceLine < document.lineCount && !document.lineAt(braceLine).text.includes("{")) {
                    braceLine++;
                }

                if (braceLine < document.lineCount) {
                    const lineText = document.lineAt(braceLine).text;
                    const indentMatch = lineText.match(/^\s*/);
                    const baseIndent = indentMatch ? indentMatch[0] : "";
                    const innerIndent = baseIndent + "    ";

                    const insertPos = new vscode.Position(braceLine + 1, 0);
                    const hookText = `${innerIndent}${neededHook.trim()}\n`;
                    edit.insert(document.uri, insertPos, hookText);
                }
            }
        }
    }
}

/**
 * Requests GitHub Copilot Language Model to convert the hardcoded string into a localized expression,
 * updates the primary dictionary (e.g. en.json), and injects any missing t definition.
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
        const autoUpdateDict = config.get("autoUpdateDictionary", true);
        const autoImport = config.get("autoImportTranslation", true);

        // Fetch dictionary context
        const primaryDictUri = await findPrimaryDictionary();
        const dictContext = await getDictionaryContext(primaryDictUri);

        const prompt = [
            `You are an expert internationalization (i18n) and localization assistant in a ${document.languageId} codebase.`,
            `Your task is to localize the hardcoded string: "${targetText}" by providing:`,
            `1. The inline replacement expression (e.g. t('common.accountBlacklisted') or {t('common.accountBlacklisted')})`,
            `2. The dictionary key path (e.g. "common.accountBlacklisted")`,
            `3. The English text value to add to en.json`,
            `4. Any missing i18n import statement (e.g. "import { useTranslation } from 'react-i18next';") if useTranslation/i18n is not already imported in the file`,
            `5. Any missing hook declaration (e.g. "const { t } = useTranslation();") if t is not defined in the component`,
            "",
            dictContext.namespaces.length > 0
                ? `Available dictionary namespaces in en.json: ${dictContext.namespaces.join(", ")}`
                : "",
            dictContext.sampleSnippet ? `Sample dictionary structure:\n${dictContext.sampleSnippet}` : "",
            customPromptHint ? `User instructions: ${customPromptHint}` : "",
            "",
            "Surrounding code context:",
            "```" + document.languageId,
            contextSnippet,
            "```",
            "",
            `Target hardcoded text to replace: "${targetText}"`,
            "",
            "Output Format:",
            "Return ONLY a valid JSON object matching this schema:",
            JSON.stringify(
                {
                    replacement: "t('common.myKey')",
                    key: "common.myKey",
                    value: targetText,
                    neededImport: "import { useTranslation } from 'react-i18next';",
                    neededHook: "const { t } = useTranslation();",
                },
                null,
                2,
            ),
            "",
            "Rules:",
            "1. If t or useTranslation is already imported/defined in the file, set neededImport and neededHook to null.",
            "2. Match existing i18n patterns in the codebase (such as t('key'), formatMessage, react-i18next).",
            "3. Do NOT include surrounding property names or keys in 'replacement'.",
            "4. Output valid JSON only with NO markdown fences or commentary.",
        ]
            .filter(Boolean)
            .join("\n");

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

                let cleanedResponse = cleanModelResponse(accumulated);
                let parsedResult = null;

                try {
                    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        parsedResult = JSON.parse(jsonMatch[0]);
                    }
                } catch {
                    // Fallback to plain string response
                }

                const rawReplacement = parsedResult && parsedResult.replacement
                    ? parsedResult.replacement
                    : cleanedResponse;

                const replacement = formatReplacement(rawReplacement, document, range);
                if (!replacement) {
                    vscode.window.showWarningMessage("Copilot did not return a valid replacement.");
                    return false;
                }

                const key = (parsedResult && parsedResult.key) || extractKeyFromExpression(replacement);
                const value = (parsedResult && parsedResult.value) || targetText;

                const edit = new vscode.WorkspaceEdit();

                // 1. Inject missing import and hook if enabled
                if (autoImport && parsedResult) {
                    injectMissingImportAndHook(
                        document,
                        edit,
                        parsedResult.neededImport,
                        parsedResult.neededHook,
                        range.start.line,
                    );
                }

                // 2. Replace hardcoded string inline
                edit.replace(document.uri, range, replacement);
                const applied = await vscode.workspace.applyEdit(edit);

                if (!applied) {
                    vscode.window.showErrorMessage("Failed to apply localization edit to document.");
                    return false;
                }

                // 3. Auto-update en.json and sibling dictionaries
                let dictMessage = "";
                if (autoUpdateDict && key && value) {
                    const dictRes = await addEntriesToDictionaries([{ key, value }]);
                    if (dictRes.primaryUpdated) {
                        dictMessage = ` & added key "${key}" to en.json`;
                    }
                }

                vscode.window.showInformationMessage(
                    `Localized "${targetText}" ➔ ${replacement}${dictMessage}`,
                );
                return true;
            },
        );
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            vscode.window.showErrorMessage(`Copilot LM Error: ${err.message} (${err.code || "unknown"})`);
        } else if (err && err.message) {
            vscode.window.showErrorMessage(`Localization failed: ${err.message}`);
        } else {
            vscode.window.showErrorMessage("An unexpected error occurred during Copilot localization.");
        }
        return false;
    }
}

/**
 * Localizes all detected hardcoded strings in the document in a single batch request to GitHub Copilot,
 * updates en.json with all generated keys, and injects missing t definitions.
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
        const autoUpdateDict = config.get("autoUpdateDictionary", true);
        const autoImport = config.get("autoImportTranslation", true);

        // Fetch dictionary context
        const primaryDictUri = await findPrimaryDictionary();
        const dictContext = await getDictionaryContext(primaryDictUri);

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
            `Your task is to provide localization replacements for all ${items.length} hardcoded strings detected in the file, along with their dictionary keys, English values, and any missing imports or hooks.`,
            "",
            dictContext.namespaces.length > 0
                ? `Available dictionary namespaces in en.json: ${dictContext.namespaces.join(", ")}`
                : "",
            dictContext.sampleSnippet ? `Sample dictionary structure:\n${dictContext.sampleSnippet}` : "",
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
            "Output Format:",
            "Return ONLY a valid JSON object matching this schema:",
            JSON.stringify(
                {
                    neededImport: "import { useTranslation } from 'react-i18next';",
                    neededHook: "const { t } = useTranslation();",
                    items: [
                        {
                            id: 1,
                            replacement: "t('common.firstKey')",
                            key: "common.firstKey",
                            value: "First Text",
                        },
                    ],
                },
                null,
                2,
            ),
            "",
            "Rules:",
            "1. If t or useTranslation is already imported/defined in the file, set neededImport and neededHook to null.",
            "2. Output ONLY the JSON object. Do NOT include markdown fences, surrounding property names in replacement, or commentary.",
            "3. Ensure valid JSON syntax.",
        ]
            .filter(Boolean)
            .join("\n");

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
                const objMatch = jsonText.match(/\{[\s\S]*\}/);
                const arrayMatch = jsonText.match(/\[[\s\S]*\]/);

                let parsedBatch = null;
                try {
                    if (objMatch) {
                        parsedBatch = JSON.parse(objMatch[0]);
                    } else if (arrayMatch) {
                        parsedBatch = { items: JSON.parse(arrayMatch[0]) };
                    }
                } catch {
                    vscode.window.showErrorMessage(
                        "Copilot returned an unexpected response format. Please try again or localize items individually.",
                    );
                    return false;
                }

                const parsedItems = parsedBatch && Array.isArray(parsedBatch.items)
                    ? parsedBatch.items
                    : Array.isArray(parsedBatch)
                      ? parsedBatch
                      : [];

                if (parsedItems.length === 0) {
                    vscode.window.showWarningMessage("No valid replacements received from Copilot.");
                    return false;
                }

                const replacementMap = new Map();
                const dictionaryEntries = [];

                parsedItems.forEach(entry => {
                    if (entry && entry.id !== undefined && entry.replacement) {
                        replacementMap.set(Number(entry.id), entry);
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
                    const entry = replacementMap.get(item.id);
                    if (entry) {
                        const rawReplacement = entry.replacement;
                        const replacement = formatReplacement(rawReplacement, document, item.range);
                        if (replacement) {
                            edit.replace(document.uri, item.range, replacement);
                            appliedCount++;

                            const key = entry.key || extractKeyFromExpression(replacement);
                            const value = entry.value || item.text;
                            if (key && value) {
                                dictionaryEntries.push({ key, value });
                            }
                        }
                    }
                }

                if (appliedCount === 0) {
                    vscode.window.showWarningMessage("Could not match any replacements to the file.");
                    return false;
                }

                // Inject missing import and hook if needed
                if (autoImport && parsedBatch) {
                    injectMissingImportAndHook(
                        document,
                        edit,
                        parsedBatch.neededImport,
                        parsedBatch.neededHook,
                        sortedItems[0].range.start.line,
                    );
                }

                const applied = await vscode.workspace.applyEdit(edit);
                if (!applied) {
                    vscode.window.showErrorMessage("Failed to apply batch localization edits to document.");
                    return false;
                }

                // Update en.json and sibling dictionaries
                let dictCount = 0;
                if (autoUpdateDict && dictionaryEntries.length > 0) {
                    const dictRes = await addEntriesToDictionaries(dictionaryEntries);
                    dictCount = dictRes.count;
                }

                const dictNote = dictCount > 0 ? ` and added ${dictCount} keys to en.json` : "";
                vscode.window.showInformationMessage(
                    `Successfully localized ${appliedCount} string${appliedCount > 1 ? "s" : ""}${dictNote} with Copilot!`,
                );
                return true;
            },
        );
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            vscode.window.showErrorMessage(`Copilot LM Error: ${err.message} (${err.code || "unknown"})`);
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
    extractKeyFromExpression,
    getSurroundingContext,
    injectMissingImportAndHook,
    localizeWithCopilot,
    localizeAllInDocument,
};