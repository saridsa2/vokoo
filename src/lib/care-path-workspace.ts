export type CarePathFlowChoice = {
    id: string;
    name?: string;
    family?: string;
    status?: string;
};

export const CARE_PATH_WORKSPACE = {
    family: "care_path",
    trigger_event: "care_path.due",
    trigger: "trigger.due",
    triggerName: "Milestone due",
    triggerConfig: { key: "", anchor: "enrolment", offset_days: 0, window_days: 0 },
    noun: "care path",
    empty: "A care path tracks patient milestones over time and starts work when something is due, reported, recurring, or received.",
} as const;

/** A cohort can only point at the longitudinal flow family. */
export function carePathOptions(flows: CarePathFlowChoice[]) {
    return flows
        .filter((flow) => flow.family === "care_path")
        .map((flow) => ({ id: flow.id, label: flow.name || "Untitled care path" }));
}
