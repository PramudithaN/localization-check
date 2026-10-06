const assert = require("assert");
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default || require("@babel/traverse");

describe("Code Integrity & Static Scope Suite", () => {
    const rootDir = path.resolve(__dirname, "../..");
    const srcDir = path.join(rootDir, "src");

    const sourceFiles = [
        path.join(rootDir, "extension.js"),
        ...fs.readdirSync(srcDir)
            .filter(f => f.endsWith(".js"))
            .map(f => path.join(srcDir, f)),
    ];

    const allowedGlobals = new Set([
        ...Object.getOwnPropertyNames(globalThis),
        "require",
        "module",
        "exports",
        "__dirname",
        "__filename",
        "Buffer",
    ]);

    for (const filePath of sourceFiles) {
        const relativeName = path.relative(rootDir, filePath).replace(/\\/g, "/");

        it(`ensures all referenced identifiers in ${relativeName} are declared and in scope`, () => {
            const code = fs.readFileSync(filePath, "utf-8");
            const ast = parser.parse(code, {
                sourceType: "script",
                allowReturnOutsideFunction: true,
            });

            const undeclared = [];
            traverse(ast, {
                Identifier(idPath) {
                    if (idPath.isReferencedIdentifier()) {
                        const name = idPath.node.name;
                        if (!allowedGlobals.has(name) && !idPath.scope.hasBinding(name)) {
                            undeclared.push(`${name} (line ${idPath.node.loc?.start.line})`);
                        }
                    }
                },
            });

            assert.strictEqual(
                undeclared.length,
                0,
                `Undeclared or missing imports found in ${relativeName}: ${undeclared.join(", ")}`,
            );
        });
    }
});
