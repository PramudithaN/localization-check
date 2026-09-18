const vscode = require("vscode");
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
 * Detects hardcoded hits in full document text using AST parser.
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
        return [];
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
