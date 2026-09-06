/** @type {import('next').NextConfig} */
const nextConfig = {
    // A linked Git worktree sits below the primary checkout, which also has a
    // lockfile. Without explicit roots Next traces the parent checkout and
    // emits `.next/standalone/.worktrees/<name>/server.js`; the VPS service
    // expects the standalone entrypoint at its root.
    outputFileTracingRoot: process.cwd(),
    turbopack: {
        root: process.cwd(),
    },
    experimental: {
        optimizePackageImports: ["@untitledui/icons"],
    },
    /**
     * A self-contained server, built here and copied to the VPS.
     *
     * The alternative is `npm install` on the server, which needs
     * `FA_PACKAGE_TOKEN` — the Font Awesome kit is a private package, so a
     * deploy would mean putting that credential on the box and keeping it
     * there. Standalone traces exactly the dependencies the built app imports
     * and copies them beside it, so the server never resolves a package and
     * never needs a registry token.
     *
     * It also means the deployed thing is the artefact that was tested, rather
     * than a fresh resolve that may pick up a different patch version.
     */
    output: "standalone",
};

export default nextConfig;
