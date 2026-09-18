export const columnConfig = [
    {
        // Positive cases
        title: "User Full Name",
        description: "The primary account holder's name",
        headerText: "Actions Column",
        emptyText: "No data available",
        confirmText: "Yes, Delete",
        cancelText: "No, Keep",
        
        // Negative cases
        id: "user_full_name",
        key: "userName",
        status: "active",
        type: "string",
        width: 120,
        sortable: true,
    },
    {
        // Multiline positive case
        message:
            "Your subscription has expired. Please renew your plan.",
        tooltip:
            "Click here for renewal options",
    }
];

export const errorMessages = {
    errorMessage: "Unable to process payment at this time",
    errorMsg: "Network connection lost",
    successMsg: t("common.success"),
};
