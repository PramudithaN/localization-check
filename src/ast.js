const { parse } = require("@babel/parser");
const traverseModule = require("@babel/traverse");
const traverse = traverseModule.default || traverseModule;
const {
    DEFAULT_ATTRIBUTES,
    DEFAULT_OBJECT_PROPERTIES,
    DEFAULT_TAGS,
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

const NOTIFICATION_FUNCTION_NAMES = new Set([
    "showNotification",
    "showToast",
    "notify",
    "displayNotification",
    "openNotification",
]);

const IGNORED_COLOR_KEYWORDS = new Set([
    "red", "green", "blue", "yellow", "orange", "purple", "pink", "black",
    "white", "gray", "grey", "cyan", "magenta", "lime", "gold", "silver",
    "teal", "navy", "maroon", "olive", "brown", "violet", "indigo",
    "transparent", "inherit", "currentcolor", "geekblue", "volcano",
    "processing", "darkred", "darkgreen", "darkblue", "lightblue",
    "lightgreen", "lightgray", "lightgrey", "darkgray", "darkgrey",
    "crimson", "coral", "salmon", "turquoise", "aqua", "fuchsia",
    "azure", "beige", "lavender", "plum", "khaki", "amber", "emerald",
    "rose", "slate", "zinc", "neutral", "stone", "sky",
]);

const IGNORED_PROGRAMMING_IDENTIFIERS = new Set([
    "Promise", "Observable", "Subscription", "Subject", "BehaviorSubject",
    "AxiosResponse", "AxiosRequestConfig", "AxiosError", "Array", "ReadonlyArray",
    "Record", "Set", "Map", "WeakMap", "WeakSet", "Object", "Function", "Boolean",
    "Number", "String", "Symbol", "BigInt", "Date", "RegExp", "Error", "ReactNode",
    "ReactElement", "ReactChild", "ReactFragment", "ReactPortal", "JSX", "FC",
    "FunctionComponent", "Component", "PureComponent", "ComponentType",
    "PropsWithChildren", "RefObject", "MutableRefObject", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSpanElement",
    "HTMLAnchorElement", "HTMLFormElement", "SVGElement", "Document", "Window",
    "Node", "Event", "SyntheticEvent", "MouseEvent", "ChangeEvent", "FormEvent",
    "KeyboardEvent", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude",
    "Extract", "NonNullable", "Parameters", "ConstructorParameters", "ReturnType",
    "InstanceType", "Awaited", "any", "unknown", "never", "void", "null", "undefined",
    "boolean", "number", "string", "symbol", "bigint", "object", "true", "false",
]);

const STYLING_OR_TECHNICAL_PROPS = new Set([
    "color", "bg", "backgroundColor", "borderColor", "fill", "stroke",
    "variant", "size", "shape", "type", "target", "rel", "name", "id", "key",
    "className", "style", "data-testid", "testId", "align", "justify",
]);

/**
 * Checks if a string value should be ignored (e.g. URLs, colors, IDs, punctuation, identifiers, etc.).
 * @param {string} value
 * @param {any} [rules]
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
    if (IGNORED_COLOR_KEYWORDS.has(trimmed.toLowerCase())) return true;
    if (/^(?:rgba?|hsla?)\s*\(/.test(trimmed)) return true;
    if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(trimmed)) return true;

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
        // camelCase identifiers without whitespace
        /^[a-z]+(?:[A-Z0-9][a-z0-9]*)+$/.test(trimmed) ||
        /^[a-z][a-zA-Z0-9]*(Id|ID|Code|No|Number|Type|Key|Name|Value|Url|URL|Uri|URI|Path|Ref|Index|Status)$/.test(trimmed) ||
        // snake_case identifiers
        /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(trimmed) ||
        // kebab-case identifiers without spaces
        /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(trimmed) ||
        // Dotted object property paths or config keys
        /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(trimmed) ||
        /\$\{/.test(trimmed)
    );
}

/**
 * Parses source code into a Babel AST with error recovery.
 * @param {string} code
 * @param {string} [filename]
 * @returns {{ ast: any | null, error: any | null }}
 */
function parseSource(code, filename = "source.tsx") {
    try {
        const ast = parse(code, {
            sourceType: "module",
            sourceFilename: filename,
            allowReturnOutsideFunction: true,
            allowAwaitOutsideFunction: true,
            allowImportExportEverywhere: true,
            errorRecovery: true,
            plugins: [
                "jsx",
                "typescript",
                "decorators-legacy",
                "classProperties",
                "classPrivateProperties",
                "classPrivateMethods",
                "exportDefaultFrom",
                "dynamicImport",
                "nullishCoalescingOperator",
                "optionalChaining",
                "objectRestSpread",
                "asyncGenerators",
            ],
        });
        return { ast, error: null };
    } catch (err) {
        return { ast: null, error: err };
    }
}

/**
 * Helper to extract tag name from JSXOpeningElement.
 * @param {any} openingElement
 * @returns {string}
 */
function getJsxTagName(openingElement) {
    if (!openingElement || !openingElement.name) return "";
    const nameNode = openingElement.name;
    if (nameNode.type === "JSXIdentifier") return nameNode.name;
    if (nameNode.type === "JSXMemberExpression") {
        return `${nameNode.object.name}.${nameNode.property.name}`;
    }
    return "";
}

/**
 * Helper to extract function call name from CallExpression.
 * @param {any} callNode
 * @returns {string}
 */
function getCallFunctionName(callNode) {
    if (!callNode || !callNode.callee) return "";
    const callee = callNode.callee;
    if (callee.type === "Identifier") return callee.name;
    if (callee.type === "MemberExpression") {
        if (callee.property && callee.property.name) {
            return callee.property.name;
        }
    }
    return "";
}

/**
 * Checks if an expression is already localized via t(...) or formatMessage(...).
 * @param {any} path
 * @returns {boolean}
 */
function isInsideLocalizationCall(path) {
    let current = path;
    while (current) {
        if (current.isCallExpression()) {
            const fnName = getCallFunctionName(current.node);
            if (fnName === "t" || fnName === "formatMessage") {
                return true;
            }
        }
        current = current.parentPath;
    }
    return false;
}

/**
 * Calculates exact line/column coordinates for a trimmed substring within a multiline/single-line node.
 * @param {any} loc
 * @param {string} rawText
 * @param {string} subText
 * @returns {{ startLine: number, startCol: number, endLine: number, endCol: number }}
 */
function calculateSubTextLoc(loc, rawText, subText) {
    const offset = rawText.indexOf(subText);
    if (offset === -1 || !loc) {
        return {
            startLine: loc ? loc.start.line - 1 : 0,
            startCol: loc ? loc.start.column : 0,
            endLine: loc ? loc.end.line - 1 : 0,
            endCol: loc ? loc.end.column : 0,
        };
    }

    const before = rawText.slice(0, offset);
    const beforeLines = before.split(/\r?\n/);
    const startLine = (loc.start.line - 1) + (beforeLines.length - 1);
    const startCol = beforeLines.length === 1 ? loc.start.column + before.length : beforeLines[beforeLines.length - 1].length;

    const subLines = subText.split(/\r?\n/);
    const endLine = startLine + (subLines.length - 1);
    const endCol = subLines.length === 1 ? startCol + subText.length : subLines[subLines.length - 1].length;

    return { startLine, startCol, endLine, endCol };
}

/**
 * Traverses an AST and detects all hardcoded strings.
 * @param {any} ast
 * @param {any} [rules]
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
function findHardcodedHitsInAst(ast, rules = null) {
    const hits = [];
    if (!ast) return hits;

    const customAttrs = rules && rules.customAttributes ? rules.customAttributes : [];
    const ignoredAttrs = rules && rules.ignoredAttributes ? rules.ignoredAttributes : new Set();
    const activeAttrs = new Set(
        [...DEFAULT_ATTRIBUTES, ...customAttrs].map(a => a.toLowerCase())
    );

    const customProps = rules && rules.customProperties ? rules.customProperties : [];
    const ignoredProps = rules && rules.ignoredProperties ? rules.ignoredProperties : new Set();
    const activeProps = new Set(
        [...DEFAULT_OBJECT_PROPERTIES, ...customProps].map(p => p.toLowerCase())
    );

    const customTags = rules && rules.customTags ? rules.customTags : [];
    const ignoredTags = rules && rules.ignoredTags ? rules.ignoredTags : new Set(["code", "pre", "script", "style"]);

    traverse(ast, {
        JSXAttribute(path) {
            const attrName = path.node.name ? (path.node.name.name || "") : "";
            if (!attrName || ignoredAttrs.has(attrName.toLowerCase())) return;

            const isKnownAttr = activeAttrs.has(attrName.toLowerCase());
            let strNode = null;

            if (path.node.value) {
                if (path.node.value.type === "StringLiteral") {
                    strNode = path.node.value;
                } else if (
                    path.node.value.type === "JSXExpressionContainer" &&
                    path.node.value.expression &&
                    path.node.value.expression.type === "StringLiteral"
                ) {
                    strNode = path.node.value.expression;
                }
            }

            if (strNode && isKnownAttr) {
                const value = strNode.value;
                const isLabel = isKnownAttr || /^(?:label|labelText|aria-label|title|placeholder|buttonText|helperText|headerText|headerTitle|caption|tooltip|alt|description|confirmText|cancelText|okText|emptyText|heading|floatingLabelText)$/i.test(attrName);
                if (!ignoredValue(value, rules, isLabel) && !isInsideLocalizationCall(path)) {
                    const loc = strNode.loc;
                    hits.push({
                        startLine: loc.start.line - 1,
                        startCol: loc.start.column,
                        endLine: loc.end.line - 1,
                        endCol: loc.end.column,
                        startOffset: strNode.start,
                        endOffset: strNode.end,
                        value,
                        message: `Hardcoded text in "${attrName}" attribute: "${value}". Use t("...") instead.`,
                        confidence: "high",
                        type: "attribute",
                    });
                }
            }
        },

        JSXText(path) {
            const rawText = path.node.value;
            const trimmed = rawText.trim();
            if (!trimmed || !/[A-Za-z]/.test(trimmed)) return;

            // Check parent JSX tag
            const parentElement = path.parentPath && path.parentPath.node;
            const tagName = parentElement ? getJsxTagName(parentElement.openingElement) : "";
            if (tagName && ignoredTags.has(tagName.toLowerCase())) {
                return;
            }

            if (!ignoredValue(trimmed, rules, true) && !isInsideLocalizationCall(path)) {
                const subLoc = calculateSubTextLoc(path.node.loc, rawText, trimmed);

                hits.push({
                    startLine: subLoc.startLine,
                    startCol: subLoc.startCol,
                    endLine: subLoc.endLine,
                    endCol: subLoc.endCol,
                    startOffset: path.node.start,
                    endOffset: path.node.end,
                    value: trimmed,
                    message: `Hardcoded JSX text: "${trimmed}". Use t("...") instead.`,
                    confidence: "high",
                    type: "jsx_text",
                });
            }
        },

        ObjectProperty(path) {
            const keyNode = path.node.key;
            let propName = "";
            if (keyNode.type === "Identifier") {
                propName = keyNode.name;
            } else if (keyNode.type === "StringLiteral") {
                propName = keyNode.value;
            }

            if (!propName || ignoredProps.has(propName.toLowerCase())) return;

            if (path.node.value && path.node.value.type === "StringLiteral") {
                const strNode = path.node.value;
                const value = strNode.value;
                const isKnownProp = activeProps.has(propName.toLowerCase());

                if (isKnownProp) {
                    const isLabelProp = isKnownProp || /^(?:label|labelText|title|placeholder|buttonText|helperText|headerText|headerTitle|caption|text|message|tooltip|description|header|errorMessage|errorMsg|confirmText|cancelText|okText|emptyText|heading|badgeText)$/i.test(propName);
                    if (!ignoredValue(value, rules, isLabelProp) && !isInsideLocalizationCall(path)) {
                        const loc = strNode.loc;
                        hits.push({
                            startLine: loc.start.line - 1,
                            startCol: loc.start.column,
                            endLine: loc.end.line - 1,
                            endCol: loc.end.column,
                            startOffset: strNode.start,
                            endOffset: strNode.end,
                            value,
                            message: `Hardcoded value for "${propName}": "${value}". Use t("...") instead.`,
                            confidence: "high",
                            type: "property",
                        });
                    }
                }
            }
        },

        CallExpression(path) {
            const fnName = getCallFunctionName(path.node);
            if (!fnName || !NOTIFICATION_FUNCTION_NAMES.has(fnName)) return;

            const args = path.node.arguments || [];
            if (args.length === 0) return;

            let startArgIndex = args.length > 1 ? 1 : 0;
            if (startArgIndex === 0 && args.length === 1 && args[0].type === "StringLiteral") {
                const firstVal = args[0].value.trim().toLowerCase();
                if (NOTIFICATION_STATUS_KEYWORDS.has(firstVal)) {
                    startArgIndex = 1;
                }
            }

            for (let i = startArgIndex; i < args.length; i++) {
                const arg = args[i];
                if (arg.type === "StringLiteral") {
                    const value = arg.value;
                    if (!ignoredValue(value, rules) && !isInsideLocalizationCall(path)) {
                        const loc = arg.loc;
                        hits.push({
                            startLine: loc.start.line - 1,
                            startCol: loc.start.column,
                            endLine: loc.end.line - 1,
                            endCol: loc.end.column,
                            startOffset: arg.start,
                            endOffset: arg.end,
                            value,
                            message: `Hardcoded text in "${fnName}" call: "${value}". Use t("...") instead.`,
                            confidence: "high",
                            type: "notification",
                        });
                    }
                }
            }
        },

        ConditionalExpression(path) {
            // Check if inside styling prop attribute (e.g. color={isLoading ? "red" : "blue"})
            const parentAttr = path.findParent(p => p.isJSXAttribute());
            if (parentAttr && parentAttr.node.name && STYLING_OR_TECHNICAL_PROPS.has(parentAttr.node.name.name)) {
                return;
            }

            const isInsideJsx = Boolean(path.findParent(p => p.isJSXElement() || p.isJSXAttribute() || p.isObjectProperty()));

            const checkBranch = (node) => {
                if (node && node.type === "StringLiteral") {
                    const value = node.value.trim();
                    if (!ignoredValue(value, rules) && !isInsideLocalizationCall(path)) {
                        const loc = node.loc;
                        hits.push({
                            startLine: loc.start.line - 1,
                            startCol: loc.start.column,
                            endLine: loc.end.line - 1,
                            endCol: loc.end.column,
                            startOffset: node.start,
                            endOffset: node.end,
                            value,
                            message: `Hardcoded string: "${value}". Use t("...") instead.`,
                            confidence: isInsideJsx ? "high" : "low",
                            type: "conditional",
                        });
                    }
                }
            };

            checkBranch(path.node.consequent);
            checkBranch(path.node.alternate);
        },

        LogicalExpression(path) {
            // e.g. isError && "Something went wrong" or userRole || "Anonymous"
            const parentAttr = path.findParent(p => p.isJSXAttribute());
            if (parentAttr && parentAttr.node.name && STYLING_OR_TECHNICAL_PROPS.has(parentAttr.node.name.name)) {
                return;
            }

            const isInsideJsx = Boolean(path.findParent(p => p.isJSXElement() || p.isJSXAttribute() || p.isObjectProperty()));

            const checkNode = (node) => {
                if (node && node.type === "StringLiteral") {
                    const value = node.value.trim();
                    if (!ignoredValue(value, rules) && !isInsideLocalizationCall(path)) {
                        const loc = node.loc;
                        hits.push({
                            startLine: loc.start.line - 1,
                            startCol: loc.start.column,
                            endLine: loc.end.line - 1,
                            endCol: loc.end.column,
                            startOffset: node.start,
                            endOffset: node.end,
                            value,
                            message: `Hardcoded string: "${value}". Use t("...") instead.`,
                            confidence: isInsideJsx ? "high" : "low",
                            type: "logical",
                        });
                    }
                }
            };

            // Check right side of logical expression
            checkNode(path.node.right);
        },

        TemplateLiteral(path) {
            // Skip imports/requires
            if (path.findParent(p => p.isImportDeclaration() || (p.isCallExpression() && getCallFunctionName(p.node) === "require"))) {
                return;
            }

            // Skip technical/styling variable declarations (e.g. const className = `...`)
            const varDecl = path.findParent(p => p.isVariableDeclarator());
            if (varDecl && varDecl.node.id && varDecl.node.id.name) {
                const varName = varDecl.node.id.name.toLowerCase();
                if (/^(?:classname|classes|styles|style|url|href|src|path|id|key|color|theme|icon)$/i.test(varName)) {
                    return;
                }
            }

            // Skip technical/styling JSX attributes (e.g. className={`badge-${count}`})
            const parentAttr = path.findParent(p => p.isJSXAttribute());
            if (parentAttr && parentAttr.node.name && STYLING_OR_TECHNICAL_PROPS.has(parentAttr.node.name.name)) {
                return;
            }

            // Check quasis (static text parts)
            const quasis = path.node.quasis || [];
            const hasMeaningfulText = quasis.some(q => {
                const raw = q.value ? (q.value.raw || q.value.cooked || "") : "";
                const text = raw.trim();
                return (
                    text.length >= 2 &&
                    /[A-Za-z]/.test(text) &&
                    !/^var\(--/i.test(text) &&
                    !/^https?:\/\//i.test(text) &&
                    !ignoredValue(text, rules)
                );
            });

            if (hasMeaningfulText && !isInsideLocalizationCall(path)) {
                // Build a preview string with placeholders: e.g. "Welcome back, {name}!"
                let preview = "";
                const expressions = path.node.expressions || [];
                for (let i = 0; i < quasis.length; i++) {
                    const qText = quasis[i].value ? (quasis[i].value.raw || quasis[i].value.cooked || "") : "";
                    preview += qText;
                    if (i < expressions.length) {
                        const exp = expressions[i];
                        const expName = exp.name || (exp.type === "MemberExpression" && exp.property ? exp.property.name : "val");
                        preview += `{${expName}}`;
                    }
                }

                const trimmedPreview = preview.trim();
                if (
                    /^https?:\/\//i.test(trimmedPreview) ||
                    /^var\(--/i.test(trimmedPreview) ||
                    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/.test(trimmedPreview) ||
                    /^(?:btn|badge|item|col|row|icon|fa|lucide|text|bg|color)-/i.test(trimmedPreview) ||
                    ignoredValue(trimmedPreview, rules)
                ) {
                    return;
                }

                const loc = path.node.loc;
                hits.push({
                    startLine: loc.start.line - 1,
                    startCol: loc.start.column,
                    endLine: loc.end.line - 1,
                    endCol: loc.end.column,
                    startOffset: path.node.start,
                    endOffset: path.node.end,
                    value: trimmedPreview,
                    message: `Hardcoded text in template literal: "${trimmedPreview}". Use t("key", { ... }) instead.`,
                    confidence: "high",
                    type: "template_literal",
                });
            }
        },

        BinaryExpression(path) {
            // Check string concatenation with '+'
            if (path.node.operator !== "+") return;

            // Avoid duplicate hit if this is part of an outer binary concatenation chain
            if (path.parentPath && path.parentPath.isBinaryExpression() && path.parentPath.node.operator === "+") {
                return;
            }

            const checkConcatOperand = (node) => {
                if (node && node.type === "StringLiteral") {
                    const value = node.value.trim();
                    if (
                        value.length < 2 ||
                        !/[A-Za-z]/.test(value) ||
                        ignoredValue(value, rules) ||
                        /^https?:\/\//i.test(value) ||
                        /^\/[a-zA-Z0-9_.-]*/.test(value) ||
                        /^[a-zA-Z0-9_]+_$/.test(value) ||
                        /^[a-zA-Z0-9-]+-$/.test(value)
                    ) {
                        return false;
                    }
                    return true;
                }
                return false;
            };

            const leftHasText = checkConcatOperand(path.node.left);
            const rightHasText = checkConcatOperand(path.node.right);

            if ((leftHasText || rightHasText) && !isInsideLocalizationCall(path)) {
                const loc = path.node.loc;
                const sampleStr = leftHasText ? path.node.left.value : path.node.right.value;
                hits.push({
                    startLine: loc.start.line - 1,
                    startCol: loc.start.column,
                    endLine: loc.end.line - 1,
                    endCol: loc.end.column,
                    startOffset: path.node.start,
                    endOffset: path.node.end,
                    value: sampleStr,
                    message: `Hardcoded string concatenation: "${sampleStr}". Use t("...") instead.`,
                    confidence: "high",
                    type: "binary_concatenation",
                });
            }
        },

        StringLiteral(path) {
            // Explicit custom words check
            if (rules && rules.customWords && rules.customWords.size > 0) {
                const val = path.node.value;
                if (rules.customWords.has(val) && !isInsideLocalizationCall(path)) {
                    const loc = path.node.loc;
                    const alreadyPresent = hits.some(
                        h => h.startLine === loc.start.line - 1 && h.startCol === loc.start.column
                    );
                    if (!alreadyPresent) {
                        hits.push({
                            startLine: loc.start.line - 1,
                            startCol: loc.start.column,
                            endLine: loc.end.line - 1,
                            endCol: loc.end.column,
                            startOffset: path.node.start,
                            endOffset: path.node.end,
                            value: val,
                            message: `Hardcoded text: "${val}". Use t("...") instead.`,
                            confidence: "high",
                            type: "custom_word",
                        });
                    }
                }
            }
        },
    });

    // Deduplicate overlapping hits by range
    const deduplicated = [];
    for (const hit of hits) {
        const isDuplicate = deduplicated.some(existing =>
            existing.startLine === hit.startLine &&
            existing.startCol === hit.startCol &&
            existing.endLine === hit.endLine &&
            existing.endCol === hit.endCol
        );
        if (!isDuplicate) {
            deduplicated.push(hit);
        }
    }

    return deduplicated;
}

/**
 * Finds the enclosing React component or hook function for a given line.
 * @param {any} ast
 * @param {number} targetLine - 0-indexed line number
 * @returns {{
 *   headerLine: number,
 *   bodyOpenLine: number,
 *   bodyCloseLine: number,
 *   indent: string,
 *   hasT: boolean
 * } | null}
 */
function findEnclosingComponentInAst(ast, targetLine) {
    if (!ast) return null;

    let enclosingCandidate = null;
    let innermostSpan = Infinity;

    traverse(ast, {
        "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(path) {
            const loc = path.node.loc;
            if (!loc) return;

            const startLine = loc.start.line - 1;
            const endLine = loc.end.line - 1;

            if (targetLine < startLine || targetLine > endLine) {
                return;
            }

            // Determine function name and whether it represents a React component or hook
            let name = "";
            if (path.node.id && path.node.id.name) {
                name = path.node.id.name;
            } else if (path.parentPath && path.parentPath.isVariableDeclarator() && path.parentPath.node.id) {
                name = path.parentPath.node.id.name;
            } else if (path.parentPath && path.parentPath.isExportDefaultDeclaration()) {
                name = "DefaultExport";
            }

            const isComponentOrHook =
                !name ||
                /^[A-Z][A-Za-z0-9_$]*$/.test(name) ||
                /^use[A-Z][A-Za-z0-9_$]*$/.test(name) ||
                name === "DefaultExport";

            if (!isComponentOrHook) return;

            const span = endLine - startLine;
            if (span < innermostSpan) {
                innermostSpan = span;

                // Check if body has '{'
                let bodyOpenLine = startLine;
                if (path.node.body && path.node.body.loc) {
                    bodyOpenLine = path.node.body.loc.start.line - 1;
                }

                // Check if component scope has `t` or `useTranslation` binding
                const hasT =
                    Boolean(path.scope && (path.scope.hasBinding("t") || path.scope.hasBinding("useTranslation"))) ||
                    Boolean(path.parentPath && path.parentPath.scope && (path.parentPath.scope.hasBinding("t") || path.parentPath.scope.hasBinding("useTranslation")));

                enclosingCandidate = {
                    headerLine: startLine,
                    bodyOpenLine,
                    bodyCloseLine: endLine,
                    indent: "    ",
                    hasT,
                };
            }
        },
    });

    return enclosingCandidate;
}

/**
 * Inspects AST node at cursor position for context (tag, attribute, property, text).
 * @param {any} ast
 * @param {number} line - 0-indexed line number
 * @param {number} character - 0-indexed column number
 * @returns {{
 *   tag: string | null,
 *   attribute: string | null,
 *   property: string | null,
 *   selectedText: string | null,
 *   nodeType: string | null
 * }}
 */
function inspectCodeContextAtPosition(ast, line, character) {
    const result = {
        tag: null,
        attribute: null,
        property: null,
        selectedText: null,
        nodeType: null,
    };

    if (!ast) return result;

    const targetLine = line + 1; // 1-indexed for Babel
    const targetCol = character;

    traverse(ast, {
        enter(path) {
            const loc = path.node.loc;
            if (!loc) return;

            if (
                loc.start.line <= targetLine &&
                loc.end.line >= targetLine &&
                (loc.start.line < targetLine || loc.start.column <= targetCol) &&
                (loc.end.line > targetLine || loc.end.column >= targetCol)
            ) {
                result.nodeType = path.node.type;

                if (path.isJSXElement()) {
                    result.tag = getJsxTagName(path.node.openingElement);
                } else if (path.isJSXAttribute()) {
                    result.attribute = path.node.name ? path.node.name.name : null;
                } else if (path.isObjectProperty()) {
                    if (path.node.key.type === "Identifier") {
                        result.property = path.node.key.name;
                    } else if (path.node.key.type === "StringLiteral") {
                        result.property = path.node.key.value;
                    }
                } else if (path.isStringLiteral()) {
                    result.selectedText = path.node.value;
                } else if (path.isJSXText()) {
                    result.selectedText = path.node.value.trim();
                }
            }
        },
    });

    return result;
}

module.exports = {
    NOTIFICATION_STATUS_KEYWORDS,
    NOTIFICATION_FUNCTION_NAMES,
    IGNORED_COLOR_KEYWORDS,
    IGNORED_PROGRAMMING_IDENTIFIERS,
    ignoredValue,
    parseSource,
    getJsxTagName,
    getCallFunctionName,
    findHardcodedHitsInAst,
    findEnclosingComponentInAst,
    inspectCodeContextAtPosition,
};
