const {
    ATTRIBUTE_PATTERN,
    TEXT_PATTERN,
    OBJECT_PROPERTY_PATTERN,
    NOTIFICATION_FUNCTION_PATTERN,
} = require("./constants");

/**
 * Checks if a string value should be ignored (e.g. URLs, colors, IDs, punctuation, etc.).
 * @param {string} value
 * @returns {boolean}
 */
function ignoredValue(value) {
    return (
        !value ||
        value.length < 2 ||
        /^[A-Z0-9_./:-]+$/.test(value) ||
        /^https?:\/\//.test(value) ||
        /^#[0-9a-f]{3,8}$/i.test(value) ||
        /^[{}$()[\]\\/_.:0-9-]+$/.test(value) ||
        /^[a-z][a-zA-Z0-9]*(Id|ID|Code|No|Number|Type|Key)$/.test(value) ||
        /\$\{/.test(value)
    );
}

/**
 * Splits function arguments respecting quotes and brackets.
 * @param {string} argsString
 * @returns {Array<{ text: string, offset: number }>}
 */
function parseFunctionArguments(argsString) {
    const args = [];
    let current = "";
    let inQuote = null;
    let depth = 0;
    let startIndex = 0;

    for (let i = 0; i < argsString.length; i++) {
        const char = argsString[i];
        if (inQuote) {
            current += char;
            if (char === inQuote && argsString[i - 1] !== "\\") {
                inQuote = null;
            }
        } else if (char === '"' || char === "'" || char === "`") {
            inQuote = char;
            current += char;
        } else if (char === "(" || char === "{" || char === "[") {
            depth++;
            current += char;
        } else if (char === ")" || char === "}" || char === "]") {
            depth--;
            current += char;
        } else if (char === "," && depth === 0) {
            args.push({ text: current, offset: startIndex });
            current = "";
            startIndex = i + 1;
        } else {
            current += char;
        }
    }
    if (current.trim().length > 0 || args.length > 0) {
        args.push({ text: current, offset: startIndex });
    }
    return args;
}

/**
 * Finds hardcoded ranges in a single line of text matching attributes, JSX text, and object properties.
 * @param {string} lineText
 * @returns {Array<{ start: number, end: number, message: string }>}
 */
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

    NOTIFICATION_FUNCTION_PATTERN.lastIndex = 0;
    while ((match = NOTIFICATION_FUNCTION_PATTERN.exec(lineText))) {
        const fnName = match[1];
        const openParenIndex = match.index + match[0].length - 1;
        let depth = 1;
        let inQuote = null;
        let closeParenIndex = -1;

        for (let i = openParenIndex + 1; i < lineText.length; i++) {
            const char = lineText[i];
            if (inQuote) {
                if (char === inQuote && lineText[i - 1] !== "\\") {
                    inQuote = null;
                }
            } else if (char === '"' || char === "'" || char === "`") {
                inQuote = char;
            } else if (char === "(" || char === "{" || char === "[") {
                depth++;
            } else if (char === ")" || char === "}" || char === "]") {
                depth--;
                if (depth === 0) {
                    closeParenIndex = i;
                    break;
                }
            }
        }

        if (closeParenIndex !== -1) {
            const argsStr = lineText.slice(openParenIndex + 1, closeParenIndex);
            const argsStartOffset = openParenIndex + 1;
            const args = parseFunctionArguments(argsStr);

            // Skip the first argument (type/status e.g. "error", "success", "info")
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                const trimmed = arg.text.trim();
                if (/^\s*(?:i18n\.)?t\s*\(/.test(trimmed)) continue;

                const strMatch = /^["']([^"']+)["']$/.exec(trimmed);
                if (strMatch) {
                    const value = strMatch[1];
                    if (!ignoredValue(value)) {
                        const strOffsetInArg = arg.text.indexOf(value);
                        const start = argsStartOffset + arg.offset + strOffsetInArg;
                        hits.push({
                            start,
                            end: start + value.length,
                            message: `Hardcoded text in "${fnName}" call: "${value}". Use t("...") instead.`,
                        });
                    }
                }
            }

            NOTIFICATION_FUNCTION_PATTERN.lastIndex = closeParenIndex + 1;
        }
    }

    return hits;
}

/**
 * Finds the nearest non-empty line in a document in the given direction (+1 or -1).
 * @param {import("vscode").TextDocument} document
 * @param {number} lineNumber
 * @param {number} direction
 * @returns {string}
 */
function getNearestNonEmptyLine(document, lineNumber, direction) {
    for (let i = lineNumber + direction; i >= 0 && i < document.lineCount; i += direction) {
        const text = document.lineAt(i).text.trim();
        if (text) return text;
    }

    return "";
}

/**
 * Determines if a line of text represents a JSX tag or expression boundary.
 * @param {string} text
 * @returns {boolean}
 */
function isJsxBoundary(text) {
    return /[>}\)]\s*$/.test(text) || /^<\/?[A-Za-z][\w.-]*(\s|>|$)/.test(text) || /^\{/.test(text);
}

/**
 * Checks if the line is inside an unclosed JSX opening tag.
 * @param {import("vscode").TextDocument} document
 * @param {number} lineNumber
 * @returns {boolean}
 */
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

/**
 * Detects hardcoded standalone text lines within JSX structures.
 * @param {import("vscode").TextDocument} document
 * @param {number} lineNumber
 * @returns {{ start: number, end: number, message: string } | null}
 */
function findStandaloneJsxTextRange(document, lineNumber) {
    const lineText = document.lineAt(lineNumber).text;
    const value = lineText.trim();

    if (
        !value ||
        !/[A-Za-z]/.test(value) ||
        ignoredValue(value) ||
        (/^[a-z][A-Za-z0-9]*$/.test(value) && /[A-Z]/.test(value)) ||
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

module.exports = {
    ignoredValue,
    parseFunctionArguments,
    findHardcodedRangesInLine,
    getNearestNonEmptyLine,
    isJsxBoundary,
    isInsideJsxOpeningTag,
    findStandaloneJsxTextRange,
};
