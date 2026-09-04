import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/marketing/metadata";

/**
 * One `robots.txt`, served on every host this process answers for.
 *
 * That is not a compromise — it is the right answer. Next generates one file
 * per app and there is one app; the console and the portal have nothing a
 * crawler should index, and they say so here rather than relying on being
 * uninteresting.
 *
 * `disallow` names the two signed-in products explicitly. A crawler that
 * reaches `console.sarvathra.ai/dashboard` gets a sign-in page rather than
 * anybody's data, so this is tidiness rather than a control — the control is
 * that every route behind them requires a session and every database function
 * checks membership.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: ["/platform", "/dashboard", "/auth/"],
            },
        ],
        sitemap: `${siteConfig.url}/sitemap.xml`,
        host: siteConfig.url,
    };
}
