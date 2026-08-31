"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { Table, TableCard } from "@/components/application/table/table";
import { useSession } from "@/hooks/use-session";
import { ApiError, api } from "@/utils/api-client";
import { dateTime, timeAgo } from "@/utils/format";

/**
 * Settings screens.
 *
 * These do not go through `useResource`: organization and members sit behind
 * dedicated endpoints rather than the generic `/api/v1/{resource}` route,
 * because each has rules the generic CRUD path deliberately does not allow —
 * creating an organization is an atomic RPC that also writes the owner's
 * membership.
 */

/** Shared loader for the dedicated settings endpoints. */
function useSettingsData<T>(load: (context: NonNullable<ReturnType<typeof useSession>["context"]>) => Promise<{ data: T }>) {
    const { context, isReady } = useSession();
    const [data, setData] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<ApiError | null>(null);

    const refresh = useCallback(async () => {
        if (!context) return;
        setIsLoading(true);
        setError(null);
        try {
            const result = await load(context);
            setData(result.data);
        } catch (cause) {
            setError(cause instanceof ApiError ? cause : new ApiError(String(cause), 0));
        } finally {
            setIsLoading(false);
        }
    }, [context, load]);

    useEffect(() => {
        if (!isReady) return;
        void refresh();
    }, [isReady, refresh]);

    return { data, isLoading, error, refresh };
}

function ErrorNote({ error }: { error: ApiError }) {
    return (
        <div className="rounded-xl bg-error-primary p-6 ring-1 ring-error_subtle">
            <p className="text-sm font-semibold text-error-primary">Could not load</p>
            <p className="mt-1 text-sm text-error-primary">{error.message}</p>
        </div>
    );
}

/* --------------------------------------------------------- Organization */

type Organization = { id: string; name: string; slug: string; plan: string; created_at: string };

export function OrganizationScreen() {
    const { context } = useSession();
    const { data, isLoading, error, refresh } = useSettingsData<Organization>(
        useCallback((ctx) => api.organization<Organization>(ctx), []),
    );

    const [name, setName] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => setName(data?.name ?? ""), [data?.name]);

    const isDirty = !!data && name.trim() !== data.name && name.trim().length > 0;

    async function save() {
        if (!context || !data || !isDirty) return;
        setIsSaving(true);
        try {
            // PATCH /settings/organization, not the generic resource route:
            // organizations are not in the API's resource allowlist.
            await fetch(`${process.env.NEXT_PUBLIC_CONTROLPLANE_API_URL}/api/v1/settings/organization`, {
                method: "PATCH",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${context.accessToken}`,
                    "x-org-id": context.organizationId,
                },
                body: JSON.stringify({ name: name.trim() }),
            });
            await refresh();
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <>
            <ScreenHeader
                title="Organization"
                description="Workspace identity and plan."
                actions={
                    <Button size="sm" isDisabled={!isDirty} isLoading={isSaving} showTextWhileLoading onClick={save}>
                        Save
                    </Button>
                }
            />

            <div className="max-w-2xl p-6">
                {error ? (
                    <ErrorNote error={error} />
                ) : isLoading ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : !data ? (
                    <p className="text-sm text-tertiary">No organization found.</p>
                ) : (
                    <section className="flex flex-col gap-5 rounded-xl p-5 ring-1 ring-secondary">
                        <Input label="Name" value={name} onChange={(value) => setName(String(value))} />
                        <Input label="Slug" value={data.slug} isDisabled hint="Used in URLs. Cannot be changed after creation." />

                        <div className="flex items-center justify-between border-t border-secondary pt-4">
                            <div>
                                <p className="text-sm font-medium text-secondary">Plan</p>
                                <p className="mt-0.5 text-xs text-tertiary">Created {dateTime(data.created_at)}</p>
                            </div>
                            <Badge size="sm" type="pill-color" color="brand">
                                {data.plan}
                            </Badge>
                        </div>
                    </section>
                )}
            </div>
        </>
    );
}

/* -------------------------------------------------------------- Members */

type Member = { id: string; user_id: string; role: string; email?: string; created_at: string };

export function MembersScreen() {
    const { data, isLoading, error } = useSettingsData<Member[]>(useCallback((ctx) => api.members<Member>(ctx), []));
    const members = data ?? [];

    return (
        <>
            <ScreenHeader
                title="Members"
                description="Who has access to this workspace."
                actions={<Button size="sm">Invite Member</Button>}
            />

            <div className="p-6">
                {error ? (
                    <ErrorNote error={error} />
                ) : isLoading ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : members.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-secondary p-12 text-center">
                        <p className="text-sm font-medium text-primary">No members</p>
                        <p className="mt-1 text-sm text-tertiary">Invite someone to give them access to this workspace.</p>
                    </div>
                ) : (
                    <TableCard.Root size="md">
                        <Table aria-label="Members">
                            <Table.Header>
                                <Table.Head id="member" label="Member" isRowHeader />
                                <Table.Head id="role" label="Role" />
                                <Table.Head id="joined" label="Joined" />
                            </Table.Header>
                            <Table.Body items={members}>
                                {(member) => (
                                    <Table.Row id={member.id}>
                                        <Table.Cell>{member.email ?? member.user_id.slice(0, 8)}</Table.Cell>
                                        <Table.Cell>
                                            <Badge size="sm" type="pill-color" color={member.role === "owner" ? "brand" : "gray"}>
                                                {member.role}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>{timeAgo(member.created_at)}</Table.Cell>
                                    </Table.Row>
                                )}
                            </Table.Body>
                        </Table>
                    </TableCard.Root>
                )}
            </div>
        </>
    );
}

/* ------------------------------------------------------------- API keys */


