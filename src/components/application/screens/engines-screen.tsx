"use client";

/**
 * The engines list, with a way to start one.
 *
 * Creating asks for a name and the shape, and nothing else. The shape is here
 * rather than on the detail screen because it decides what the rest of the form
 * even asks — one model, or three services — and changing it later clears every
 * choice underneath it.
 *
 * A new engine is a draft. The bridge only reads engines whose status is
 * published, so a half-configured chain cannot become what answers the phone
 * until somebody says so.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { Select } from "@/components/base/select/select";
import { api } from "@/utils/api-client";
import { slugify } from "@/components/application/screens/skills-screen";
import { useSession } from "@/hooks/use-session";

// The supporting text lands on the select trigger beside the label, on one
// line: a sentence there pushes the label out of view. Two or three words.
const SHAPES = [
    { id: "realtime", label: "One model", supportingText: "Lowest latency" },
    { id: "cascading", label: "Relay", supportingText: "Three services" },
];

export const EnginesScreen = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <ResourceListScreen
                resourceKey="engines"
                createSlot={
                    <Button size="sm" onClick={() => setOpen(true)}>
                        Create Engine
                    </Button>
                }
            />
            <CreateEngineDialog isOpen={open} onClose={() => setOpen(false)} />
        </>
    );
};

const CreateEngineDialog = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const { context } = useSession();
    const router = useRouter();

    const [name, setName] = useState("");
    const [mode, setMode] = useState("realtime");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const slug = slugify(name);

    const create = async () => {
        if (!context || !name.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const { data } = await api.create<{ id: string }>(
                "engines",
                { name: name.trim(), slug, description: "", mode, config: {}, status: "draft" },
                context,
            );
            onClose();
            setName("");
            router.push(`/engines/${data.id}`);
        } catch (problem) {
            const message = (problem as Error).message;
            setError(
                /duplicate|unique/i.test(message)
                    ? "An engine with a very similar name already exists. Try another."
                    : message,
            );
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
                            <h2 className="text-lg font-semibold text-primary">New engine</h2>
                            <p className="text-sm text-tertiary">Providers are chosen on the next screen.</p>
                        </div>

                        <Input
                            label="Name"
                            placeholder="Hindi reception line"
                            value={name}
                            onChange={(value) => setName(String(value))}
                            isRequired
                            autoFocus
                            hint={slug ? `Referred to as ${slug}` : undefined}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && name.trim() && !saving) void create();
                            }}
                        />

                        <Select
                            label="Shape"
                            selectedKey={mode}
                            onSelectionChange={(key) => setMode(String(key))}
                            items={SHAPES}
                        >
                            {(item) => (
                                <Select.Item id={item.id} supportingText={item.supportingText}>
                                    {item.label}
                                </Select.Item>
                            )}
                        </Select>

                        {error ? <p className="text-sm text-error-primary">{error}</p> : null}

                        <div className="flex justify-end gap-3">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={create} isDisabled={!name.trim() || saving} isLoading={saving} showTextWhileLoading>
                                {saving ? "Creating…" : "Create"}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};
