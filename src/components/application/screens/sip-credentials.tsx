"use client";

/**
 * The three things an agent's softphone needs, shown once.
 *
 * Shared by the add dialog and the rotate dialog because they say the same
 * thing at the only two moments a password exists in the browser. Written twice
 * they would drift, and the half that drifts is the server address — the one
 * thing here nobody can derive from anything else on screen.
 *
 * ## Why the server is a constant
 *
 * Through Caddy on 443, not Asterisk's own port. Asterisk's HTTP server carries
 * the SIP WebSocket *and* ARI on one port, and ARI can originate calls and hang
 * people up — so only `/ws` is published and 8088 stays on loopback. It is a
 * deployment fact rather than a per-agent one, which is why it is not a column.
 */

export const SIP_SERVER = "wss://sip.sarvathra.ai/ws";

export const SipCredentials = ({ endpoint, password }: { endpoint: string; password: string }) => (
    <dl className="mt-5 divide-y divide-secondary border-y border-secondary">
        <Field label="Server" value={SIP_SERVER} />
        <Field label="Username" value={endpoint} />
        <Field label="Password" value={password} />
    </dl>
);

const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
        <dt className="text-sm text-tertiary">{label}</dt>
        {/* `select-all` so one click takes the whole value. A password copied
            with a character missing fails at registration, which reads as a
            wrong password rather than a bad copy. */}
        <dd className="font-mono text-sm break-all text-primary select-all">{value}</dd>
    </div>
);
