"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { AlertCircle, CheckCircle, IconLock, RefreshCcw02, Share04, Trash01 } from "@/components/icons";
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

/** Which role a step of an engine puts its vendor in. */
const STAGE_ROLE: Record<string, string> = {
    llm: "llm",
    // A speech-to-speech model is a model. It belongs beside the others you
    // would compare it against, not in a category of one.
    realtime: "llm",
    tts: "voice",
    stt: "transcription",
};

/**
 * Vendors the control plane knows how to probe.
 *
 * Each has a cheap authenticated listing endpoint. Kept in step with the match
 * in `test_credential`; a vendor missing from either simply gets no button.
 */
const TESTABLE = new Set(["openai", "gemini", "deepgram"]);

const TABS = [
    {
        id: "llm",
        label: "Language models",
        description: "The accounts your agents think on.",
    },
    {
        id: "voice",
        label: "Voice",
        description: "Accounts that turn a reply into speech.",
    },
    {
        id: "transcription",
        label: "Transcription",
        description: "Accounts that turn caller audio into text.",
    },
    {
        id: "telephony",
        label: "Telephony",
        description: "The carrier that carries the calls.",
    },
];

export function CredentialsScreen() {
    const { context, isReady } = useSession();
    const { catalogue } = useCatalogue();

    const [connected, setConnected] = useState<Credential[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<VendorSlot | null>(null);
    const [tab, setTab] = useState("llm");
    const [refreshing, setRefreshing] = useState(false);
    const [refreshed, setRefreshed] = useState<string | null>(null);

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

    /**
     * Ask every connected provider what it currently offers.
     *
     * The lists an engine chooses from were typed by hand, and one of them named
     * a Sarvam model Sarvam had retired — which a caller discovered as silence.
     * This replaces them with what the providers actually say.
     *
     * The bridge does the asking, because it is the only process that may read a
     * key. Providers with no key are skipped, and one that answers with nothing
     * keeps its stored list rather than being emptied.
     */
    async function refreshCatalogue() {
        if (!context) return;
        setRefreshing(true);
        setRefreshed(null);
        setError(null);
        try {
            const { data } = await api.refreshCatalogue<{
                refreshed: { id: string; models: number; voices: number; error: string | null }[];
            }>(context);
            const rows = data.refreshed ?? [];
            const failed = rows.filter((row) => row.error);
            setRefreshed(
                rows.length === 0
                    ? "No provider that publishes a catalogue is connected yet."
                    : failed.length > 0
                      ? `${failed.map((row) => `${row.id}: ${row.error}`).join("; ")}`
                      : `Updated ${rows.length} from the providers.`,
            );
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : String(cause));
        } finally {
            setRefreshing(false);
        }
    }

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

    /**
     * What each vendor is for, derived rather than declared.
     *
     * `catalogue_vendors.kind` only knows "inference" and "telephony", which put
     * six accounts doing three different jobs under one heading. The engine
     * catalogue already records which step of a chain each vendor can fill, and
     * a vendor can fill more than one — Sarvam transcribes, thinks and speaks;
     * Deepgram transcribes and speaks. So a vendor appears under every role it
     * actually has, and a provider withdrawn for not calling tools stops
     * appearing under that role without anything here changing.
     */
    const rolesByVendor = new Map<string, Set<string>>();
    for (const stage of catalogue.engineStages) {
        if (!stage.vendor_id) continue;
        const role = STAGE_ROLE[stage.stage];
        if (!role) continue;
        const roles = rolesByVendor.get(stage.vendor_id) ?? new Set<string>();
        roles.add(role);
        rolesByVendor.set(stage.vendor_id, roles);
    }

    const groups = TABS.map((tab) => ({
        ...tab,
        items: slots.filter((slot) =>
            tab.id === "telephony"
                ? slot.kind === "telephony"
                : (rolesByVendor.get(slot.id)?.has(tab.id) ?? false),
        ),
    })).filter((tab) => tab.items.length > 0);

    const active = groups.some((group) => group.id === tab) ? tab : (groups[0]?.id ?? "llm");
    const shown = groups.find((group) => group.id === active);

    return (
        <>
            <ScreenHeader
                title="Providers"
                description="Accounts VoKoo uses on your behalf."
                actions={
                    <Button
                        size="sm"
                        color="secondary"
                        iconLeading={RefreshCcw02}
                        isDisabled={refreshing}
                        isLoading={refreshing}
                        showTextWhileLoading
                        onClick={refreshCatalogue}
                    >
                        {refreshing ? "Asking providers…" : "Refresh models"}
                    </Button>
                }
            />

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
                <p className="flex max-w-3xl items-start gap-2 border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
                    <IconLock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                        A key is encrypted the moment it is saved and cannot be read back — by this screen, by the API, or by
                        anyone signed in. Only the telephony bridge can decrypt one, at the moment it places a call. To change a
                        key, replace it.
                    </span>
                </p>

                {refreshed && (
                    <p className="text-sm text-brand-secondary" role="status">
                        {refreshed}
                    </p>
                )}

                {error && (
                    <p className="text-sm text-error-primary" role="alert">
                        {error}
                    </p>
                )}

                {isLoading && <p className="text-sm text-tertiary">Loading…</p>}

                {!isLoading && groups.length > 1 && (
                    <Tabs selectedKey={active} onSelectionChange={(key) => setTab(String(key))}>
                        <Tabs.List
                            type="underline"
                            items={groups.map((group) => ({
                                id: group.id,
                                label: group.label,
                                // The count is the answer to "have I finished
                                // here", which is why anyone opens this screen.
                                badge: `${group.items.filter((slot) => byVendor.has(slot.id)).length}/${group.items.length}`,
                            }))}
                        >
                            {(item) => <Tabs.Item {...item} />}
                        </Tabs.List>
                    </Tabs>
                )}

                {!isLoading &&
                    [shown].filter(Boolean).map((group) =>
                        group!.items.length === 0 ? null : (
                            <section key={group!.id} className="flex flex-col gap-3">
                                <p className="max-w-2xl text-sm text-tertiary">{group!.description}</p>

                                <ul className="flex flex-col divide-y divide-border-secondary border-t border-b border-secondary">
                                    {group!.items.map((slot) => {
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
                                                            target="_blank"
                                                            rel="noopener noreferrer"
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
    const [isTesting, setIsTesting] = useState(false);
    const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Clear on open, so a key typed for one provider can never be submitted
    // against another.
    useEffect(() => {
        setSecret("");
        setError(null);
        setVerdict(null);
    }, [slot]);

    // A verdict belongs to the key it was reached on. Editing the key makes it
    // stale, and a stale "Works" beside a changed key is worse than none.
    useEffect(() => {
        setVerdict(null);
    }, [secret]);

    /**
     * Ask the provider whether this key authenticates.
     *
     * Tested as typed rather than after saving: nothing may read a stored key —
     * the resolver is service_role only, and the control plane holds no service
     * key. Typing is also when a wrong key is worth catching.
     */
    async function test() {
        if (!slot || !context || !secret.trim()) return;
        setIsTesting(true);
        setError(null);
        try {
            const { data } = await api.testVendorKey(slot.id, secret.trim(), context);
            // The server answers in vendor ids because that is what it routes
            // on; the reader knows the label. Rewritten here rather than there,
            // so the API keeps one vocabulary and the screen keeps the other.
            const rejected = data.reason?.includes("rejected");
            setVerdict(
                !data.supported
                    ? { ok: false, text: `There is no way to check a ${slot.label} key yet.` }
                    : data.ok
                      ? { ok: true, text: `${slot.label} accepted this key.` }
                      : {
                            ok: false,
                            text: rejected
                                ? `${slot.label} rejected this key.`
                                : (data.reason ?? `${slot.label} did not accept this key.`),
                        },
            );
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : String(cause));
        } finally {
            setIsTesting(false);
        }
    }

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

                            {verdict && (
                                <p
                                    className={`flex items-center gap-1.5 text-sm ${verdict.ok ? "text-success-primary" : "text-error-primary"}`}
                                    role="status"
                                >
                                    {verdict.ok ? <CheckCircle className="size-4" /> : <AlertCircle className="size-4" />}
                                    {verdict.text}
                                </p>
                            )}

                            {error && (
                                <p className="text-sm text-error-primary" role="alert">
                                    {error}
                                </p>
                            )}
                        </div>

                        <footer className="flex items-center justify-end gap-3 border-t border-secondary px-6 py-4">
                            {/* Only where a probe exists. A Test button that
                                always passes is worse than no button. */}
                            {slot && TESTABLE.has(slot.id) && (
                                <Button
                                    size="sm"
                                    color="link-gray"
                                    className="mr-auto"
                                    isDisabled={!secret.trim() || isSaving}
                                    isLoading={isTesting}
                                    showTextWhileLoading
                                    onClick={test}
                                >
                                    {isTesting ? "Testing…" : "Test key"}
                                </Button>
                            )}
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
