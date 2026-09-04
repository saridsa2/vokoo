"use client";

/**
 * Packs — what a workspace is built from on the day it signs up.
 *
 * This was a table of four template rows. A table was the wrong shape for two
 * reasons: it listed the *parts* rather than the thing somebody chooses, and it
 * made one starting point for every customer, which is wrong the moment the
 * second customer is not a clinic.
 *
 * A pack is chosen for a business, so it is grouped by one.
 *
 * ## The distinction the card exists to show
 *
 * A pack **copies** agents and a flow, and only **names** an engine. That is
 * not a detail of the implementation — it is the difference between what the
 * customer may edit and what stays yours, and it decides what happens when you
 * improve something later. Copies diverge; a named engine does not.
 *
 * So the card says both, in those words, rather than listing "3 items".
 *
 * The naming is not a gap in what a pack delivers. Since 0106 seeding also
 * grants the workspace use of the engines the pack names, so one pack arrives
 * as one working set — agents, the flow that answers, and the right to run
 * them. It used to deliver the first two and leave the third to somebody
 * remembering.
 *
 * ## Why skills and tools are not in a pack
 *
 * A skill is org-scoped, so a pack could only copy one — and a skill is the
 * piece most likely to need fixing across every customer at once, which a copy
 * makes impossible. A tool shipped in a pack cannot authenticate at all:
 * `ctx.secrets` is `{}` on every invocation. Both are suggested when somebody
 * edits an agent instead, which creates no row.
 *
 * ## What it does not offer
 *
 * No editing. Authoring a pack is its own screen and this is not it — seeing
 * what a new customer will be given is worth having on its own, and was
 * previously answerable only in SQL.
 */

import { useEffect, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

type Pack = {
    id: string;
    slug: string;
    label: string;
    domain: string;
    summary: string;
    version: number;
    is_active: boolean;
    agents: number;
    flows: number;
    /** Public names of the engines this pack puts a customer on. */
    engines: string[];
    workspaces: number;
};

export const PlatformPacksScreen = () => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [packs, setPacks] = useState<Pack[] | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        api.operatorPacks<Pack>(context)
            .then(({ data }) => setPacks(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [isReady, context]);

    // Grouped by the business each is for, which is how one gets chosen.
    const byDomain = new Map<string, Pack[]>();
    for (const pack of packs ?? []) {
        const key = pack.domain || "Other";
        byDomain.set(key, [...(byDomain.get(key) ?? []), pack]);
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-col gap-1 p-6 pb-4 lg:px-8 lg:pt-8">
                <h1 className="text-display-xs font-semibold text-primary">Packs</h1>
                <p className="max-w-2xl text-sm text-tertiary">
                    What a workspace is built from when it is provisioned.
                </p>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6 pt-0 lg:px-8 lg:pb-8">

                {[...byDomain.entries()].map(([domain, group]) => (
                    <section key={domain} className="flex flex-col gap-3">
                        <h2 className="text-xs font-bold tracking-wide text-quaternary uppercase">
                            {domain}
                        </h2>
                        <ul className="grid gap-4 xl:grid-cols-2">
                            {group.map((pack) => (
                                // A plain card, deliberately not a link.
                                // Every other card in this portal opens
                                // something; these have nowhere to go yet, and
                                // a card that looks clickable and is not is a
                                // promise the screen cannot keep. It becomes a
                                // link the day a pack has a detail view.
                                <li
                                    key={pack.id}
                                    className="flex cursor-default flex-col gap-4 border border-secondary bg-primary p-5"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-md font-medium text-primary">
                                                {pack.label}
                                            </p>
                                            <p className="mt-0.5 truncate font-mono text-xs text-quaternary">
                                                {pack.slug} · v{pack.version}
                                            </p>
                                        </div>
                                        {!pack.is_active ? (
                                            <Badge size="sm" color="gray">
                                                withdrawn
                                            </Badge>
                                        ) : null}
                                    </div>

                                    {pack.summary ? (
                                        <p className="text-sm text-tertiary">{pack.summary}</p>
                                    ) : null}

                                    {/* Copied and named, said in those words.
                                        A count of "3 items" would hide the one
                                        thing worth knowing: which half the
                                        customer may edit, and therefore which
                                        half diverges the moment it is seeded. */}
                                    <dl className="flex flex-col gap-2 border-t border-secondary pt-3">
                                        <Line
                                            term="Copies"
                                            hint="Theirs to edit from day one. Improving the pack later does not reach a workspace already seeded — which is why a pack is onboarding rather than a way to manage what customers run."
                                        >
                                            {pack.agents} agent{pack.agents === 1 ? "" : "s"}
                                            {" · "}
                                            {pack.flows} flow{pack.flows === 1 ? "" : "s"}
                                        </Line>
                                        <Line
                                            term="Runs on"
                                            hint="Named, not copied — the engine stays the platform's, so a change to it reaches every workspace on it at once. Seeding the pack grants the workspace the right to use it, so what arrives is one working set rather than agents pointing at something they may not run."
                                        >
                                            {pack.engines.length > 0 ? (
                                                <span className="flex flex-wrap gap-1.5">
                                                    {pack.engines.map((engine) => (
                                                        <Badge key={engine} size="sm" color="brand">
                                                            {engine}
                                                        </Badge>
                                                    ))}
                                                </span>
                                            ) : (
                                                <span className="text-warning-primary">
                                                    no engine — its agents fall back to the server
                                                    default
                                                </span>
                                            )}
                                        </Line>
                                        <Line term="Seeded into">
                                            {pack.workspaces} workspace
                                            {pack.workspaces === 1 ? "" : "s"}
                                        </Line>
                                    </dl>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}

                {packs?.length === 0 ? (
                    <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">
                        No packs yet. A workspace provisioned now gets nothing, and cannot answer a
                        call until somebody builds it an agent and a flow by hand.
                    </p>
                ) : null}
                {packs === null ? (
                    <p className="text-sm text-tertiary">Loading.</p>
                ) : null}
            </div>
        </div>
    );
};

const Line = ({
    term,
    hint,
    children,
}: {
    term: string;
    hint?: string;
    children: React.ReactNode;
}) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <dt className="flex items-center gap-1 text-xs tracking-wide text-quaternary uppercase">
            {term}
            {hint ? <InfoHint title={term} description={hint} /> : null}
        </dt>
        <dd className="text-sm text-primary">{children}</dd>
    </div>
);
