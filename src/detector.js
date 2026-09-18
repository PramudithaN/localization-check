let vscode;
try {
    vscode = require("vscode");
} catch {
    // Standalone or unit test runner
}
const {
    DEFAULT_ATTRIBUTES,
    DEFAULT_OBJECT_PROPERTIES,
    DEFAULT_TAGS,
    CONFIG_SECTION,
} = require("./constants");
const {
    NOTIFICATION_STATUS_KEYWORDS,
    NOTIFICATION_FUNCTION_NAMES,
    IGNORED_COLOR_KEYWORDS,
    IGNORED_PROGRAMMING_IDENTIFIERS,
    ignoredValue,
    parseSource,
    findHardcodedHitsInAst,
    findEnclosingComponentInAst,
    inspectCodeContextAtPosition,
} = require("./ast");

/**
 * Retrieves custom configuration rules and ignored items from VS Code settings.
 * @returns {{
 *   customAttributes: string[],
 *   customProperties: string[],
 *   customTags: string[],
 *   customWords: Set<string>,
 *   ignoredWords: Set<string>,
 *   ignoredAttributes: Set<string>,
 *   ignoredProperties: Set<string>,
 *   ignoredTags: Set<string>,
 *   minimumConfidence: "low" | "medium" | "high"
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
            const minimumConfidence = config.get("minimumConfidence", "low");

            return {
                customAttributes: Array.isArray(customAttributes) ? customAttributes : [],
                customProperties: Array.isArray(customProperties) ? customProperties : [],
                customTags: Array.isArray(customTags) ? customTags : [],
                customWords: new Set(customWords.map(w => String(w).trim())),
                ignoredWords: new Set(ignoredWordsArray.map(w => String(w).trim())),
                ignoredAttributes: new Set(ignoredAttributesArray.map(a => String(a).trim().toLowerCase())),
                ignoredProperties: new Set(ignoredPropertiesArray.map(p => String(p).trim().toLowerCase())),
                ignoredTags: new Set(ignoredTagsArray.map(t => String(t).trim().toLowerCase())),
                minimumConfidence: ["low", "medium", "high"].includes(minimumConfidence) ? minimumConfidence : "low",
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
        minimumConfidence: "low",
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
 * Fallback regex scanner when AST parser encounters syntax errors (e.g. while editing in-progress code).
 * @param {string} text
 * @param {ReturnType<typeof getCustomRules>} rules
 * @returns {Array<any>}
 */
function findFallbackRegexHits(text, rules) {
    const hits = [];
    const lines = text.split(/\r?\n/);
    const attrs = Array.from(
        new Set([...DEFAULT_ATTRIBUTES, ...rules.customAttributes])
    ).filter(attr => !rules.ignoredAttributes.has(attr.toLowerCase()));

    const attrPattern = attrs.length > 0
        ? new RegExp(`\\b(${attrs.map(escapeRegex).join("|")})\\s*=\\s*(["'])([^"']+)\\2`, "gi")
        : null;

    const props = Array.from(
        new Set([...DEFAULT_OBJECT_PROPERTIES, ...rules.customProperties])
    ).filter(prop => !rules.ignoredProperties.has(prop.toLowerCase()));

    const propPattern = props.length > 0
        ? new RegExp("\\b(" + props.map(escapeRegex).join("|") + ")\\s*:\\s*([\"'`])([^\"'`]+)\\2", "gi")
        : null;

    const textPattern = /(?<![=\->])>\s*([A-Za-z][^<{]*?[A-Za-z0-9!?.,])\s*<\s*(?:\/|[A-Za-z][\w.-]*|\s*>|\s*$|\{)/g;

    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        const trimmed = lineText.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

        if (attrPattern) {
            attrPattern.lastIndex = 0;
            let match;
            while ((match = attrPattern.exec(lineText))) {
                const attrName = match[1];
                const value = match[3];
                const isLabel = /^(?:label|labelText|aria-label|title|placeholder|buttonText|helperText|headerText|headerTitle|caption)$/i.test(attrName);
                if (!ignoredValue(value, rules, isLabel) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
                    const startCol = match.index + match[0].lastIndexOf(value);
                    hits.push({
                        startLine: i,
                        startCol,
                        endLine: i,
                        endCol: startCol + value.length,
                        startOffset: 0,
                        endOffset: 0,
                        value,
                        message: `Hardcoded text in "${attrName}" attribute: "${value}". Use t("...") instead.`,
                        confidence: isLabel ? "high" : "medium",
                        type: "attribute",
                    });
                }
            }
        }

        textPattern.lastIndex = 0;
        let tMatch;
        while ((tMatch = textPattern.exec(lineText))) {
            const value = tMatch[1].trim();
            if (!ignoredValue(value, rules, true) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
                const startCol = tMatch.index + tMatch[0].indexOf(tMatch[1]);
                hits.push({
                    startLine: i,
                    startCol,
                    endLine: i,
                    endCol: startCol + tMatch[1].length,
                    startOffset: 0,
                    endOffset: 0,
                    value,
                    message: `Hardcoded JSX text: "${value}". Use t("...") instead.`,
                    confidence: "high",
                    type: "jsx_text",
                });
            }
        }

        if (propPattern) {
            propPattern.lastIndex = 0;
            let pMatch;
            while ((pMatch = propPattern.exec(lineText))) {
                const propName = pMatch[1];
                const value = pMatch[3];
                const isLabelProp = /^(?:label|labelText|title|placeholder|buttonText|helperText|headerText|headerTitle|caption|text|message)$/i.test(propName);
                if (!ignoredValue(value, rules, isLabelProp) && !/(?:^|\W)(?:i18n\.)?t\s*\(/.test(value)) {
                    const startCol = pMatch.index + pMatch[0].lastIndexOf(value);
                    hits.push({
                        startLine: i,
                        startCol,
                        endLine: i,
                        endCol: startCol + value.length,
                        startOffset: 0,
                        endOffset: 0,
                        value,
                        message: `Hardcoded value for "${propName}": "${value}". Use t("...") instead.`,
                        confidence: isLabelProp ? "high" : "medium",
                        type: "property",
                    });
                }
            }
        }
    }

    return hits;
}

/**
 * Detects hardcoded hits in full document text using AST parser with fallback.
 * @param {string} text
 * @param {string} [filename]
 * @param {ReturnType<typeof getCustomRules>} [customRules]
 * @returns {Array<{
 *   startLine: number,
 *   startCol: number,
 *   endLine: number,
 *   endCol: number,
 *   startOffset: number,
 *   endOffset: number,
 *   message: string,
 *   value: string,
 *   confidence: "high" | "medium" | "low",
 *   type: string
 * }>}
 */
function findHardcodedHits(text, filename = "document.tsx", customRules = null) {
    if (!text || typeof text !== "string") return [];
    const rules = customRules || getCustomRules();

    const { ast, error } = parseSource(text, filename);
    if (!ast) {
        return findFallbackRegexHits(text, rules);
    }

    return findHardcodedHitsInAst(ast, rules);
}

module.exports = {
    NOTIFICATION_STATUS_KEYWORDS,
    NOTIFICATION_FUNCTION_NAMES,
    IGNORED_COLOR_KEYWORDS,
    IGNORED_PROGRAMMING_IDENTIFIERS,
    getCustomRules,
    escapeRegex,
    ignoredValue,
    parseSource,
    findHardcodedHits,
    findHardcodedHitsInAst,
    findEnclosingComponentInAst,
    inspectCodeContextAtPosition,
};
