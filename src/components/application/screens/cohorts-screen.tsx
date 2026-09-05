"use client";

/**
 * The cohort list, with a way to start one.
 *
 * Creating asks for two things and refuses without either: a name, and **the
 * care path**. A cohort is defined by its path — that is why `flow_id` is
 * `not null` in migration 0110 with no join table behind it — so a dialog that
 * let you skip it would be offering to create something the database will not
 * accept.
 *
 * The path is a picker over flows rather than a box to paste a UUID into. This
 * project already wrote that lesson down once, about the agent field on a flow
 * node: *"a node that names an agent should offer the agents… getting that
 * wrong is invisible until a call reaches the node."*
 */

import { useMemo, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useResource } from "@/hooks/use-resource";
import { useSession } from "@/hooks/use-session";

type FlowRow = { id: string; name?: string; status?: string };

export const CohortsScreen = () => {
    const [open, setOpen] = useState(false);
    /* Bumped when a row is created, so the list re-reads. The dialog and the
       list hold separate `useResource` instances and neither can patch the
       other's state. */
    const [created, setCreated] = useState(0);

    return (
        <>
            <ResourceListScreen
                resourceKey="cohorts"
                reloadToken={created}
                createSlot={
                    <Button size="sm" onClick={() => setOpen(true)}>
                        Create Cohort
                    </Button>
                }
            />
            <CreateCohortDialog
                isOpen={open}
                onClose={() => setOpen(false)}
                onCreated={() => setCreated((n) => n + 1)}
            />
        </>
    );
};

const CreateCohortDialog = ({
    isOpen,
    onClose,
    onCreated,
}: {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
}) => {
    const { context } = useSession();
    const notify = useNotify();
    const { records: flows, isLoading: loadingFlows } = useResource<FlowRow>("flows");

    const [name, setName] = useState("");
    const [flowId, setFlowId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const options = useMemo(
        () => (flows ?? []).map((flow) => ({ id: flow.id, label: flow.name || "Untitled flow" })),
        [flows],
    );

    const usable = name.trim().length > 0 && Boolean(flowId);

    const create = async () => {
        if (!context || !usable) return;
        setSaving(true);
        try {
            await api.create(
                "cohorts",
                {
                    name: name.trim(),
                    flow_id: flowId,
                    // Draft, so a cohort cannot start contacting anyone before
                    // somebody has enrolled a patient and looked at it.
                    status: "draft",
                },
                context,
            );
            onClose();
            setName("");
            setFlowId(null);
            notify.success("Cohort created");
            onCreated();
        } catch (problem) {
            notify.failure("Could not create the cohort", problem);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={(next) => !next && onClose()} isDismissable={!saving}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col gap-5 rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-semibold text-primary">New cohort</h2>
                            <p className="text-sm text-tertiary">
                                One care path and the patients on it. Every patient enrolled gets their own
                                agent, running their own dates.
                            </p>
                        </div>

                        <Input
                            label="Name"
                            placeholder="Chemotherapy — day care"
                            value={name}
                            onChange={(value) => setName(String(value))}
                            isRequired
                            autoFocus
                        />

                        <Select
                            label="Care path"
                            placeholder={loadingFlows ? "Loading flows…" : "Choose the flow this cohort runs"}
                            selectedKey={flowId}
                            onSelectionChange={(key) => setFlowId(key ? String(key) : null)}
                            items={options}
                            isRequired
                            isDisabled={loadingFlows}
                            hint="A cohort is defined by its path, so this cannot be changed to a different one later without moving everybody."
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>

                        {!loadingFlows && options.length === 0 ? (
                            <p className="text-sm text-tertiary">
                                There are no flows yet. A cohort needs a care path to follow — draw one under
                                Composer first.
                            </p>
                        ) : null}

                        <div className="flex justify-end gap-3">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={create}
                                isDisabled={!usable || saving}
                                isLoading={saving}
                                showTextWhileLoading
                            >
                                {saving ? "Creating…" : "Create"}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};
