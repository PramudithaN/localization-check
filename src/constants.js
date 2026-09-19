const RELEVANT_LANGUAGES = new Set([
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
]);


const DEFAULT_ATTRIBUTES = [
    "label",
    "labelText",
    "title",
    "placeholder",
    "tooltip",
    "aria-label",
    "alt",
    "description",
    "helperText",
    "buttonText",
    "headerTitle",
    "headerText",
    "floatingLabelText",
    "confirmText",
    "cancelText",
    "okText",
    "emptyText",
    "caption",
    "heading",
];

const DEFAULT_OBJECT_PROPERTIES = [
    "label",
    "labelText",
    "title",
    "placeholder",
    "tooltip",
    "description",
    "header",
    "headerTitle",
    "headerText",
    "text",
    "buttonText",
    "helperText",
    "message",
    "errorMessage",
    "errorMsg",
    "confirmText",
    "cancelText",
    "okText",
    "emptyText",
    "caption",
    "heading",
    "badgeText",
];

const DEFAULT_TAGS = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "span",
    "label",
    "button",
    "a",
    "div",
    "li",
    "Typography",
    "Heading",
    "Title",
    "Text",
    "Banner",
    "Alert",
    "Badge",
    "Button",
];

const CONFIG_SECTION = "localizationCheck";
const SOURCE_NAME = "localization-check";
const DEFAULT_SCRIPT_PATH = "scripts/check-localization.js";
const DEFAULT_GITHUB_REPO = "PramudithaN/localization-check";

module.exports = {
    RELEVANT_LANGUAGES,
    DEFAULT_ATTRIBUTES,
    DEFAULT_OBJECT_PROPERTIES,
    DEFAULT_TAGS,
    CONFIG_SECTION,
    SOURCE_NAME,
    DEFAULT_SCRIPT_PATH,
    DEFAULT_GITHUB_REPO,
};
