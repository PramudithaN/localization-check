import React from "react";

export function TemplateLiteralDemo({ name, count, total }: any) {
    // Positive cases: static text segments with meaning
    const greeting = `Welcome back, ${name}!`;
    const message = `You have ${count} unread messages in your inbox.`;
    const summary = `Showing ${count} of ${total} results`;

    // Negative cases: pure interpolation, urls, css classes, identifiers
    const identifier = `${name}_${count}`;
    const url = `https://api.example.com/users/${name}`;
    const className = `btn btn-${name} item-${count}`;
    const cssVar = `var(--color-${name})`;

    return (
        <div>
            <p>{`Hello ${name}, your order is confirmed.`}</p>
            <span className={`badge-${count}`}>{`Item ${count}`}</span>
        </div>
    );
}
