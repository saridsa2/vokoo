import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/marketing/metadata";

/**
 * One page, listed honestly.
 *
 * The public site is a single route. A sitemap padded with `#product` and
 * `#faq` would be listing fragments of one document as though they were
 * separate pages, which is what a sitemap is specifically not for.
 *
 * It grows when the site does.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        {
            url: siteConfig.url,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 1,
        },
    ];
}
