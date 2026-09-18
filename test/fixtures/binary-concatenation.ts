export function BinaryConcatDemo(user: any) {
    // Positive cases
    const msg1 = "Hello " + user.name;
    const msg2 = user.firstName + " is currently online";
    const msg3 = "Total amount: " + user.amount + " USD";

    // Negative cases: numbers, technical path concatenation, URLs
    const path = "/api/v1/" + user.id;
    const key = "user_" + user.id;
    const url = "https://example.com/" + user.slug;
    const math = 10 + 20;
}
