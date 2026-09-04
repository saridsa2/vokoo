import {
    IconApiKeys,
    IconOrganization,
    IconVoiceLibrary,
    IconPhoneNumbers,
    IconLock,
    IconShapes,
} from "@/components/icons";
import type { NavItemType } from "./config";

/**
 * The platform portal's own navigation.
 *
 * Its own file rather than a section appended to `NAV_SECTIONS`, because these
 * are not screens a tenant has and cannot see — they are screens about *every*
 * tenant, and belong to a different product at a different address.
 *
 * The headings follow the console's rule: each is a verb for what you do there,
 * and the line between them is who the thing belongs to.
 *
 *   CUSTOMERS  the workspaces themselves — what they are sold, what they may
 *              reach, whether they are running
 *   SUPPLY     what the platform holds and hands out: numbers it has bought,
 *              provider accounts it pays for, the templates a new workspace is
 *              built from
 */
export const PLATFORM_SECTIONS: Array<{ label: string; items: NavItemType[] }> = [
    {
        label: "Customers",
        items: [
            { label: "Tenants", href: "/platform", icon: IconOrganization },
            // Under Customers rather than Supply: a plan is what a customer is
            // sold, not a thing the platform holds and lends out.
            { label: "Plans", href: "/platform/plans", icon: IconApiKeys },
        ],
    },
    {
        // Everything here is the operator's own property, lent to a workspace.
        // A number is bought from a carrier, a key is an account the platform
        // pays for, and a template is what a workspace is made out of — none of
        // them belong to a tenant, which is why none appear in the console.
        label: "Supply",
        items: [
            { label: "Numbers", href: "/platform/numbers", icon: IconPhoneNumbers },
            // The product itself: which model hears, thinks and speaks, and
            // what a minute on that chain is sold for. It sits under Supply
            // rather than in its own section because it is the same kind of
            // thing as a number and a key — the platform's, lent to a tenant.
            { label: "Engines", href: "/platform/engines", icon: IconVoiceLibrary },
            { label: "Provider Keys", href: "/platform/keys", icon: IconLock },
            // "Packs", not "Templates" and not "Starter Packs". A template is a
            // part; a pack is the thing somebody chooses for a business. And
            // "starter" reads as a free tier, which is a different idea
            // entirely — every workspace is built from one of these, not just
            // the cheap ones.
            { label: "Packs", href: "/platform/packs", icon: IconShapes },
        ],
    },
];

/** Flat lookup for titles, matching the console's own. */
export const PLATFORM_TITLES: Record<string, string> = Object.fromEntries(
    PLATFORM_SECTIONS.flatMap((section) => section.items).map((item) => [item.href ?? "", item.label]),
);
