"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { AlertCircle, CheckCircle, IconLock, Share04, Trash01 } from "@/components/icons";
import { useCatalogue } from "@/hooks/use-catalogue";
import type { CatalogueVendor } from "@/utils/capability-registry";
import { useSession } from "@/hooks/use-session";
import { ApiError, api } from "@/utils/api-client";
import { timeAgo } from "@/utils/format";

/**
 * Provider keys.
 *
 * The point of this screen is that connecting an account stops being an SSH
 * session. A key typed here is written into the database's vault and can never
 * be read back — not by this screen, not by the API. What comes back is four
 * characters and a date, which is enough to answer "is the right key in place"
 * and nothing more.
 *
 * Rotation replaces the secret behind the same row, so a key can be changed
 * without anything that references it breaking.
 */

type Credential = {
    id: string;
    vendor: string;
    label: string | null;
    hint: string | null;
    created_at: string;
    updated_at: string;
};

type VendorSlot = CatalogueVendor;

export function CredentialsScreen() {
    const { context, isReady } = useSession();
    const { catalogue } = useCatalogue();

    const [connected, setConnected] = useState<Credential[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<VendorSlot | null>(null);

    // What can be connected is catalogue data, so it arrives with everything
    // else the catalogue carries rather than through a request of its own.
    const slots = catalogue.vendors;

    const refresh = useCallback(async () => {
        if (!context) return;
        setIsLoading(true);
        setError(null);
        try {
            const { data } = await api.vendorKeys<Credential>(context);
            setConnected(data ?? []);
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : String(cause));
        } finally {
            setIsLoading(false);
        }
    }, [context]);

    useEffect(() => {
        if (!isReady) return;
        void refresh();
    }, [isReady, refresh]);

    async function disconnect(slot: VendorSlot) {
        if (!context) return;
        if (!window.confirm(`Remove the ${slot.label} key? Agents and flows that need it will stop working on the next call.`)) return;
        try {
            await api.deleteVendorKey(slot.id, context);
            await refresh();
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : String(cause));
        }
    }

    const byVendor = new Map(connected.map((credential) => [credential.vendor, credential]));

    // A provider an agent is published on, with no key, is the failure worth
    // surfacing here rather than on the next call.
    const needed = new Set(
        catalogue.providers.filter((provider) => !provider.is_sovereign).map((provider) => provider.id),
    );

    const groups = ["inference", "telephony"].map((kind) => ({
        kind,
        title: kind === "inference" ? "Model providers" : "Telephony",
        items: slots.filter((slot) => slot.kind === kind),
    }));

    return (
        <>
            <ScreenHeader
                title="Provider Keys"
                description="Accounts VoKoo uses on your behalf — the model providers your agents run on, and the carrier that carries the calls."
            />

            <div className="flex flex-col gap-6 p-6">
                <p className="flex max-w-3xl items-start gap-2 border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
                    <IconLock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                        A key is encrypted the moment it is saved and cannot be read back — by this screen, by the API, or by
                        anyone signed in. Only the telephony bridge can decrypt one, at the moment it places a call. To change a
                        key, replace it.
                    </span>
                </p>

                {error && (
                    <p className="text-sm text-error-primary" role="alert">
                        {error}
                    </p>
                )}

                {isLoading && <p className="text-sm text-tertiary">Loading…</p>}

                {!isLoading &&
                    groups.map((group) =>
                        group.items.length === 0 ? null : (
                            <section key={group.kind} className="flex flex-col gap-3">
                                <h2 className="text-xs font-semibold tracking-wide text-tertiary uppercase">{group.title}</h2>

                                <ul className="flex flex-col divide-y divide-border-secondary border-t border-b border-secondary">
                                    {group.items.map((slot) => {
                                        const credential = byVendor.get(slot.id);
                                        const isMissing = !credential && needed.has(slot.id);

                                        return (
                                            <li key={slot.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-medium text-primary">{slot.label}</span>
                                                        {credential ? (
                                                            <Badge size="sm" type="pill-color" color="success">
                                                                Connected
                                                            </Badge>
                                                        ) : isMissing ? (
                                                            <Badge size="sm" type="pill-color" color="warning">
                                                                Needed
                                                            </Badge>
                                                        ) : (
                                                            <Badge size="sm" type="modern">
                                                                Not connected
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    <p className="mt-1 max-w-2xl text-sm text-tertiary">{slot.description}</p>

                                                    {credential && (
                                                        <p className="mt-1 font-mono text-xs text-tertiary">
                                                            {credential.hint ? `ends ${credential.hint}` : "key stored"} ·
                                                            updated {timeAgo(credential.updated_at)}
                                                        </p>
                                                    )}

                                                    {isMissing && (
                                                        <p className="mt-1 flex items-center gap-1.5 text-xs text-warning-primary">
                                                            <AlertCircle className="size-3.5" />
                                                            An agent is published on this provider. Calls to it will fail until a
                                                            key is added.
                                                        </p>
                                                    )}
                                                </div>

                                                <div className="flex flex-none items-center gap-2">
                                                    {slot.help_url && (
                                                        <Button
                                                            size="sm"
                                                            color="link-gray"
                                                            href={slot.help_url}
                                                            iconTrailing={Share04}
                                                        >
                                                            Get a key
                                                        </Button>
                                                    )}
                                                    <Button size="sm" color="secondary" onClick={() => setEditing(slot)}>
                                                        {credential ? "Replace" : "Connect"}
                                                    </Button>
                                                    {credential && (
                                                        <Button
                                                            size="sm"
                                                            color="tertiary-destructive"
                                                            iconLeading={Trash01}
                                                            aria-label={`Remove the ${slot.label} key`}
                                                            onClick={() => disconnect(slot)}
                                                        />
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        ),
                    )}
            </div>

            <CredentialDialog
                slot={editing}
                isReplacing={!!editing && byVendor.has(editing.id)}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void refresh();
                }}
            />
        </>
    );
}

function CredentialDialog({
    slot,
    isReplacing,
    onClose,
    onSaved,
}: {
    slot: VendorSlot | null;
    isReplacing: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { context } = useSession();
    const [secret, setSecret] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Clear on open, so a key typed for one provider can never be submitted
    // against another.
    useEffect(() => {
        setSecret("");
        setError(null);
    }, [slot]);

    async function save() {
        if (!slot || !context || !secret.trim()) return;
        setIsSaving(true);
        setError(null);
        try {
            await api.setVendorKey({ vendor: slot.id, secret: secret.trim(), label: slot.label }, context);
            setSecret("");
            onSaved();
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : String(cause));
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <ModalOverlay isOpen={!!slot} onOpenChange={(open) => !open && onClose()} isDismissable={!isSaving}>
            <Modal className="max-w-lg">
                <Dialog>
                    <div className="flex w-full flex-col bg-primary ring-1 ring-secondary">
                        <header className="border-b border-secondary px-6 py-5">
                            <h2 className="text-lg font-semibold text-primary">
                                {isReplacing ? `Replace the ${slot?.label} key` : `Connect ${slot?.label}`}
                            </h2>
                            <p className="mt-1 text-sm text-tertiary">
                                {isReplacing
                                    ? "The current key is overwritten. Calls in progress finish on the key they started with."
                                    : slot?.description}
                            </p>
                        </header>

                        <div className="flex flex-col gap-4 px-6 py-5">
                            <Input
                                label="Key"
                                type="password"
                                autoComplete="off"
                                placeholder="Paste the key"
                                value={secret}
                                onChange={(value) => setSecret(String(value))}
                                hint="Stored encrypted. It cannot be displayed again after saving."
                            />

                            {error && (
                                <p className="text-sm text-error-primary" role="alert">
                                    {error}
                                </p>
                            )}
                        </div>

                        <footer className="flex justify-end gap-3 border-t border-secondary px-6 py-4">
                            <Button size="sm" color="secondary" isDisabled={isSaving} onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                iconLeading={CheckCircle}
                                isDisabled={!secret.trim()}
                                isLoading={isSaving}
                                showTextWhileLoading
                                onClick={save}
                            >
                                Save key
                            </Button>
                        </footer>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
