const vscode = require("vscode");
const path = require("path");
const { CONFIG_SECTION } = require("./constants");

/**
 * Finds the primary translation JSON dictionary (e.g., en.json) in the workspace.
 * @returns {Promise<vscode.Uri | null>}
 */
async function findPrimaryDictionary() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const configuredPath = config.get("dictionaryPath", "").trim();

    if (configuredPath) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const fullPath = path.isAbsolute(configuredPath)
                ? configuredPath
                : path.join(workspaceFolders[0].uri.fsPath, configuredPath);
            return vscode.Uri.file(fullPath);
        }
    }

    const searchPatterns = [
        "**/en.json",
        "**/en-US.json",
        "**/en_US.json",
        "**/locales/**/en.json",
        "**/locales/**/translation.json",
        "**/locales/**/common.json",
        "**/translations/**/en.json",
        "**/lang*/**/en.json",
        "**/i18n/**/en.json",
    ];

    const excludePattern = "**/{node_modules,dist,build,coverage,.git,.next,.turbo,.vscode,out,bin}/**";

    for (const pattern of searchPatterns) {
        try {
            const matches = await vscode.workspace.findFiles(pattern, excludePattern, 5);
            if (matches && matches.length > 0) {
                // Prioritize paths containing 'locales', 'lang', 'i18n', or 'localization'
                const preferred = matches.find(m => {
                    const p = m.fsPath.toLowerCase();
                    return (
                        p.includes("locales") ||
                        p.includes("lang") ||
                        p.includes("i18n") ||
                        p.includes("localization") ||
                        p.includes("translation")
                    );
                });
                return preferred || matches[0];
            }
        } catch {
            // continue to next pattern
        }
    }

    return null;
}

/**
 * Finds the primary dictionary or automatically creates one if none exists in the workspace.
 * @returns {Promise<vscode.Uri | null>}
 */
async function ensurePrimaryDictionary() {
    const existing = await findPrimaryDictionary();
    if (existing) {
        return existing;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const root = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const configuredPath = config.get("dictionaryPath", "").trim();

    let targetPath;
    if (configuredPath) {
        targetPath = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.join(root, configuredPath);
    } else {
        // Detect if src directory exists to choose between src/locales/en.json and locales/en.json
        try {
            const srcUri = vscode.Uri.file(path.join(root, "src"));
            await vscode.workspace.fs.stat(srcUri);
            targetPath = path.join(root, "src", "locales", "en.json");
        } catch {
            targetPath = path.join(root, "locales", "en.json");
        }
    }

    const newUri = vscode.Uri.file(targetPath);
    try {
        const dirUri = vscode.Uri.file(path.dirname(newUri.fsPath));
        await vscode.workspace.fs.createDirectory(dirUri);
        await vscode.workspace.fs.writeFile(newUri, Buffer.from("{\n}\n", "utf-8"));
        return newUri;
    } catch (err) {
        console.error("Failed to create primary dictionary file:", err);
        return null;
    }
}

/**
 * Finds all sibling locale JSON files in the same directory as the primary dictionary (e.g., sin.json, es.json, fr.json).
 * @param {vscode.Uri} primaryDictionaryUri
 * @returns {Promise<vscode.Uri[]>}
 */
async function findSiblingDictionaries(primaryDictionaryUri) {
    try {
        const dirUri = vscode.Uri.file(path.dirname(primaryDictionaryUri.fsPath));
        const dirEntries = await vscode.workspace.fs.readDirectory(dirUri);
        const siblings = [];

        for (const [name, type] of dirEntries) {
            if (
                type === vscode.FileType.File &&
                name.endsWith(".json") &&
                name !== path.basename(primaryDictionaryUri.fsPath) &&
                !name.startsWith("package") &&
                !name.startsWith("tsconfig")
            ) {
                siblings.push(vscode.Uri.joinPath(dirUri, name));
            }
        }
        return siblings;
    } catch {
        return [];
    }
}

/**
 * Reads the structure of the primary dictionary (en.json) to provide namespace hints and existing key mappings to Copilot.
 * @param {vscode.Uri} dictionaryUri
 * @returns {Promise<{ namespaces: string[], isNested: boolean, sampleSnippet: string, existingKeysMap: Record<string, string> }>}
 */
async function getDictionaryContext(dictionaryUri) {
    if (!dictionaryUri) {
        return { namespaces: [], isNested: true, sampleSnippet: "", existingKeysMap: {} };
    }

    try {
        const fileData = await vscode.workspace.fs.readFile(dictionaryUri);
        const text = Buffer.from(fileData).toString("utf-8");
        const json = JSON.parse(text);

        const keys = Object.keys(json);
        const isNested = keys.some(k => typeof json[k] === "object" && json[k] !== null && !Array.isArray(json[k]));

        // Flatten existing entries (especially 'common' namespace) to assist deduplication
        const existingKeysMap = {};
        function flatten(obj, prefix = "") {
            for (const [k, v] of Object.entries(obj)) {
                const fullKey = prefix ? `${prefix}.${k}` : k;
                if (typeof v === "object" && v !== null && !Array.isArray(v)) {
                    flatten(v, fullKey);
                } else if (typeof v === "string") {
                    existingKeysMap[fullKey] = v;
                }
            }
        }
        flatten(json);

        const sampleSnippet = JSON.stringify(
            Object.fromEntries(
                keys.slice(0, 10).map(k => [
                    k,
                    typeof json[k] === "object" && json[k] !== null ? Object.keys(json[k]).slice(0, 5) : "...",
                ]),
            ),
            null,
            2,
        );

        return {
            namespaces: isNested ? keys : [],
            isNested,
            sampleSnippet,
            existingKeysMap,
        };
    } catch {
        return { namespaces: [], isNested: true, sampleSnippet: "", existingKeysMap: {} };
    }
}

/**
 * Sets a value in an object given a dot-separated or direct key.
 * If dot-notation is used and object supports nesting, creates nested objects.
 * @param {object} targetObj
 * @param {string} keyPath
 * @param {string} value
 */
function setDeepProperty(targetObj, keyPath, value) {
    const parts = keyPath.split(".");
    let current = targetObj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (typeof current[part] !== "object" || current[part] === null || Array.isArray(current[part])) {
            current[part] = {};
        }
        current = current[part];
    }

    const lastKey = parts[parts.length - 1];
    current[lastKey] = value;
}

/**
 * Adds translation entries strictly to the primary en.json dictionary.
 * Does NOT generate or modify other language dictionaries.
 * Deduplicates entries so existing keys/values are preserved cleanly.
 * @param {Array<{ key: string, value: string }>} entries
 * @returns {Promise<{ primaryUpdated: boolean, dictionaryUri: vscode.Uri | null, count: number }>}
 */
async function addEntriesToDictionaries(entries) {
    if (!entries || entries.length === 0) {
        return { primaryUpdated: false, dictionaryUri: null, count: 0 };
    }

    const primaryUri = await ensurePrimaryDictionary();
    if (!primaryUri) {
        return { primaryUpdated: false, dictionaryUri: null, count: 0 };
    }

    let updatedCount = 0;

    try {
        // Read & update ONLY primary dictionary (en.json)
        let primaryJson = {};

        try {
            const primaryData = await vscode.workspace.fs.readFile(primaryUri);
            const originalText = Buffer.from(primaryData).toString("utf-8").trim();
            if (originalText) {
                primaryJson = JSON.parse(originalText);
            }
        } catch {
            primaryJson = {};
        }

        // Check if existing dictionary is strictly flat dotted (e.g. "auth.login": "Log In")
        const topKeys = Object.keys(primaryJson);
        const isFlat =
            topKeys.length > 0 &&
            !topKeys.some(k => typeof primaryJson[k] === "object" && primaryJson[k] !== null && !Array.isArray(primaryJson[k])) &&
            topKeys.some(k => k.includes("."));

        for (const entry of entries) {
            if (entry.key && entry.value !== undefined) {
                if (isFlat) {
                    primaryJson[entry.key] = entry.value;
                } else {
                    setDeepProperty(primaryJson, entry.key, entry.value);
                }
                updatedCount++;
            }
        }

        const formatted = JSON.stringify(primaryJson, null, 2) + "\n";
        const dirUri = vscode.Uri.file(path.dirname(primaryUri.fsPath));
        await vscode.workspace.fs.createDirectory(dirUri);
        await vscode.workspace.fs.writeFile(primaryUri, Buffer.from(formatted, "utf-8"));

        return { primaryUpdated: true, dictionaryUri: primaryUri, count: updatedCount };
    } catch (err) {
        console.error("Failed to update en.json dictionary:", err);
        return { primaryUpdated: false, dictionaryUri: primaryUri, count: 0 };
    }
}

module.exports = {
    findPrimaryDictionary,
    ensurePrimaryDictionary,
    findSiblingDictionaries,
    getDictionaryContext,
    setDeepProperty,
    addEntriesToDictionaries,
};
