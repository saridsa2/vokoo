import { NextResponse, type NextRequest } from "next/server";

/**
 * Three products, one Next process, three hostnames.
 *
 * `sarvathra.ai` serves the public site. `console.sarvathra.ai` serves the
 * tenant console. `platform.sarvathra.ai` serves the operator portal. **None
 * can reach another's routes**, and that is the point of doing it this way
 * rather than with a path.
 *
 * ## Why separate origins rather than `/platform` on one host
 *
 * A browser scopes `localStorage`, cookies and session storage to an origin. On
 * one host, an operator's session and a tenant's session are the same stored
 * object — so an operator browsing tenants is simultaneously signed into one,
 * and anything that reads the session gets both facts. On two hosts they cannot
 * see each other at all, and signing into the portal is a separate act.
 *
 * The route tree and the missing `x-org-id` header already separated them in
 * the code. This separates them in the browser, which is the half that code
 * cannot do.
 *
 * The marketing site joins for a weaker reason and a real one: it shares the
 * brand and the deployment, and it must never be able to read a session. It has
 * no client code that looks for one, but the origin makes that a property of
 * the deployment rather than of a component nobody has changed yet.
 *
 * ## What this is not
 *
 * Not authorisation. `is_platform_admin()` is the first statement of every
 * operator function in the database, and that is what stops a non-operator.
 * This decides which product a hostname serves — a tenant reaching
 * `/platform` on the console host should get a 404 because that route is not
 * part of that product, not because they lack a permission.
 *
 * ## `/` belongs to the marketing site now
 *
 * `src/app/page.tsx` used to own it and redirect to `/dashboard`. Two files
 * cannot own one route, so the redirect moved here — which is where the
 * platform host's identical redirect already lived, and is the better place for
 * both: what the bare host means is a fact about the hostname, not about a
 * page.
 *
 * Localhost serves all three, because a development machine has one origin and
 * splitting it would mean running three dev servers to look at three screens.
 * There, `/` is the marketing page; the console is at `/dashboard` and the
 * portal at `/platform`, which is where they were already bookmarked.
 */
const PLATFORM_HOSTS = ["platform."];
const CONSOLE_HOSTS = ["console."];

export function middleware(request: NextRequest) {
    const host = request.headers.get("host") ?? "";
    const { pathname } = request.nextUrl;

    // One origin in development. The isolation above is a property of
    // deployment; pretending to have it locally would mean three dev servers.
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        return NextResponse.next();
    }

    const isPlatformHost = PLATFORM_HOSTS.some((prefix) => host.startsWith(prefix));
    const isConsoleHost = CONSOLE_HOSTS.some((prefix) => host.startsWith(prefix));
    const isPlatformPath = pathname === "/platform" || pathname.startsWith("/platform/");

    // Where a sign-in link lands, and it belongs to both signed-in products.
    //
    // The link is issued by one GoTrue for one installation; which portal the
    // recipient should end up in is a property of the account, not of the
    // hostname the link happens to carry. So the page exists on both hosts and
    // decides for itself — see `src/app/auth/callback/page.tsx`. 404-ing it
    // here would make an operator's link dead on the console host, which is
    // exactly where `SITE_URL` sends every link that names no redirect.
    if (pathname.startsWith("/auth/")) {
        return NextResponse.next();
    }

    if (isPlatformHost) {
        // The portal serves its own routes and the sign-in that guards them.
        // Everything else belongs to another product and does not exist here.
        if (isPlatformPath) return NextResponse.next();
        // The bare host is the portal's front door rather than a 404.
        if (pathname === "/") {
            return NextResponse.redirect(new URL("/platform", request.url));
        }
        return new NextResponse("Not found", { status: 404 });
    }

    if (isConsoleHost) {
        // The portal's routes are not part of this product, so they are absent
        // rather than forbidden — a 403 would tell a tenant that there is
        // something there to be forbidden from.
        if (isPlatformPath) {
            return new NextResponse("Not found", { status: 404 });
        }
        // The bare host is the dashboard, as it has always been. The public
        // site lives on the apex and is not what somebody typing `console.`
        // is looking for.
        if (pathname === "/") {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.next();
    }

    // The two files a crawler asks for by name. They are generated once for
    // the whole process and describe the public site, so they belong on the
    // apex — and the rule below would otherwise 404 the sitemap named in the
    // `robots.txt` this very deployment serves.
    if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
        return NextResponse.next();
    }

    // The apex, and anything else pointed here. **Only the public site.**
    //
    // A 404 rather than a redirect for the signed-in routes: `sarvathra.ai/
    // dashboard` is not a mistyped console URL worth rescuing, it is a route
    // that does not exist on this product — and redirecting would hand a
    // session-bearing page to an origin that must never hold one.
    if (pathname === "/") {
        return NextResponse.next();
    }
    return new NextResponse("Not found", { status: 404 });
}

export const config = {
    // Everything except Next's own assets and the favicon. Matching those would
    // mean running this on every image request for no reason.
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
