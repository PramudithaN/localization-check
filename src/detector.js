const {
    ATTRIBUTE_PATTERN,
    TEXT_PATTERN,
    OBJECT_PROPERTY_PATTERN,
    NOTIFICATION_FUNCTION_PATTERN,
} = require("./constants");

const NOTIFICATION_STATUS_KEYWORDS = new Set([
    "error",
    "success",
    "info",
    "warning",
    "warn",
    "loading",
    "default",
    "open",
]);

/**
 * Checks if a string value should be ignored (e.g. URLs, colors, IDs, punctuation, identifiers, etc.).
 * @param {string} value
 * @returns {boolean}
 */
function ignoredValue(value) {
    if (!value || typeof value !== "string") return true;
    const trimmed = value.trim();
    if (trimmed.length < 2) return true;

    return (
        /^[A-Z0-9_./:-]+$/.test(trimmed) ||
        /^https?:\/\//i.test(trimmed) ||
        /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
        /^[{}$()[\]\\/_.:0-9%+-]+$/.test(trimmed) ||
        // camelCase identifiers without whitespace (e.g. amountOrPercentageValue, feeCategoryName)
        /^[a-z]+(?:[A-Z0-9][a-z0-9]*)+$/.test(trimmed) ||
        /^[a-z][a-zA-Z0-9]*(Id|ID|Code|No|Number|Type|Key|Name|Value|Url|URL|Uri|URI|Path|Ref|Index|Status)$/.test(trimmed) ||
        // snake_case identifiers (e.g. user_id, fee_category_name)
        /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(trimmed) ||
        // kebab-case identifiers without spaces (e.g. item-container, btn-primary)
        /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(trimmed) ||
        // Dotted object property paths or config keys (e.g. settings.theme.mode)
        /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(trimmed) ||
        /\$\{/.test(trimmed)
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
    if (current.trim().length > 0) {
        args.push({ text: current, offset: startIndex });
    }
    return args;
}

/**
 * Finds the index where a line comment (//) begins, ignoring slashes inside quotes.
 * @param {string} lineText
 * @returns {number}
 */
function getCommentIndexInLine(lineText) {
    let inQuote = null;
    for (let i = 0; i < lineText.length; i++) {
        const char = lineText[i];
        if (inQuote) {
            if (char === inQuote && lineText[i - 1] !== "\\") {
                inQuote = null;
            }
        } else if (char === '"' || char === "'" || char === "`") {
            inQuote = char;
        } else if (char === "/" && lineText[i + 1] === "/") {
            return i;
        }
    }
    return -1;
}

/**
 * Finds hardcoded ranges in a single line of text matching attributes, JSX text, and object properties.
 * @param {string} lineText
 * @returns {Array<{ start: number, end: number, message: string }>}
 */
function findHardcodedRangesInLine(lineText) {
    const hits = [];
    const trimmedLine = lineText.trim();
    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*") || trimmedLine.startsWith("*")) {
        return hits;
    }

    const commentIndex = getCommentIndexInLine(lineText);

    let match;
    ATTRIBUTE_PATTERN.lastIndex = 0;
    while ((match = ATTRIBUTE_PATTERN.exec(lineText))) {
        if (commentIndex !== -1 && match.index >= commentIndex) break;
        const value = match[2];
        if (!ignoredValue(value) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
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
        if (commentIndex !== -1 && match.index >= commentIndex) break;
        const value = match[1].trim();
        if (!ignoredValue(value) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
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
        if (commentIndex !== -1 && match.index >= commentIndex) break;
        const value = match[2];
        if (!ignoredValue(value) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
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

/**
 * Finds hardcoded strings in notification and toast function calls across full (multiline) document text.
 * @param {string} fullText
 * @returns {Array<{ startOffset: number, endOffset: number, message: string }>}
 */
function findNotificationHits(fullText) {
    const hits = [];
    NOTIFICATION_FUNCTION_PATTERN.lastIndex = 0;
    let match;

    while ((match = NOTIFICATION_FUNCTION_PATTERN.exec(fullText))) {
        const fnName = match[1];
        const openParenIndex = match.index + match[0].length - 1;
        let depth = 1;
        let inQuote = null;
        let closeParenIndex = -1;

        for (let i = openParenIndex + 1; i < fullText.length; i++) {
            const char = fullText[i];
            if (inQuote) {
                if (char === inQuote && fullText[i - 1] !== "\\") {
                    inQuote = null;
                }
            } else if (char === '"' || char === "'" || char === "`") {
                inQuote = char;
            } else if (char === "/" && fullText[i + 1] === "/") {
                const nextNewline = fullText.indexOf("\n", i + 2);
                i = nextNewline !== -1 ? nextNewline : fullText.length;
            } else if (char === "/" && fullText[i + 1] === "*") {
                const closeComment = fullText.indexOf("*/", i + 2);
                i = closeComment !== -1 ? closeComment + 1 : fullText.length;
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
            const argsStr = fullText.slice(openParenIndex + 1, closeParenIndex);
            const argsStartOffset = openParenIndex + 1;
            const args = parseFunctionArguments(argsStr);

            // If the first argument is a status/type keyword, skip it and check subsequent user-facing messages
            let startArgIndex = 0;
            if (args.length > 1) {
                const firstArgClean = args[0].text.trim().replace(/^["']|["']$/g, "").toLowerCase();
                if (NOTIFICATION_STATUS_KEYWORDS.has(firstArgClean)) {
                    startArgIndex = 1;
                }
            }

            for (let i = startArgIndex; i < args.length; i++) {
                const arg = args[i];
                const trimmed = arg.text.trim();
                if (/^\s*(?:i18n\.)?t\s*\(/.test(trimmed)) continue;

                // Match quoted string literals within the argument
                const strRegex = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
                let strMatch;
                while ((strMatch = strRegex.exec(arg.text))) {
                    const value = strMatch[2];
                    const quoteIndexInArg = strMatch.index;

                    // Skip if string is inside a localization call e.g. t("...")
                    const beforeQuote = arg.text.slice(0, quoteIndexInArg);
                    if (/(?:^|\W)(?:i18n\.)?t\s*\(\s*$/.test(beforeQuote)) {
                        continue;
                    }

                    if (!ignoredValue(value)) {
                        const start = argsStartOffset + arg.offset + quoteIndexInArg + 1;
                        const end = start + value.length;
                        hits.push({
                            startOffset: start,
                            endOffset: end,
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
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (/(?<!=)>\s*$/.test(trimmed) && (/^<\/?[A-Za-z][\w.-]*(\s|>|$)/.test(trimmed) || /^<>/.test(trimmed))) {
        return true;
    }
    if (/\/>\s*$/.test(trimmed)) return true;
    if (/^<\/[A-Za-z][\w.-]*>\s*$/.test(trimmed)) return true;
    if (/^\{\s*$/.test(trimmed) || /^\}\s*$/.test(trimmed)) return true;
    return false;
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
        /(?:^|\W)(?:i18n\.)?t\s*\(/.test(value) ||
        // Ignore lines with code keywords
        /^(import|export|const|let|var|return|if|else|for|while|switch|case|function|class|type|interface|throw|try|catch|finally|break|continue|default)\b/.test(value) ||
        // Ignore lines with object properties, TS type annotations, or method calls
        /^[a-zA-Z_$][\w$]*\s*:/.test(value) ||
        /\.[a-zA-Z_$][\w$]*/.test(value) ||
        // Ignore lines with code syntax/brackets/operators
        /[<>{};=()\[\]`'"/\\]/.test(value) ||
        /[+\-*%|^&!~?:,]/.test(value) ||
        /=>/.test(value)
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
    findNotificationHits,
    getNearestNonEmptyLine,
    isJsxBoundary,
    isInsideJsxOpeningTag,
    findStandaloneJsxTextRange,
};
