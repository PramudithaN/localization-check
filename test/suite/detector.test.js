const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    parseSource,
    findHardcodedHitsInAst,
    findEnclosingComponentInAst,
    findEnclosingSchemaInAst,
    inspectCodeContextAtPosition,
} = require("../../src/ast");

function readFixture(filename) {
    const filePath = path.join(__dirname, "..", "fixtures", filename);
    return fs.readFileSync(filePath, "utf-8");
}

describe("AST Localization Detector Suite", () => {
    describe("JSX Attributes Detection", () => {
        it("detects unlocalized attributes and ignores technical/localized attributes", () => {
            const code = readFixture("jsx-attributes.tsx");
            const { ast } = parseSource(code, "jsx-attributes.tsx");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            // Positives
            assert.ok(values.includes("Username"), "Should detect Username");
            assert.ok(values.includes("Enter your username"), "Should detect Enter your username");
            assert.ok(values.includes("User input field"), "Should detect User input field");
            assert.ok(values.includes("User profile photo"), "Should detect User profile photo");
            assert.ok(values.includes("Close dialog"), "Should detect Close dialog");
            assert.ok(values.includes("Click to close"), "Should detect Click to close");
            assert.ok(values.includes("Required field"), "Should detect Required field");

            // Negatives
            assert.ok(!values.includes("container active"), "Should ignore className");
            assert.ok(!values.includes("main-content"), "Should ignore id");
            assert.ok(!values.includes("test-input"), "Should ignore data-testid");
            assert.ok(!values.includes("user_id"), "Should ignore name");
            assert.ok(!values.includes("text"), "Should ignore type='text'");
        });
    });

    describe("JSX Text Detection", () => {
        it("detects direct JSX text while ignoring code/pre/script/style and t() calls", () => {
            const code = readFixture("jsx-text.tsx");
            const { ast } = parseSource(code, "jsx-text.tsx");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            // Positives
            assert.ok(values.includes("Welcome to our application"));
            assert.ok(values.includes("Please review your account details below."));
            assert.ok(values.includes("Save Changes"));
            assert.ok(values.includes("Click here to continue"));

            // Negatives (ignored tags)
            assert.ok(!values.includes("const x = 10;"), "Should ignore text in <code>");
            assert.ok(!values.includes("git status"), "Should ignore text in <pre>");
            assert.ok(!values.includes('console.log("hello");'), "Should ignore text in <script>");
            assert.ok(!values.includes("body { color: red; }"), "Should ignore text in <style>");
        });
    });

    describe("Object Properties Detection", () => {
        it("detects single-line and multiline user-facing object properties", () => {
            const code = readFixture("object-properties.ts");
            const { ast } = parseSource(code, "object-properties.ts");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            // Positives
            assert.ok(values.includes("User Full Name"));
            assert.ok(values.includes("The primary account holder's name"));
            assert.ok(values.includes("Actions Column"));
            assert.ok(values.includes("No data available"));
            assert.ok(values.includes("Yes, Delete"));
            assert.ok(values.includes("No, Keep"));
            assert.ok(values.includes("Your subscription has expired. Please renew your plan."));
            assert.ok(values.includes("Click here for renewal options"));
            assert.ok(values.includes("Unable to process payment at this time"));
            assert.ok(values.includes("Network connection lost"));

            // Negatives
            assert.ok(!values.includes("user_full_name"), "Should ignore id property");
            assert.ok(!values.includes("userName"), "Should ignore key property");
            assert.ok(!values.includes("active"), "Should ignore status property");
            assert.ok(!values.includes("string"), "Should ignore type property");
        });
    });

    describe("Notification Function Calls", () => {
        it("skips 1st status argument and flags message arguments", () => {
            const code = readFixture("notifications.ts");
            const { ast } = parseSource(code, "notifications.ts");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            // Status keywords should NOT be in hits
            assert.ok(!values.includes("error"), "Should skip 'error' status arg");
            assert.ok(!values.includes("success"), "Should skip 'success' status arg");
            assert.ok(!values.includes("warning"), "Should skip 'warning' status arg");
            assert.ok(!values.includes("info"), "Should skip 'info' status arg");

            // Messages should be flagged
            assert.ok(values.includes("Failed to connect to server"));
            assert.ok(values.includes("Please check your network"));
            assert.ok(values.includes("Profile updated successfully"));
            assert.ok(values.includes("Your session will expire in 5 minutes"));
            assert.ok(values.includes("New feature is now available"));
            assert.ok(values.includes("An unexpected error occurred"));
            assert.ok(values.includes("Could not load user permissions from database"));
            assert.ok(values.includes("Contact support if problem persists"));
        });
    });

    describe("Ternaries & Conditional Expressions", () => {
        it("flags strings in conditional branches with low confidence, ignoring comparisons and style props", () => {
            const code = readFixture("ternaries.ts");
            const { ast } = parseSource(code, "ternaries.ts");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            assert.ok(values.includes("Loading your data..."));
            assert.ok(values.includes("Ready to proceed"));
            assert.ok(values.includes("Something went wrong. Please try again."));
            assert.ok(values.includes("Anonymous Guest"));
            assert.ok(values.includes("Standard User"));

            // Check confidence level
            const loadingHit = hits.find(h => h.value === "Loading your data...");
            assert.strictEqual(loadingHit.confidence, "low");

            // Excluded
            assert.ok(!values.includes("active"), "Should ignore 'active' in comparison");
            assert.ok(!values.includes("pending"), "Should ignore 'pending' in comparison");
            assert.ok(!values.includes("dark"), "Should ignore 'dark' in comparison");
            assert.ok(!values.includes("red"), "Should ignore 'red' color");
            assert.ok(!values.includes("blue"), "Should ignore 'blue' color");
        });
    });

    describe("Template Literals", () => {
        it("detects static text in template literals, ignoring pure interpolation and URLs", () => {
            const code = readFixture("template-literals.tsx");
            const { ast } = parseSource(code, "template-literals.tsx");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const templateHits = hits.filter(h => h.type === "template_literal");
            assert.ok(templateHits.length >= 3, `Expected at least 3 template hits, got ${templateHits.length}`);

            const values = templateHits.map(h => h.value);
            assert.ok(values.some(v => v.includes("Welcome back")));
            assert.ok(values.some(v => v.includes("unread messages in your inbox")));
            assert.ok(values.some(v => v.includes("Showing")));

            // Negatives
            assert.ok(!values.some(v => v.startsWith("https://")), "Should ignore URL template literals");
            assert.ok(!values.some(v => v.startsWith("var(--")), "Should ignore CSS var template literals");
            assert.ok(!values.some(v => v.includes("btn-")), "Should ignore className template literals");
        });
    });

    describe("Binary String Concatenation", () => {
        it("detects string concatenation with literal operands", () => {
            const code = readFixture("binary-concatenation.ts");
            const { ast } = parseSource(code, "binary-concatenation.ts");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            const concatHits = hits.filter(h => h.type === "binary_concatenation");
            assert.ok(concatHits.length >= 2, `Expected at least 2 concatenation hits, got ${concatHits.length}`);

            const values = concatHits.map(h => h.value);
            assert.ok(values.includes("Hello "));
            assert.ok(values.includes(" is currently online"));

            // Negatives
            assert.ok(!values.includes("/api/v1/"), "Should ignore API paths");
            assert.ok(!values.includes("user_"), "Should ignore identifier prefixes");
        });
    });

    describe("Technical Identifiers & Colors", () => {
        it("produces 0 false positives for programming identifiers, URLs, and colors", () => {
            const code = readFixture("identifiers-and-colors.ts");
            const { ast } = parseSource(code, "identifiers-and-colors.ts");
            assert.ok(ast, "AST should parse successfully");

            const hits = findHardcodedHitsInAst(ast);
            assert.strictEqual(hits.length, 0, `Expected 0 hits for technical constants, got ${hits.length}`);
        });
    });

    describe("Component Scope and Enclosing Component Detection", () => {
        it("accurately finds enclosing React component and hook scope", () => {
            const code = `
import React from 'react';

export function HeaderComponent() {
    const title = "Welcome";
    return <h1>{title}</h1>;
}

export const FooterComponent = () => {
    return <div>Footer</div>;
};
`;
            const { ast } = parseSource(code, "test.tsx");
            assert.ok(ast);

            const comp1 = findEnclosingComponentInAst(ast, 4);
            assert.ok(comp1);
            assert.strictEqual(comp1.headerLine, 3);
            assert.strictEqual(comp1.hasT, false);

            const comp2 = findEnclosingComponentInAst(ast, 9);
            assert.ok(comp2);
            assert.strictEqual(comp2.headerLine, 8);
        });
    });

    describe("Context Inspection at Cursor Position", () => {
        it("identifies JSX attribute, tag, and property at coordinates", () => {
            const code = `<button title="Submit Form">Save</button>`;
            const { ast } = parseSource(code, "test.tsx");
            assert.ok(ast);

            const context = inspectCodeContextAtPosition(ast, 0, 15);
            assert.strictEqual(context.attribute, "title");
            assert.strictEqual(context.tag, "button");
        });
    });

    describe("Error Recovery & Incomplete Code Handling", () => {
        it("does not crash on in-progress / unclosed syntax errors", () => {
            const incompleteCode = `
function Incomplete() {
    return <button title="Incomplete string
`;
            const { ast, error } = parseSource(incompleteCode, "broken.tsx");
            // parser recovers or handles gracefully without throwing unhandled exceptions
            assert.doesNotThrow(() => {
                findHardcodedHitsInAst(ast);
            });
        });
    });

    describe("Confidence Scoring Verification", () => {
        it("assigns high confidence to standard UI text and low confidence to ternaries", () => {
            const code = `
export function Sample({ active }: any) {
    const banner = active ? "Active mode enabled" : "Inactive mode";
    return <button title="Click to submit">Submit form</button>;
}
`;
            const { ast } = parseSource(code, "sample.tsx");
            assert.ok(ast);

            const hits = findHardcodedHitsInAst(ast);
            const buttonHit = hits.find(h => h.value === "Submit form");
            assert.strictEqual(buttonHit.confidence, "high");

            const ternaryHit = hits.find(h => h.value === "Active mode enabled");
            assert.strictEqual(ternaryHit.confidence, "low");
        });
    });

    describe("JSX Expression Container & UI Variables", () => {
        it("detects string literals inside JSX container and UI variable declarations", () => {
            const code = `
export function Profile() {
    const title = "Dashboard Overview";
    const errorMessage = "Failed to fetch data";
    const [statusText, setStatusText] = useState("Loading records...");
    return (
        <div>
            {"Hello World"}
            <span>{title}</span>
        </div>
    );
}
`;
            const { ast } = parseSource(code, "profile.tsx");
            assert.ok(ast);

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            assert.ok(values.includes("Hello World"), "Should detect string in JSXExpressionContainer");
            assert.ok(values.includes("Dashboard Overview"), "Should detect UI variable title");
            assert.ok(values.includes("Failed to fetch data"), "Should detect UI variable errorMessage");
            assert.ok(values.includes("Loading records..."), "Should detect useState UI initial state");
        });

        it("detects alert, confirm, toast, and message notifications", () => {
            const code = `
export function NotifyUser() {
    alert("Please fill all required fields");
    confirm("Are you sure you want to proceed?");
    toast.error("Failed to connect to server");
    message.success("Profile saved successfully");
}
`;
            const { ast } = parseSource(code, "notify.ts");
            assert.ok(ast);

            const hits = findHardcodedHitsInAst(ast);
            const values = hits.map(h => h.value);

            assert.ok(values.includes("Please fill all required fields"), "Should detect alert");
            assert.ok(values.includes("Are you sure you want to proceed?"), "Should detect confirm");
            assert.ok(values.includes("Failed to connect to server"), "Should detect toast.error");
            assert.ok(values.includes("Profile saved successfully"), "Should detect message.success");
        });
    });

    describe("False Positive Reports & Ignored Custom Rules", () => {
        it("ignores path properties and route template literals e.g. path: `/${CONFIG.tenant}/settings/schedule-event`", () => {
            const code = `
const routeConfig = {
    path: \`/\${CONFIG.tenant}/settings/schedule-event\`,
    url: \`/api/v1/events/\${eventId}\`,
    pathname: \`/dashboard/\${userId}\`,
    href: \`https://example.com/settings/\${tab}\`,
};
`;
            const { ast } = parseSource(code, "routes.tsx");
            assert.ok(ast);

            const hits = findHardcodedHitsInAst(ast, null, code);
            assert.strictEqual(hits.length, 0, "Technical path/url properties and route template literals must not be flagged");
        });

        it("ignores template literals explicitly added to ignoredWords e.g. Sub Product - ${formData['subProductName']}...", () => {
            const code = `
const message = \`Sub Product - \${formData["subProductName"]} is already exist for Product - \${formData["productName"]}\`;
`;
            const { ast } = parseSource(code, "message.tsx");
            assert.ok(ast);

            const customRules = {
                customAttributes: [],
                customProperties: [],
                customTags: [],
                customWords: new Set(),
                ignoredWords: new Set([
                    'Sub Product - ${formData["subProductName"]} is already exist for Product - ${formData["productName"]}',
                ]),
                ignoredAttributes: new Set(),
                ignoredProperties: new Set(),
                ignoredTags: new Set(),
                minimumConfidence: "high",
            };

            const hits = findHardcodedHitsInAst(ast, customRules, code);
            assert.strictEqual(hits.length, 0, "Template literal in ignoredWords must not be flagged");
        });

        it("ignores properties when specified in ignoredProperties", () => {
            const code = `
const item = {
    path: "/custom/path/value",
    customField: "Custom technical key",
};
`;
            const { ast } = parseSource(code, "config.ts");
            assert.ok(ast);

            const customRules = {
                customAttributes: [],
                customProperties: ["customField"],
                customTags: [],
                customWords: new Set(),
                ignoredWords: new Set(),
                ignoredAttributes: new Set(),
                ignoredProperties: new Set(["customfield", "path"]),
                ignoredTags: new Set(),
                minimumConfidence: "high",
            };

            const hits = findHardcodedHitsInAst(ast, customRules, code);
            assert.strictEqual(hits.length, 0, "Properties in ignoredProperties must not be flagged");
        });

        it("inspects template literal context correctly without quote corruption", () => {
            const code = `const msg = \`Sub Product - \${formData["subProductName"]} is already exist\`;`;
            const { ast } = parseSource(code, "context.tsx");
            assert.ok(ast);

            const context = inspectCodeContextAtPosition(ast, 0, 15, code);
            assert.strictEqual(
                context.selectedText,
                'Sub Product - ${formData["subProductName"]} is already exist'
            );
        });

        it("detects top-level schema/config objects and derives custom hook name", () => {
            const code = `
export const TradingTypeSchema: iSettingSchema = {
    navigation: {
        list: [
            {
                title: "Product Eligibility",
            }
        ]
    }
};
`;
            const { ast } = parseSource(code, "schema.ts");
            assert.ok(ast);

            const schema = findEnclosingSchemaInAst(ast, 5, code);
            assert.ok(schema, "Should detect enclosing schema object");
            assert.strictEqual(schema.varName, "TradingTypeSchema");
            assert.strictEqual(schema.hookName, "useTradingTypeSchema");
            assert.strictEqual(schema.isExport, true);
            assert.strictEqual(schema.typeAnnotation, ": iSettingSchema");
        });
    });
});
