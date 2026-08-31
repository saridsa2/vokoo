// Stub — see src/app/d/agent-actions.ts.
export type SupervisorFeedItem = {
    runId: string;
    nodeId: string | null;
    action: string;
    auto: boolean;
    reason: string;
    phase?: string;
    source?: string;
    createdAt: string;
};
