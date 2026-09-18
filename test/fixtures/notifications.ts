export function notifyUser() {
    // Positive cases: 1st argument is status/severity keyword (skipped), 2nd/3rd are user messages (flagged)
    showNotification("error", "Failed to connect to server", "Please check your network");
    showToast("success", "Profile updated successfully");
    notify("warning", "Your session will expire in 5 minutes");
    displayNotification("info", "New feature is now available");

    // Single-argument call where string is not a status keyword -> flagged
    showNotification("An unexpected error occurred");

    // Multiline notification call
    showNotification(
        "error",
        "Could not load user permissions from database",
        "Contact support if problem persists"
    );

    // Negative cases: already localized
    showNotification("error", t("errors.connection_failed"));
    showToast("success", i18n.t("messages.saved"));
}
