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

    // Auto-discover en.json or en-US.json
    const matches = await vscode.workspace.findFiles(
        "**/{en,en-US,locales/**/en,lang*/**/en}.json",
        "**/{node_modules,dist,build,coverage,.git,.next,.turbo}/**",
        5,
    );

    if (matches && matches.length > 0) {
        // Prioritize paths containing 'locales' or 'lang' if multiple found
        const preferred = matches.find(m =>
            m.fsPath.includes("locales") || m.fsPath.includes("lang") || m.fsPath.includes("localization"),
        );
        return preferred || matches[0];
    }

    // Generic en.json fallback
    const genericMatches = await vscode.workspace.findFiles(
        "**/en.json",
        "**/{node_modules,dist,build,coverage,.git}/**",
        1,
    );

    return genericMatches && genericMatches.length > 0 ? genericMatches[0] : null;
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
 * Reads the structure of the primary dictionary to provide namespace hints to Copilot.
 * @param {vscode.Uri} dictionaryUri
 * @returns {Promise<{ namespaces: string[], isNested: boolean, sampleSnippet: string }>}
 */
async function getDictionaryContext(dictionaryUri) {
    if (!dictionaryUri) {
        return { namespaces: [], isNested: true, sampleSnippet: "" };
    }

    try {
        const fileData = await vscode.workspace.fs.readFile(dictionaryUri);
        const text = Buffer.from(fileData).toString("utf-8");
        const json = JSON.parse(text);

        const keys = Object.keys(json);
        const isNested = keys.some(k => typeof json[k] === "object" && json[k] !== null && !Array.isArray(json[k]));
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
        };
    } catch {
        return { namespaces: [], isNested: true, sampleSnippet: "" };
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
    // Only set if not already defined or overwrite with value
    current[lastKey] = value;
}

/**
 * Adds translation entries to the primary dictionary and sibling dictionaries.
 * @param {Array<{ key: string, value: string }>} entries
 * @returns {Promise<{ primaryUpdated: boolean, dictionaryUri: vscode.Uri | null, count: number }>}
 */
async function addEntriesToDictionaries(entries) {
    if (!entries || entries.length === 0) {
        return { primaryUpdated: false, dictionaryUri: null, count: 0 };
    }

    const primaryUri = await findPrimaryDictionary();
    if (!primaryUri) {
        return { primaryUpdated: false, dictionaryUri: null, count: 0 };
    }

    let updatedCount = 0;

    try {
        // Read & update primary dictionary
        let primaryData;
        let primaryJson = {};
        let originalText = "";

        try {
            primaryData = await vscode.workspace.fs.readFile(primaryUri);
            originalText = Buffer.from(primaryData).toString("utf-8");
            primaryJson = JSON.parse(originalText);
        } catch {
            primaryJson = {};
        }

        for (const entry of entries) {
            if (entry.key && entry.value !== undefined) {
                setDeepProperty(primaryJson, entry.key, entry.value);
                updatedCount++;
            }
        }

        const formatted = JSON.stringify(primaryJson, null, 2) + "\n";
        await vscode.workspace.fs.writeFile(primaryUri, Buffer.from(formatted, "utf-8"));

        // Also update sibling dictionaries (e.g. sin.json, es.json) so keys are present
        const siblingUris = await findSiblingDictionaries(primaryUri);
        for (const siblingUri of siblingUris) {
            try {
                const sData = await vscode.workspace.fs.readFile(siblingUri);
                const sJson = JSON.parse(Buffer.from(sData).toString("utf-8"));
                let siblingChanged = false;

                for (const entry of entries) {
                    if (entry.key) {
                        // Check if key already exists in sibling
                        const parts = entry.key.split(".");
                        let cur = sJson;
                        let exists = true;
                        for (const p of parts) {
                            if (cur && cur[p] !== undefined) {
                                cur = cur[p];
                            } else {
                                exists = false;
                                break;
                            }
                        }

                        if (!exists) {
                            // Add key with empty string or English fallback so key is available
                            setDeepProperty(sJson, entry.key, entry.value);
                            siblingChanged = true;
                        }
                    }
                }

                if (siblingChanged) {
                    await vscode.workspace.fs.writeFile(
                        siblingUri,
                        Buffer.from(JSON.stringify(sJson, null, 2) + "\n", "utf-8"),
                    );
                }
            } catch {
                // Ignore individual sibling failures
            }
        }

        return { primaryUpdated: true, dictionaryUri: primaryUri, count: updatedCount };
    } catch (err) {
        console.error("Failed to update dictionary:", err);
        return { primaryUpdated: false, dictionaryUri: primaryUri, count: 0 };
    }
}

module.exports = {
    findPrimaryDictionary,
    findSiblingDictionaries,
    getDictionaryContext,
    setDeepProperty,
    addEntriesToDictionaries,
};
