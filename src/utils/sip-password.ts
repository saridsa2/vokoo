/**
 * A SIP password.
 *
 * From the browser's own CSPRNG rather than `Math.random`, which is seeded
 * predictably and is not a source anything authenticating should be built on.
 * The alphabet excludes characters that break a `key=value` line — the bridge
 * answers Asterisk's realtime lookups as a query string — and ones that read
 * ambiguously to somebody copying by hand: no O against 0, no l against 1.
 *
 * It lives here rather than beside either screen because two of them generate
 * one: adding an agent and rotating an agent's password. A second copy would be
 * a second alphabet, free to disagree about which characters are safe.
 */
export function generateSipPassword(length = 24): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
