"use client";

/** One number and the call flow whose lifecycle it runs. */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Select } from "@/components/base/select/select";
import { ArrowLeft } from "@/components/icons";
import { api } from "@/utils/api-client";
import { callFlowChoices, selectedCallFlow } from "@/utils/number-flow-binding";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

type PhoneNumber = { id: string; number: string; label: string; status: string };
type Flow = { id: string; name: string; status: string; family?: string };
type Binding = { id: string; trigger_event: string; flow_id: string };

export const PhoneNumberDetailScreen = ({ numberId }: { numberId: string }) => {
    const { context, isReady } = useSession();
    const notify = useNotify();

    const [number, setNumber] = useState<PhoneNumber | null>(null);
    const [flows, setFlows] = useState<Flow[]>([]);
    const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const [detail, allFlows, bound] = await Promise.all([
                    api.get<PhoneNumber>("phone-numbers", numberId, context),
                    api.list<Flow>("flows", context),
                    api.numberFlows<Binding>(numberId, context),
                ]);
                if (!live) return;
                setNumber(detail.data);
                setFlows(allFlows.data ?? []);
                setSelectedFlow(selectedCallFlow(bound.data ?? []));
            } catch (problem) {
                if (live) notify.failure("Could not load this number", problem);
            }
        })();
        return () => {
            live = false;
        };
    }, [numberId, context, isReady, notify]);

    const callFlows = useMemo(() => callFlowChoices(flows), [flows]);

    const bind = useCallback(
        async (flowId: string | null) => {
            if (!context) return;
            setBusy(true);
            setNote(null);
            try {
                await api.setNumberFlow(numberId, flowId, context);
                setSelectedFlow(flowId);
                const flow = flows.find((row) => row.id === flowId);
                setNote(
                    !flowId
                        ? "Unbound. This number has no call flow."
                        : flow?.status === "published"
                          ? `Bound. The next call will run ${flow.name}.`
                          : `Bound, but ${flow?.name} is a draft — a call cannot reach it until it is published.`,
                );
            } catch (problem) {
                notify.failure("Could not bind the flow", problem);
            } finally {
                setBusy(false);
            }
        },
        [context, numberId, flows, notify],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-col gap-3">
                <Button href="/phone-numbers" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Phone Numbers
                </Button>
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-mono text-display-xs font-semibold text-primary">{number?.number ?? "…"}</h1>
                    {number ? (
                        <Badge color={number.status === "active" ? "success" : "gray"} size="sm">
                            {number.status}
                        </Badge>
                    ) : null}
                </div>
                {number?.label ? <p className="text-md text-tertiary">{number.label}</p> : null}
            </header>

            {note ? <p className="text-sm text-brand-secondary">{note}</p> : null}

            <section className="flex max-w-2xl flex-col gap-5">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold text-primary">
                    Call flow
                    <InfoHint title="The selected flow owns the call lifecycle. Its trigger nodes decide what happens when the call is answered, ends, or fails." />
                </h2>
                <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-secondary">Flow for this number</span>
                    <Select
                        aria-label="Call flow"
                        selectedKey={selectedFlow ?? ""}
                        isDisabled={busy}
                        onSelectionChange={(key) => void bind(String(key) || null)}
                        items={[
                            { id: "", label: "Nothing" },
                            ...callFlows.map((flow) => ({
                                id: flow.id,
                                label: flow.status === "published" ? flow.name : `${flow.name} (draft)`,
                            })),
                        ]}
                    >
                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                    </Select>
                    {callFlows.length === 0 ? (
                        <span className="text-xs text-tertiary">Create a call flow before assigning this number.</span>
                    ) : null}
                </div>
            </section>
        </div>
    );
};
