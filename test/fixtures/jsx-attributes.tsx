import React from "react";

export function TestJsxAttributes() {
    return (
        <div>
            {/* Positive cases */}
            <input label="Username" placeholder="Enter your username" title="User input field" />
            <img src="/avatar.png" alt="User profile photo" />
            <button aria-label="Close dialog" tooltip="Click to close" helperText="Required field" />
            
            {/* Negative cases: already localized, technical attributes, identifiers */}
            <input label={t("auth.username")} placeholder={t("auth.enter_username")} />
            <div className="container active" id="main-content" data-testid="test-input" />
            <input type="text" name="user_id" />
        </div>
    );
}
