export type NumberFlowBinding = {
    trigger_event: string;
    flow_id: string;
};

export type FamilyFlow = {
    id: string;
    family?: string;
};

/** A phone number selects a call flow, never an integration or care path. */
export function callFlowChoices<T extends FamilyFlow>(flows: T[]): T[] {
    return flows.filter((flow) => flow.family === "call");
}

/** Collapse the old per-event rows to the one canonical call-flow binding. */
export function selectedCallFlow(bindings: NumberFlowBinding[]): string | null {
    return bindings.find((binding) => binding.trigger_event === "call.answered")?.flow_id ?? null;
}
