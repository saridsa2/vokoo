"use client";

import { useNotify } from "@/components/application/notifications/notification-provider";
import { Button } from "@/components/base/buttons/button";
import { useResource } from "@/hooks/use-resource";
import { useSession } from "@/hooks/use-session";
import { api } from "@/utils/api-client";
import { dateTime } from "@/utils/format";

type IntegrationRun = {
    id: string;
    target_flow_id: string;
    target_flow_version: number;
    status: string;
    attempt_count: number;
    max_attempts: number;
    last_error?: string | null;
    created_at: string;
};

export function IntegrationActivity({ flowId }: { flowId?: string }) {
    const { context } = useSession();
    const notify = useNotify();
    const { records, isLoading, error, refresh } = useResource<IntegrationRun>("integration-runs");
    const runs = records.filter((run) => !flowId || run.target_flow_id === flowId).slice(0, 8);

    const retry = async (id: string) => {
        if (!context) return;
        try {
            await api.retryIntegrationRun(id, context);
            await refresh();
        } catch (problem) {
            notify.failure("Could not retry the integration", problem);
        }
    };

    if (isLoading) return <p className="text-sm text-tertiary">Loading recent activity…</p>;
    if (error) return <p className="text-sm text-error-primary">Could not load integration activity.</p>;
    if (runs.length === 0) return <p className="text-sm text-tertiary">No integration runs yet.</p>;

    return (
        <div className="overflow-hidden rounded-xl bg-primary ring-1 ring-secondary">
            <div className="border-b border-secondary px-4 py-3 text-sm font-semibold text-primary">Recent runs</div>
            <ul className="divide-y divide-secondary">
                {runs.map((run) => (
                    <li key={run.id} className="flex items-center gap-4 px-4 py-3 text-sm">
                        <span className="min-w-24 font-medium text-primary">{run.status}</span>
                        <span className="text-tertiary">
                            v{run.target_flow_version} · attempt {run.attempt_count}/{run.max_attempts}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-tertiary" title={run.last_error ?? undefined}>
                            {run.last_error ?? dateTime(run.created_at)}
                        </span>
                        {run.status === "failed" || run.status === "retryable" ? (
                            <Button size="sm" color="secondary" onClick={() => retry(run.id)}>
                                Retry
                            </Button>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}
