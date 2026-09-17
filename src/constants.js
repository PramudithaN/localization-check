const RELEVANT_LANGUAGES = new Set([
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
]);

const ATTRIBUTE_PATTERN =
    /\b(label|title|placeholder|tooltip|aria-label|alt|description|helperText|buttonText)\s*=\s*(["'])([^"']+)\2/gi;

const TEXT_PATTERN = />\s*([A-Za-z][^<{]*?[A-Za-z0-9!?.,])\s*</g;

// Plain object-literal properties (e.g. title: "...", label: "...") in a column/config def
// (as opposed to a JSX attribute, which uses `=` and is covered above).
// Note: "name" is intentionally excluded as it commonly represents technical form/field/entity identifiers.
const OBJECT_PROPERTY_PATTERN =
    /\b(label|title|placeholder|tooltip|description|header|text|buttonText|helperText|message|errorMessage|errorMsg|confirmText|cancelText|okText|emptyText)\s*:\s*(["'`])([^"'`]+)\2/gi;

// Notification and toast functions where 1st argument is type/status and subsequent arguments are user-facing messages.
const NOTIFICATION_FUNCTION_PATTERN =
    /\b(showNotification|showToast|notify|displayNotification|openNotification)\s*\(/gi;

const CONFIG_SECTION = "localizationCheck";
const SOURCE_NAME = "localization-check";
const DEFAULT_SCRIPT_PATH = "scripts/check-localization.js";

module.exports = {
    RELEVANT_LANGUAGES,
    ATTRIBUTE_PATTERN,
    TEXT_PATTERN,
    OBJECT_PROPERTY_PATTERN,
    NOTIFICATION_FUNCTION_PATTERN,
    CONFIG_SECTION,
    SOURCE_NAME,
    DEFAULT_SCRIPT_PATH,
};
