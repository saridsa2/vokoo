"use client";

/**
 * The skills list, with a way to start one.
 *
 * Creating asks for a name and nothing else, which is the shape Vapi uses for
 * assistants, squads and folders alike: a thin dialog, then the detail screen
 * where the work actually happens. Asking for the wording up front would be
 * asking somebody to write a prompt into a modal they cannot see the result of.
 *
 * A new skill is a **draft**. `compose_agent_prompt` and `compose_agent_tools`
 * both filter on `status = 'published'`, so a half-written skill cannot reach a
 * caller — publishing is the deliberate step that changes that.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

/** A slug the database will accept, derived so nobody has to think about it. */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
}

export const SkillsScreen = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <ResourceListScreen
                resourceKey="skills"
                createSlot={
                    <Button size="sm" onClick={() => setOpen(true)}>
                        Create Skill
                    </Button>
                }
            />
            <CreateSkillDialog isOpen={open} onClose={() => setOpen(false)} />
        </>
    );
};

const CreateSkillDialog = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const router = useRouter();

    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    /**
     * Only the taken-name refusal, which is about the field above it. Anything
     * else that goes wrong is a notification — a message naming the name you
     * typed belongs beside where you type it, not in a corner that clears
     * itself.
     */
    const [nameTaken, setNameTaken] = useState(false);

    const slug = slugify(name);

    const create = async () => {
        if (!context || !name.trim()) return;
        setSaving(true);
        setNameTaken(false);
        try {
            const { data } = await api.create<{ id: string }>(
                "skills",
                {
                    name: name.trim(),
                    slug,
                    description: "",
                    // Draft, so it cannot reach a caller before somebody has
                    // said what it is for.
                    status: "draft",
                    collects: [],
                },
                context,
            );
            onClose();
            setName("");
            router.push(`/skills/${data.id}`);
        } catch (problem) {
            if (/duplicate|unique/i.test((problem as Error).message)) setNameTaken(true);
            else notify.failure("Could not create the skill", problem);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={(next) => !next && onClose()} isDismissable={!saving}>
            <Modal className="max-w-md">
                <Dialog>
                    {/* `Modal` and `Dialog` are positioning only — they paint
                        nothing. Without a surface here the content floats on the
                        dimmed page with no panel behind it. */}
                    <div className="flex w-full flex-col gap-5 rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-semibold text-primary">New skill</h2>
                            <p className="text-sm text-tertiary">
                                One thing an agent can do. You will say what it is for on the next screen.
                            </p>
                        </div>

                        <Input
                            label="Name"
                            placeholder="Book an appointment"
                            value={name}
                            onChange={(value) => {
                                setName(String(value));
                                // The refusal was about the name that was sent,
                                // so it stops applying the moment it changes.
                                setNameTaken(false);
                            }}
                            isRequired
                            isInvalid={nameTaken}
                            autoFocus
                            hint={slug ? `Referred to as ${slug}` : undefined}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && name.trim() && !saving) void create();
                            }}
                        />

                        {nameTaken ? (
                            <p className="text-sm text-error-primary">
                                A skill with a very similar name already exists. Try another.
                            </p>
                        ) : null}

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
