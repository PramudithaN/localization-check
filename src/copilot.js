const vscode = require("vscode");
const { CONFIG_SECTION } = require("./constants");
const {
    findPrimaryDictionary,
    ensurePrimaryDictionary,
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
    if (!text || typeof text !== "string") return "";
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
 * Robustly parses JSON response from Language Model, tolerating markdown fences, comments, and trailing commas.
 * @param {string} text
 * @returns {any | null}
 */
function parseModelJsonResponse(text) {
    if (!text || typeof text !== "string") return null;

    let cleaned = text.trim();

    // Strip markdown fences
    const fenceMatch = cleaned.match(/```(?:json|javascript|js|ts|tsx)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }

    // Extract object or array candidates
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);

    const candidates = [];
    if (objMatch) candidates.push(objMatch[0]);
    if (arrayMatch) candidates.push(arrayMatch[0]);
    candidates.push(cleaned);

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            try {
                // Sanitize line comments, block comments, and trailing commas
                const sanitized = candidate
                    .replace(/\/\/[^\n]*/g, "")
                    .replace(/\/\*[\s\S]*?\*\//g, "")
                    .replace(/,(\s*[}\]])/g, "$1");
                return JSON.parse(sanitized);
            } catch {
                // Continue to next candidate
            }
        }
    }

    return null;
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

    const simpleMatch = expression.match(/["'`]([a-zA-Z0-9_.-]+)["'`]/);
    if (simpleMatch) return simpleMatch[1];

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
 * Detects the i18n setup and framework used in the workspace and file.
 * Strictly defaults to react-i18next with `const { t } = useTranslation()`.
 * @param {import("vscode").TextDocument} document
 * @returns {Promise<{ framework: string, importStatement: string, hookStatement: string, isReact: boolean }>}
 */
async function detectI18nSetup(document) {
    const text = document.getText();
    const isReact =
        document.languageId.includes("react") ||
        document.languageId.endsWith("jsx") ||
        document.languageId.endsWith("tsx") ||
        /\bimport\s+React\b/.test(text) ||
        /<\s*[A-Za-z][A-Za-z0-9_.]*(?:\s+[^>]*?)?>/.test(text);

    // If next-i18next is specifically imported
    if (/\bfrom\s+['"]next-i18next['"]/.test(text)) {
        return {
            framework: "next-i18next",
            importStatement: "import { useTranslation } from 'next-i18next';",
            hookStatement: "const { t } = useTranslation();",
            isReact,
        };
    }

    // Default strictly to standard react-i18next with `const { t } = useTranslation();`
    return {
        framework: "react-i18next",
        importStatement: "import { useTranslation } from 'react-i18next';",
        hookStatement: "const { t } = useTranslation();",
        isReact: true,
    };
}

/**
 * Checks if the document already has an import statement providing the required symbol.
 * @param {string} fileContent
 * @param {string} importStatement
 * @returns {boolean} True if missing, False if already imported
 */
function isFileMissingImport(fileContent, importStatement) {
    if (!importStatement || !importStatement.trim()) return false;

    // Extract imported symbols, e.g. useTranslation, t
    const namedMatch = importStatement.match(/import\s*\{\s*([^}]+)\s*\}\s*from/);
    const defaultMatch = importStatement.match(/import\s+([a-zA-Z0-9_$]+)\s+from/);

    const symbolsToCheck = [];
    if (namedMatch) {
        namedMatch[1].split(",").forEach(s => {
            const clean = s.trim().split(/\s+as\s+/)[0].trim();
            if (clean) symbolsToCheck.push(clean);
        });
    } else if (defaultMatch) {
        symbolsToCheck.push(defaultMatch[1].trim());
    }

    if (symbolsToCheck.length === 0) {
        symbolsToCheck.push("useTranslation");
    }

    // Check if any import in the file imports any of these symbols
    const importRegex = /(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
    let match;
    while ((match = importRegex.exec(fileContent)) !== null) {
        const importClause = match[1];
        for (const sym of symbolsToCheck) {
            const symPattern = new RegExp(`\\b${sym}\\b`);
            if (symPattern.test(importClause)) {
                return false; // already imported
            }
        }
    }

    return true; // missing
}

/**
 * Injects missing import statement into the document via WorkspaceEdit.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").WorkspaceEdit} edit
 * @param {string} importStatement
 */
function injectImportStatement(document, edit, importStatement) {
    if (!importStatement || !importStatement.trim()) return;

    const fileContent = document.getText();
    if (!isFileMissingImport(fileContent, importStatement)) {
        return;
    }

    // Find the right insertion line
    let insertLine = 0;
    let foundImport = false;

    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text.trim();

        // If line has "use client" or "use strict", import must go after it
        if (/^['"]use (?:client|strict)['"]/.test(lineText)) {
            insertLine = i + 1;
            continue;
        }

        if (
            lineText.startsWith("import ") ||
            lineText.startsWith("import{") ||
            /^import\s*\(/.test(lineText)
        ) {
            insertLine = i + 1;
            foundImport = true;
        } else if (foundImport && lineText.length === 0) {
            continue;
        }
    }

    const insertPos = new vscode.Position(insertLine, 0);
    const textToInsert = importStatement.trim() + "\n";
    edit.insert(document.uri, insertPos, textToInsert);
}

/**
 * Scans top-level and nested components/functions in the document to find the one enclosing targetLine.
 * Ensures hooks are ONLY injected inside valid React Functional Components or Custom Hooks,
 * never inside plain constants, object literals, array literals, or module scope.
 * @param {import("vscode").TextDocument} document
 * @param {number} targetLine
 * @returns {{ headerLine: number, bodyOpenLine: number, indent: string, hasT: boolean } | null}
 */
function findEnclosingComponent(document, targetLine) {
    const candidateComponents = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const trimmed = line.trim();

        if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("/*") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("import ")
        ) {
            continue;
        }

        // 1. Function declaration: e.g. function MyComponent(...) or function useMyHook(...) or export default function(...)
        const funcMatch = trimmed.match(
            /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s+([A-Za-z0-9_$]+))?\s*(?:<[^>]*>)?\s*\(/,
        );
        if (funcMatch) {
            const name = funcMatch[1];
            // Must be PascalCase component, custom hook (use...), or default export function
            const isComponentOrHook =
                !name ||
                /^[A-Z][A-Za-z0-9_$]*$/.test(name) ||
                /^use[A-Z][A-Za-z0-9_$]*$/.test(name);

            if (isComponentOrHook) {
                candidateComponents.push({ startLine: i, type: "function" });
                continue;
            }
        }

        // 2. Arrow function or function expression: e.g.
        // const MyComponent = (...) => {
        // export const MyComponent: React.FC<Props> = ({ ... }) => {
        // const MyComponent = forwardRef(...)
        // const useMyHook = (...) => {
        const varMatch = trimmed.match(
            /^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/,
        );
        if (varMatch) {
            const name = varMatch[1];
            const isPascalOrHook =
                /^[A-Z][A-Za-z0-9_$]*$/.test(name) ||
                /^use[A-Z][A-Za-z0-9_$]*$/.test(name);

            if (isPascalOrHook) {
                // Check if this declaration defines a component or function across one or multiple lines
                let isComponentDef = false;
                for (let j = i; j < Math.min(document.lineCount, i + 10); j++) {
                    const checkLine = document.lineAt(j).text;
                    if (
                        /=>/.test(checkLine) ||
                        /\bfunction\b/.test(checkLine) ||
                        /\b(?:React\.)?(?:memo|forwardRef)\b/.test(checkLine) ||
                        /\bReact\.FC\b/.test(checkLine) ||
                        /\bFC\b/.test(checkLine)
                    ) {
                        isComponentDef = true;
                        break;
                    }
                    if (j > i && /^[A-Za-z0-9_$]/.test(checkLine.trim()) && checkLine.includes("=")) {
                        break;
                    }
                }

                if (isComponentDef) {
                    candidateComponents.push({ startLine: i, type: "arrow" });
                    continue;
                }
            }
        }

        // 3. Anonymous default export arrow component: e.g. export default (...) => {
        if (/^export\s+default\s+(?:\([^)]*\)|[A-Za-z0-9_$]+|\s*(?:<[^>]*>)?)\s*=>/.test(trimmed)) {
            candidateComponents.push({ startLine: i, type: "arrow" });
        }
    }

    // Fallback: If targetLine wasn't found by top candidates, search upwards from targetLine for enclosing function/component
    if (candidateComponents.length === 0 || !candidateComponents.some(c => c.startLine <= targetLine)) {
        for (let i = targetLine; i >= Math.max(0, targetLine - 80); i--) {
            const line = document.lineAt(i).text.trim();
            if (
                /^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*|use[A-Z][A-Za-z0-9_$]*)/.test(line) ||
                /^(?:export\s+)?(?:default\s+)?function(?:\s+([A-Z][A-Za-z0-9_$]*|use[A-Z][A-Za-z0-9_$]*))?/.test(line) ||
                /^export\s+default\s+/.test(line)
            ) {
                candidateComponents.push({ startLine: i, type: "arrow" });
                break;
            }
        }
    }

    if (candidateComponents.length === 0) {
        return null;
    }

    // Evaluate candidates to find the one that encloses targetLine
    const validEnclosing = [];

    for (const candidate of candidateComponents) {
        let bodyOpenLine = -1;

        // Search forward from candidate.startLine for the '{' that opens the component body
        for (let i = candidate.startLine; i < Math.min(document.lineCount, candidate.startLine + 30); i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes("{")) {
                bodyOpenLine = i;
                break;
            }
        }

        if (bodyOpenLine === -1) continue;

        // Find closing '}' of component body
        let depth = 0;
        let bodyCloseLine = -1;
        let foundStart = false;

        for (let i = bodyOpenLine; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            let inQuote = null;

            for (let j = 0; j < lineText.length; j++) {
                const char = lineText[j];
                if (inQuote) {
                    if (char === inQuote && lineText[j - 1] !== "\\") inQuote = null;
                } else if (char === '"' || char === "'" || char === "`") {
                    inQuote = char;
                } else if (char === "/" && lineText[j + 1] === "/") {
                    break; // line comment
                } else if (char === "{" || char === "(") {
                    if (char === "{") {
                        depth++;
                        foundStart = true;
                    }
                } else if (char === "}") {
                    depth--;
                    if (foundStart && depth === 0) {
                        bodyCloseLine = i;
                        break;
                    }
                }
            }
            if (foundStart && depth === 0) break;
        }

        if (bodyCloseLine === -1) bodyCloseLine = document.lineCount - 1;

        // Check if targetLine is strictly inside this component
        if (targetLine >= bodyOpenLine && targetLine <= bodyCloseLine) {
            validEnclosing.push({
                headerLine: candidate.startLine,
                bodyOpenLine,
                bodyCloseLine,
            });
        }
    }

    if (validEnclosing.length === 0) {
        return null;
    }

    // If multiple enclosing components, pick innermost (smallest range)
    validEnclosing.sort((a, b) => (a.bodyCloseLine - a.bodyOpenLine) - (b.bodyCloseLine - b.bodyOpenLine));
    const best = validEnclosing[0];

    // Check if component already declares `t` or `useTranslation`
    const componentText = document.getText(
        new vscode.Range(
            new vscode.Position(best.headerLine, 0),
            new vscode.Position(best.bodyCloseLine, document.lineAt(best.bodyCloseLine).text.length),
        ),
    );

    const hasT =
        /\bconst\s*\{\s*[^}]*\bt\b[^}]*\}\s*=\s*useTranslation\b/.test(componentText) ||
        /\bconst\s*\{\s*t\s*\}\s*=/.test(componentText) ||
        /\bconst\s+t\s*=\s*useTranslation\b/.test(componentText) ||
        /\bconst\s+t\s*=/.test(componentText) ||
        /\buseTranslation\s*\(\s*\)/.test(componentText);

    // Calculate proper indentation for hook insertion inside component body
    let indent = "";
    if (best.bodyOpenLine + 1 < document.lineCount) {
        const nextLine = document.lineAt(best.bodyOpenLine + 1).text;
        const nextIndent = nextLine.match(/^\s*/);
        if (nextIndent && nextIndent[0].length > 0 && nextLine.trim().length > 0) {
            indent = nextIndent[0];
        }
    }

    if (!indent) {
        const headerLineText = document.lineAt(best.headerLine).text;
        const headerIndentMatch = headerLineText.match(/^\s*/);
        const baseIndent = headerIndentMatch ? headerIndentMatch[0] : "";
        indent = baseIndent + "    ";
    }

    return {
        headerLine: best.headerLine,
        bodyOpenLine: best.bodyOpenLine,
        indent,
        hasT,
    };
}

/**
 * Injects missing hook definition into the component body.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").WorkspaceEdit} edit
 * @param {{ headerLine: number, bodyOpenLine: number, indent: string, hasT: boolean }} componentInfo
 * @param {string} hookStatement
 */
function injectHookIntoComponent(document, edit, componentInfo, hookStatement) {
    if (!componentInfo || componentInfo.hasT || !hookStatement || !hookStatement.trim()) {
        return;
    }

    const insertPos = new vscode.Position(componentInfo.bodyOpenLine + 1, 0);
    const hookText = `${componentInfo.indent}${hookStatement.trim()}\n`;
    edit.insert(document.uri, insertPos, hookText);
    componentInfo.hasT = true;
}

/**
 * Ensures required hook declarations and imports are present in the document.
 * ONLY injects `useTranslation` import if `useTranslation` hook is actively used or injected.
 * @param {import("vscode").TextDocument} document
 * @param {import("vscode").WorkspaceEdit} edit
 * @param {number[]} targetLines
 * @param {string} [neededImport]
 * @param {string} [neededHook]
 */
async function ensureTranslationsInDocument(document, edit, targetLines, neededImport, neededHook) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const autoImport = config.get("autoImportTranslation", true);
    if (!autoImport) return;

    const setup = await detectI18nSetup(document);
    const finalImport = neededImport && neededImport.trim() ? neededImport.trim() : setup.importStatement;
    const finalHook = neededHook && neededHook.trim() ? neededHook.trim() : setup.hookStatement;

    const docText = document.getText();
    let hookInjectedOrPresent = /\buseTranslation\s*\(/.test(docText);

    // 1. Inject hook in each unique enclosing component if missing
    if (finalHook && finalHook.trim()) {
        const seenComponents = new Set();
        for (const line of targetLines) {
            const comp = findEnclosingComponent(document, line);
            if (comp) {
                if (!comp.hasT && !seenComponents.has(comp.bodyOpenLine)) {
                    seenComponents.add(comp.bodyOpenLine);
                    injectHookIntoComponent(document, edit, comp, finalHook);
                    hookInjectedOrPresent = true;
                } else if (comp.hasT) {
                    hookInjectedOrPresent = true;
                }
            }
        }
    }

    // 2. Inject import statement ONLY IF useTranslation hook is injected or already present
    if (hookInjectedOrPresent) {
        injectImportStatement(document, edit, finalImport);
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

        // Fetch dictionary context
        const primaryDictUri = await findPrimaryDictionary();
        // Format existing dictionary sample & common keys
        const existingCommonEntries = Object.entries(dictContext.existingKeysMap || {})
            .filter(([k]) => k.startsWith("common."))
            .slice(0, 30)
            .map(([k, v]) => `  "${k}": "${v}"`)
            .join("\n");

        const prompt = [
            `You are an expert internationalization (i18n) and localization assistant in a ${document.languageId} codebase.`,
            `Your task is to localize the hardcoded string: "${targetText}" by providing:`,
            `1. The inline replacement expression (e.g. t('common.accountBlacklisted') or {t('common.accountBlacklisted')})`,
            `2. The dictionary key path in en.json (e.g. "common.accountBlacklisted")`,
            `3. The English text value to add to en.json`,
            `4. The standard i18n import: "import { useTranslation } from 'react-i18next';"`,
            `5. The standard hook declaration: "const { t } = useTranslation();"`,
            "",
            dictContext.namespaces.length > 0
                ? `Available dictionary namespaces in en.json: ${dictContext.namespaces.join(", ")}`
                : "",
            existingCommonEntries
                ? `Existing common keys in en.json (reuse these when applicable instead of creating duplicates):\n{\n${existingCommonEntries}\n}`
                : "",
            dictContext.sampleSnippet ? `Sample en.json structure:\n${dictContext.sampleSnippet}` : "",
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
            "Strict Rules & Guidelines:",
            "1. Strict Hook Requirement: You MUST strictly use 'const { t } = useTranslation();' from 'react-i18next'. Do NOT use any other hook or format (never use useTranslations, useIntl, or formatMessage).",
            "2. Common Values & Deduplication: For common reusable action words and UI labels (such as Save, Cancel, Submit, Delete, Edit, Close, Back, Next, Search, Loading, OK, Yes, No, Update, Add, Remove, View, Actions, Status, Success, Error, Details, Filter, Help), you MUST assign a key under the 'common' namespace (e.g. 'common.save', 'common.cancel', 'common.submit', 'common.edit', 'common.delete', 'common.search', 'common.loading', 'common.ok', 'common.close') or reuse an existing key from the dictionary. Do NOT create duplicate keys for common values.",
            "3. If the string is inside a React Component or Hook, provide neededHook: 'const { t } = useTranslation();' (it will be injected at the top of the enclosing component).",
            "4. If the string is in a top-level module constant, table columns array, or utility outside any React component (e.g. 'const columns = [...]'), use t('...') in the replacement and provide neededImport: 'import { useTranslation } from 'react-i18next';', but set neededHook to '' (empty string).",
            "5. Notification & Toast Functions: In calls like showNotification(type, title, message) or showToast(type, message), the 1st argument (e.g. 'warn', 'warning', 'error', 'info', 'success') is the status type and MUST NOT be localized. Keep status strings as raw strings.",
            "6. Replacement Syntax:",
            "   - In JS object properties (e.g. title: '...'): use t('key') WITHOUT outer JSX braces.",
            "   - In JSX children (e.g. >...<): use {t('key')}.",
            "   - In JSX attributes (e.g. placeholder='...'): use t('key').",
            "7. Do NOT include surrounding property names or keys in 'replacement'.",
            "8. Output valid JSON only with NO markdown fences or commentary.",
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

                const parsedResult = parseModelJsonResponse(accumulated);
                const rawReplacement = parsedResult && parsedResult.replacement
                    ? parsedResult.replacement
                    : accumulated;

                const replacement = formatReplacement(rawReplacement, document, range);
                if (!replacement) {
                    vscode.window.showWarningMessage("Copilot did not return a valid replacement.");
                    return false;
                }

                const key = (parsedResult && parsedResult.key) || extractKeyFromExpression(replacement);
                const value = (parsedResult && parsedResult.value) || targetText;

                const edit = new vscode.WorkspaceEdit();

                // 1. Ensure missing hook and import are injected
                await ensureTranslationsInDocument(
                    document,
                    edit,
                    [range.start.line],
                    parsedResult ? parsedResult.neededImport : null,
                    parsedResult ? parsedResult.neededHook : null,
                );

                // 2. Replace hardcoded string inline
                edit.replace(document.uri, range, replacement);
                const applied = await vscode.workspace.applyEdit(edit);

                if (!applied) {
                    vscode.window.showErrorMessage("Failed to apply localization edit to document.");
                    return false;
                }

                // 3. Auto-update en.json only
                let dictMessage = "";
                if (autoUpdateDict && key && value) {
                    const dictRes = await addEntriesToDictionaries([{ key, value }]);
                    if (dictRes.primaryUpdated) {
                        dictMessage = ` & added "${key}" to en.json`;
                    }
                }

                vscode.window.showInformationMessage(
                    `Localized "${targetText}" -> ${replacement}${dictMessage}`,
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

        const existingCommonEntries = Object.entries(dictContext.existingKeysMap || {})
            .filter(([k]) => k.startsWith("common."))
            .slice(0, 30)
            .map(([k, v]) => `  "${k}": "${v}"`)
            .join("\n");

        const prompt = [
            `You are an expert internationalization (i18n) and localization assistant in a ${document.languageId} codebase.`,
            `Your task is to provide localization replacements for all ${items.length} hardcoded strings detected in the file, along with their dictionary keys for en.json, English values, and standard useTranslation hook declarations.`,
            "",
            dictContext.namespaces.length > 0
                ? `Available dictionary namespaces in en.json: ${dictContext.namespaces.join(", ")}`
                : "",
            existingCommonEntries
                ? `Existing common keys in en.json (reuse these when applicable instead of creating duplicates):\n{\n${existingCommonEntries}\n}`
                : "",
            dictContext.sampleSnippet ? `Sample en.json structure:\n${dictContext.sampleSnippet}` : "",
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
            "Strict Rules & Guidelines:",
            "1. Strict Hook Requirement: You MUST strictly use 'const { t } = useTranslation();' and 'import { useTranslation } from 'react-i18next';'. Do NOT use any other hook or format (never use useTranslations, useIntl, or formatMessage).",
            "2. Common Values & Deduplication: For common reusable action words and UI labels (such as Save, Cancel, Submit, Delete, Edit, Close, Back, Next, Search, Loading, OK, Yes, No, Update, Add, Remove, View, Actions, Status, Success, Error, Details, Filter, Help), you MUST assign a key under the 'common' namespace (e.g. 'common.save', 'common.cancel', 'common.submit', 'common.edit', 'common.delete', 'common.search', 'common.loading', 'common.ok', 'common.close') or reuse an existing key from the dictionary. Do NOT create duplicate keys for common values.",
            "3. If strings are inside React components or hooks, provide neededHook: 'const { t } = useTranslation();' (it will be injected at the top of enclosing component functions). If all strings are in module-level constants or non-components, set neededHook to '' (empty string).",
            "4. Notification & Toast Functions: In calls like showNotification(type, title, message) or showToast(type, message), the 1st argument (e.g. 'warn', 'warning', 'error', 'info', 'success') is the status type and MUST NOT be localized. Keep status strings as raw strings.",
            "5. Replacement Syntax:",
            "   - In JS object properties (e.g. title: '...'): use t('key') WITHOUT outer JSX braces.",
            "   - In JSX children (e.g. >...<): use {t('key')}.",
            "   - In JSX attributes (e.g. placeholder='...'): use t('key').",
            "6. Output ONLY the JSON object. Do NOT include markdown fences or commentary.",
            "7. Ensure valid JSON syntax matching the schema.",
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

                const parsedBatch = parseModelJsonResponse(accumulated);
                const parsedItems = parsedBatch && Array.isArray(parsedBatch.items)
                    ? parsedBatch.items
                    : Array.isArray(parsedBatch)
                      ? parsedBatch
                      : [];

                const replacementMap = new Map();
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
                const dictionaryEntries = [];
                const targetLines = [];

                for (const item of sortedItems) {
                    const entry = replacementMap.get(item.id);
                    const rawReplacement = entry ? entry.replacement : null;
                    if (rawReplacement) {
                        const replacement = formatReplacement(rawReplacement, document, item.range);
                        if (replacement) {
                            edit.replace(document.uri, item.range, replacement);
                            appliedCount++;
                            targetLines.push(item.range.start.line);

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

                // Ensure missing imports and hooks are injected for all affected components
                await ensureTranslationsInDocument(
                    document,
                    edit,
                    targetLines,
                    parsedBatch ? parsedBatch.neededImport : null,
                    parsedBatch ? parsedBatch.neededHook : null,
                );

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
    parseModelJsonResponse,
    formatReplacement,
    extractKeyFromExpression,
    getSurroundingContext,
    detectI18nSetup,
    isFileMissingImport,
    injectImportStatement,
    findEnclosingComponent,
    injectHookIntoComponent,
    ensureTranslationsInDocument,
    localizeWithCopilot,
    localizeAllInDocument,
};