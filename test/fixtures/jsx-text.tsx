import React from "react";

export function TestJsxText() {
    return (
        <div>
            {/* Positive cases */}
            <h1>Welcome to our application</h1>
            <p>Please review your account details below.</p>
            <button>Save Changes</button>
            <span>Click here to continue</span>

            {/* Negative cases: already localized */}
            <p>{t("welcome.intro")}</p>
            <h1>{i18n.t("header.title")}</h1>

            {/* Negative cases: ignored tags */}
            <code>const x = 10;</code>
            <pre>git status</pre>
            <script>console.log("hello");</script>
            <style>body text</style>

            {/* Negative cases: whitespace and symbols */}
            <span> </span>
            <div>-</div>
            <div>/</div>
        </div>
    );
}
