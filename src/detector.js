const vscode = require("vscode");
const {
    ATTRIBUTE_PATTERN,
    TEXT_PATTERN,
    OBJECT_PROPERTY_PATTERN,
    NOTIFICATION_FUNCTION_PATTERN,
    DEFAULT_ATTRIBUTES,
    DEFAULT_OBJECT_PROPERTIES,
    DEFAULT_TAGS,
    CONFIG_SECTION,
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
    "danger",
    "alert",
    "notice",
    "critical",
    "primary",
    "secondary",
]);

const IGNORED_PROGRAMMING_IDENTIFIERS = new Set([
    "Promise",
    "Observable",
    "Subscription",
    "Subject",
    "BehaviorSubject",
    "AxiosResponse",
    "AxiosRequestConfig",
    "AxiosError",
    "Array",
    "ReadonlyArray",
    "Record",
    "Set",
    "Map",
    "WeakMap",
    "WeakSet",
    "Object",
    "Function",
    "Boolean",
    "Number",
    "String",
    "Symbol",
    "BigInt",
    "Date",
    "RegExp",
    "Error",
    "ReactNode",
    "ReactElement",
    "ReactChild",
    "ReactFragment",
    "ReactPortal",
    "JSX",
    "FC",
    "FunctionComponent",
    "Component",
    "PureComponent",
    "ComponentType",
    "PropsWithChildren",
    "RefObject",
    "MutableRefObject",
    "Element",
    "HTMLElement",
    "HTMLDivElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLSpanElement",
    "HTMLAnchorElement",
    "HTMLFormElement",
    "SVGElement",
    "Document",
    "Window",
    "Node",
    "Event",
    "SyntheticEvent",
    "MouseEvent",
    "ChangeEvent",
    "FormEvent",
    "KeyboardEvent",
    "Partial",
    "Required",
    "Readonly",
    "Pick",
    "Omit",
    "Exclude",
    "Extract",
    "NonNullable",
    "Parameters",
    "ConstructorParameters",
    "ReturnType",
    "InstanceType",
    "Awaited",
    "any",
    "unknown",
    "never",
    "void",
    "null",
    "undefined",
    "boolean",
    "number",
    "string",
    "symbol",
    "bigint",
    "object",
    "true",
    "false",
]);

/**
 * Retrieves custom configuration rules and ignored items from VS Code settings.
 * @returns {{
 *   customAttributes: string[],
 *   customProperties: string[],
 *   customTags: string[],
 *   ignoredWords: Set<string>,
 *   ignoredAttributes: Set<string>,
 *   ignoredProperties: Set<string>,
 *   ignoredTags: Set<string>
 * }}
 */
function getCustomRules() {
    try {
        if (vscode && vscode.workspace) {
            const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
            const customAttributes = config.get("customAttributes", []) || [];
            const customProperties = config.get("customProperties", []) || [];
            const customTags = config.get("customTags", []) || [];
            const customWords = config.get("customWords", []) || [];
            const ignoredWordsArray = config.get("ignoredWords", []) || [];
            const ignoredAttributesArray = config.get("ignoredAttributes", []) || [];
            const ignoredPropertiesArray = config.get("ignoredProperties", []) || [];
            const ignoredTagsArray = config.get("ignoredTags", []) || [];

            return {
                customAttributes: Array.isArray(customAttributes) ? customAttributes : [],
                customProperties: Array.isArray(customProperties) ? customProperties : [],
                customTags: Array.isArray(customTags) ? customTags : [],
                customWords: new Set(customWords.map(w => String(w).trim())),
                ignoredWords: new Set(ignoredWordsArray.map(w => String(w).trim())),
                ignoredAttributes: new Set(ignoredAttributesArray.map(a => String(a).trim().toLowerCase())),
                ignoredProperties: new Set(ignoredPropertiesArray.map(p => String(p).trim().toLowerCase())),
                ignoredTags: new Set(ignoredTagsArray.map(t => String(t).trim().toLowerCase())),
            };
        }
    } catch {
        // fallback
    }

    return {
        customAttributes: [],
        customProperties: [],
        customTags: [],
        customWords: new Set(),
        ignoredWords: new Set(),
        ignoredAttributes: new Set(),
        ignoredProperties: new Set(),
        ignoredTags: new Set(),
    };
}

/**
 * Escapes special regex characters in user-provided identifier strings.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compiles dynamic regex patterns based on active built-in and user-configured rules.
 * @param {ReturnType<typeof getCustomRules>} [rules]
 * @returns {{
 *   attrPattern: RegExp | null,
 *   propPattern: RegExp | null,
 *   rules: ReturnType<typeof getCustomRules>
 * }}
 */
function getCompiledPatterns(rules = null) {
    const activeRules = rules || getCustomRules();

    const attrs = Array.from(
        new Set([...DEFAULT_ATTRIBUTES, ...activeRules.customAttributes])
    ).filter(attr => !activeRules.ignoredAttributes.has(attr.toLowerCase()));

    const attrPattern = attrs.length > 0
        ? new RegExp(`\\b(${attrs.map(escapeRegex).join("|")})\\s*=\\s*(["'])([^"']+)\\2`, "gi")
        : null;

    const props = Array.from(
        new Set([...DEFAULT_OBJECT_PROPERTIES, ...activeRules.customProperties])
    ).filter(prop => !activeRules.ignoredProperties.has(prop.toLowerCase()));

    const propPattern = props.length > 0
        ? new RegExp("\\b(" + props.map(escapeRegex).join("|") + ")\\s*:\\s*([\"'`])([^\"'`]+)\\2", "gi")
        : null;

    return {
        attrPattern,
        propPattern,
        rules: activeRules,
    };
}

/**
 * Checks if a string value should be ignored (e.g. URLs, colors, IDs, punctuation, identifiers, etc.).
 * @param {string} value
 * @param {ReturnType<typeof getCustomRules>} [rules]
 * @param {boolean} [isLabelContext]
 * @returns {boolean}
 */
function ignoredValue(value, rules = null, isLabelContext = false) {
    if (!value || typeof value !== "string") return true;
    const trimmed = value.trim();
    if (trimmed.length < 2) return true;

    // Never ignore if explicitly in customWords
    if (rules && rules.customWords && (rules.customWords.has(trimmed) || rules.customWords.has(value))) {
        return false;
    }

    if (rules && rules.ignoredWords) {
        if (rules.ignoredWords.has(trimmed) || rules.ignoredWords.has(value)) {
            return true;
        }
    }

    if (IGNORED_PROGRAMMING_IDENTIFIERS.has(trimmed)) return true;
    if (NOTIFICATION_STATUS_KEYWORDS.has(trimmed.toLowerCase())) return true;

    // In direct UI label/attribute contexts, do not ignore user-facing words
    if (isLabelContext) {
        return (
            /^https?:\/\//i.test(trimmed) ||
            /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
            /^[{}$()[\]\\/_.:0-9%+-]+$/.test(trimmed) ||
            /\$\{/.test(trimmed)
        );
    }

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
 * @returns {number} Index of // or -1 if none
 */
function getCommentIndexInLine(lineText) {
    let inQuote = null;
    for (let i = 0; i < lineText.length - 1; i++) {
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
 * Verifies whether a colon (:) is actually part of a ternary expression `? ... : ...`
 * by scanning backwards on the line for an unmatched question mark (?).
 * @param {string} lineText
 * @param {number} colonIndex
 * @returns {boolean} True if part of a ternary expression, False if object property / type annotation
 */
function isTernaryColon(lineText, colonIndex) {
    let inQuote = null;
    let depth = 0;
    let foundQuestion = false;

    for (let i = 0; i < colonIndex; i++) {
        const char = lineText[i];
        if (inQuote) {
            if (char === inQuote && lineText[i - 1] !== "\\") {
                inQuote = null;
            }
        } else if (char === '"' || char === "'" || char === "`") {
            inQuote = char;
        } else if (char === "{" || char === "(" || char === "[") {
            depth++;
        } else if (char === "}" || char === ")" || char === "]") {
            depth = Math.max(0, depth - 1);
        } else if (char === "?" && lineText[i + 1] !== "?" && lineText[i + 1] !== ".") {
            foundQuestion = true;
        }
    }

    return foundQuestion;
}

/**
 * Finds hardcoded ranges in a single line of text matching attributes, JSX text, and object properties.
 * @param {string} lineText
 * @param {ReturnType<typeof getCustomRules>} [customRules]
 * @returns {Array<{ start: number, end: number, message: string }>}
 */
function findHardcodedRangesInLine(lineText, customRules = null) {
    const hits = [];
    const trimmedLine = lineText.trim();
    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*") || trimmedLine.startsWith("*")) {
        return hits;
    }

    // Ignore pure TypeScript type/interface declarations and method/return type signatures
    if (
        /^\s*(?:export\s+)?(?:default\s+)?(?:type\s+[A-Za-z0-9_$]+(?:\s*<[^>]*>)?\s*=|interface\s+[A-Za-z0-9_$]+)/.test(lineText) ||
        /=>\s*[A-Za-z0-9_$]+</.test(lineText)
    ) {
        return hits;
    }

    const commentIndex = getCommentIndexInLine(lineText);
    const { attrPattern, propPattern, rules } = getCompiledPatterns(customRules);

    let match;
    if (attrPattern) {
        attrPattern.lastIndex = 0;
        while ((match = attrPattern.exec(lineText))) {
            if (commentIndex !== -1 && match.index >= commentIndex) break;
            const attrName = match[1];
            if (rules.ignoredAttributes.has(attrName.toLowerCase())) continue;
            const value = match[3];
            const quote = match[2];
            const isLabel = /^(?:label|labelText|aria-label|title|placeholder|buttonText|helperText|headerText|headerTitle|caption)$/i.test(attrName);
            if (!ignoredValue(value, rules, isLabel) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
                const quotedStr = quote + value + quote;
                const quoteStart = match.index + match[0].lastIndexOf(quotedStr);
                const start = quoteStart !== -1 ? quoteStart : match.index + match[0].lastIndexOf(value);
                const end = start + (quoteStart !== -1 ? quotedStr.length : value.length);
                hits.push({
                    start,
                    end,
                    message: `Hardcoded text in "${attrName}" attribute: "${value}". Use t("...") instead.`,
                });
            }
        }
    }

    TEXT_PATTERN.lastIndex = 0;
    while ((match = TEXT_PATTERN.exec(lineText))) {
        if (commentIndex !== -1 && match.index >= commentIndex) break;
        const value = match[1].trim();

        // Check if preceding tag is an ignored tag e.g. <code>, <pre>
        const beforeMatch = lineText.slice(0, match.index);
        const tagMatch = beforeMatch.match(/<([A-Za-z][\w.-]*)[^>]*$/);
        const tagName = tagMatch ? tagMatch[1].toLowerCase() : "";
        if (tagName && rules.ignoredTags.has(tagName)) {
            continue;
        }

        // Verify that the preceding `>` is preceded by a JSX tag or is the start of the line
        const hasPrecedingJsxTag =
            beforeMatch.trim().length === 0 ||
            /<(?:\/?[A-Za-z][\w.-]*(?:\s+[^>]*)?|>)\s*$/.test(beforeMatch);

        if (hasPrecedingJsxTag && !ignoredValue(value, rules, true) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
            const start = match.index + match[0].indexOf(match[1]);
            hits.push({
                start,
                end: start + match[1].length,
                message: `Hardcoded JSX text: "${value}". Use t("...") instead.`,
            });
        }
    }

    if (propPattern) {
        propPattern.lastIndex = 0;
        while ((match = propPattern.exec(lineText))) {
            if (commentIndex !== -1 && match.index >= commentIndex) break;
            const propName = match[1];
            if (rules.ignoredProperties.has(propName.toLowerCase())) continue;
            const value = match[3];
            const quote = match[2];
            const isLabelProp = /^(?:label|labelText|title|placeholder|buttonText|helperText|headerText|headerTitle|caption|text|message)$/i.test(propName);
            if (!ignoredValue(value, rules, isLabelProp) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
                const quotedStr = quote + value + quote;
                const quoteStart = match.index + match[0].lastIndexOf(quotedStr);
                const start = quoteStart !== -1 ? quoteStart : match.index + match[0].lastIndexOf(value);
                const end = start + (quoteStart !== -1 ? quotedStr.length : value.length);
                hits.push({
                    start,
                    end,
                    message: `Hardcoded value for "${propName}": "${value}". Use t("...") instead.`,
                });
            }
        }
    }

    // Conditional / Ternary string returns in JSX or JS (e.g. `? "Submit"`, `: "Save"`, `&& "Loading..."`, `|| "Default"`, `?? "Fallback"`, `{"Text"}`)
    if (!/^\s*(?:import|export|require)\b/.test(trimmedLine)) {
        const CONDITIONAL_STRING_PATTERN = /(?:(?:\?|\&\&|\|\||\?\?|:)\s*|\{\s*)(["'`])([^"'`\n]+)\1/g;
        let condMatch;
        while ((condMatch = CONDITIONAL_STRING_PATTERN.exec(lineText))) {
            if (commentIndex !== -1 && condMatch.index >= commentIndex) break;

            const matchedOperator = condMatch[0].trim();
            // If the matched operator is ':', verify it is actually a ternary branch and not an object property/type annotation
            if (matchedOperator.startsWith(":") && !isTernaryColon(lineText, condMatch.index)) {
                continue;
            }

            const value = condMatch[2].trim();
            const quote = condMatch[1];
            if (!value || ignoredValue(value, rules) || /(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
                continue;
            }

            // Skip if preceded by equality/relational comparison operators (===, !==, ==, !=, <=, >=) or switch case
            const prefix = lineText.slice(0, condMatch.index).trim();
            if (/[=!<>]=\s*$/.test(prefix) || /\bcase\s*$/.test(prefix)) {
                continue;
            }

            const quotedStr = quote + condMatch[2] + quote;
            const quoteStart = condMatch.index + condMatch[0].lastIndexOf(quotedStr);
            const start = quoteStart !== -1 ? quoteStart : condMatch.index;
            const end = start + quotedStr.length;

            if (!hits.some(h => (start >= h.start && start < h.end) || (end > h.start && end <= h.end))) {
                hits.push({
                    start,
                    end,
                    message: `Hardcoded string: "${value}". Use t("...") instead.`,
                });
            }
        }
    }

    // Explicit custom words matching
    if (rules.customWords && rules.customWords.size > 0) {
        rules.customWords.forEach(word => {
            if (!word) return;
            const escaped = escapeRegex(word);
            const wordRegex = new RegExp("([\"'`])(" + escaped + ")\\1", "g");
            let wMatch;
            while ((wMatch = wordRegex.exec(lineText))) {
                if (commentIndex !== -1 && wMatch.index >= commentIndex) break;
                const start = wMatch.index;
                const end = start + wMatch[0].length;
                if (!hits.some(h => (start >= h.start && start < h.end) || (end > h.start && end <= h.end))) {
                    hits.push({
                        start,
                        end,
                        message: `Hardcoded text: "${word}". Use t("...") instead.`,
                    });
                }
            }
        });
    }

    return hits;
}

/**
 * Finds hardcoded strings in notification and toast function calls across full (multiline) document text.
 * @param {string} fullText
 * @param {ReturnType<typeof getCustomRules>} [customRules]
 * @returns {Array<{ startOffset: number, endOffset: number, message: string }>}
 */
function findNotificationHits(fullText, customRules = null) {
    const rules = customRules || getCustomRules();
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

            // In notification and toast functions (e.g. showNotification, showToast, notify),
            // when multiple arguments exist (args.length > 1), the first argument is ALWAYS
            // the severity/type keyword (e.g. 'warn', 'error', 'info', 'success') and must NEVER be flagged or localized.
            let startArgIndex = args.length > 1 ? 1 : 0;
            if (startArgIndex === 0 && args.length === 1) {
                const firstArgClean = args[0].text.trim().replace(/^["'`]|["'`]$/g, "").toLowerCase();
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

                    if (!ignoredValue(value, rules)) {
                        const start = argsStartOffset + arg.offset + quoteIndexInArg;
                        const end = start + strMatch[0].length;
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
    // Closing angle bracket of an opening JSX tag (e.g. `<h3 className="...">`, `<Button`, `>`)
    if (/(?<![=\->])>\s*$/.test(trimmed)) {
        return true;
    }
    // Opening JSX tag on single line without closed bracket or self-closing
    if (/^<[A-Za-z][\w.-]*/.test(trimmed)) {
        return true;
    }
    // Self-closing JSX tag
    if (/\/>\s*$/.test(trimmed)) return true;
    // Closing JSX tag e.g. `</h3>` or `</Button>`
    if (/^<\/[A-Za-z][\w.-]*>\s*$/.test(trimmed)) return true;
    // JSX expression boundary `{` or `}`
    if (/^\{\s*$/.test(trimmed) || /^\}\s*$/.test(trimmed)) return true;
    return false;
}

/**
 * Checks if the line is inside an unclosed JSX opening tag (e.g. within multiline props before closing `>`).
 * @param {import("vscode").TextDocument} document
 * @param {number} lineNumber
 * @returns {boolean}
 */
function isInsideJsxOpeningTag(document, lineNumber) {
    for (let i = lineNumber - 1; i >= 0; i--) {
        const text = document.lineAt(i).text.trim();
        if (!text) continue;
        // If line ends with `>` (and is not an arrow `=>` or comparison), we reached the end of the opening tag
        if (/(?<![=\->])>\s*$/.test(text) || /\/>\s*$/.test(text)) {
            return false;
        }
        // If line is a closing tag e.g. `</div>`, we are outside opening tag
        if (/^<\/[A-Za-z][\w.-]*/.test(text)) {
            return false;
        }
        // If line starts an opening tag and does NOT end with `>`, we are inside its props
        if (/^<[A-Za-z][\w.-]*(\s|$)/.test(text) && !/(?<![=\->])>\s*$/.test(text)) {
            return true;
        }
    }

    return false;
}

/**
 * Detects hardcoded standalone text lines within JSX structures.
 * @param {import("vscode").TextDocument} document
 * @param {number} lineNumber
 * @param {ReturnType<typeof getCustomRules>} [customRules]
 * @returns {{ start: number, end: number, message: string } | null}
 */
function findStandaloneJsxTextRange(document, lineNumber, customRules = null) {
    const rules = customRules || getCustomRules();
    const lineText = document.lineAt(lineNumber).text;
    const value = lineText.trim();

    if (
        !value ||
        !/[A-Za-z]/.test(value) ||
        ignoredValue(value, rules) ||
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

    // Check if inside ignored tag e.g. <pre>, <code>
    const prevTagMatch = previous.match(/<([A-Za-z][\w.-]*)/);
    if (prevTagMatch && rules.ignoredTags.has(prevTagMatch[1].toLowerCase())) {
        return null;
    }

    const start = lineText.indexOf(value);
    return {
        start,
        end: start + value.length,
        message: `Hardcoded JSX text: "${value}". Use t("...") instead.`,
    };
}

module.exports = {
    getCustomRules,
    getCompiledPatterns,
    escapeRegex,
    ignoredValue,
    parseFunctionArguments,
    findHardcodedRangesInLine,
    findNotificationHits,
    getNearestNonEmptyLine,
    isJsxBoundary,
    isInsideJsxOpeningTag,
    findStandaloneJsxTextRange,
};
