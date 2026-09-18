const fs = require("fs");
const path = require("path");

const pkgPath = path.join(__dirname, "..", "package.json");
const readmePath = path.join(__dirname, "..", "README.md");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const readme = fs.readFileSync(readmePath, "utf-8");

const currentVersion = pkg.version;
console.log(`Current package.json version: ${currentVersion}`);

// Check if README references a vsix install command
const vsixMatch = readme.match(/localization-check-([0-9]+\.[0-9]+\.[0-9]+)\.vsix/);
if (vsixMatch) {
    const readmeVersion = vsixMatch[1];
    if (readmeVersion !== currentVersion) {
        console.error(
            `\x1b[31m[Error] Version mismatch! README.md references vsix v${readmeVersion} while package.json is v${currentVersion}.\x1b[0m`
        );
        process.exit(1);
    }
}

console.log("\x1b[32m[Success] Version synchronization check passed!\x1b[0m");
process.exit(0);
