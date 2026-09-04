import { NextResponse, type NextRequest } from "next/server";

/**
 * Two products, one Next process, two hostnames.
 *
 * `console.sarvathra.ai` serves the tenant console. `platform.sarvathra.ai`
 * serves the operator portal. **Neither can reach the other's routes**, and
 * that is the point of doing it this way rather than with a path.
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
 * ## What this is not
 *
 * Not authorisation. `is_platform_admin()` is the first statement of every
 * operator function in the database, and that is what stops a non-operator.
 * This decides which product a hostname serves — a tenant reaching
 * `/platform` on the console host should get a 404 because that route is not
 * part of that product, not because they lack a permission.
 *
 * Localhost serves both, because a development machine has one origin and
 * splitting it would mean running two dev servers to look at two screens.
 */
const PLATFORM_HOSTS = ["platform."];

export function middleware(request: NextRequest) {
    const host = request.headers.get("host") ?? "";
    const { pathname } = request.nextUrl;

    // One origin in development. The isolation above is a property of
    // deployment; pretending to have it locally would mean two dev servers.
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        return NextResponse.next();
    }

    const isPlatformHost = PLATFORM_HOSTS.some((prefix) => host.startsWith(prefix));
    const isPlatformPath = pathname === "/platform" || pathname.startsWith("/platform/");

    // Where a sign-in link lands, and it belongs to both products.
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
        // Everything else belongs to the other product and does not exist here.
        if (isPlatformPath) return NextResponse.next();
        // The bare host is the portal's front door rather than a 404.
        if (pathname === "/") {
            return NextResponse.redirect(new URL("/platform", request.url));
        }
        return new NextResponse("Not found", { status: 404 });
    }

    // The console host. The portal's routes are not part of this product, so
    // they are absent rather than forbidden — a 403 would tell a tenant that
    // there is something there to be forbidden from.
    if (isPlatformPath) {
        return new NextResponse("Not found", { status: 404 });
    }

    return NextResponse.next();
}

export const config = {
    // Everything except Next's own assets and the favicon. Matching those would
    // mean running this on every image request for no reason.
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
