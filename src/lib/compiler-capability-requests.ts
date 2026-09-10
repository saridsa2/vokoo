import {
    COMPILER_CAPABILITY_REQUEST_STATUSES,
    type CompilerCapabilityRequestStatus,
} from "./document-workspace";

export type OperatorCapabilityAction = "review" | "resolve_existing" | "request_information" | "deliver" | "decline";

export type OperatorCapabilityRequest = {
    id: string;
    org_id: string;
    organization_name: string;
    run_id: string;
    gap_id: string;
    capability_key: string;
    requested_contract: Record<string, unknown>;
    contract_digest: string;
    status: CompilerCapabilityRequestStatus;
    workspace_note: string | null;
    operator_response: string | null;
    delivery_reference: string | null;
    active_resolution_id: string | null;
    demand_count: number;
    created_at: string;
    updated_at: string;
};

export type OperatorCapabilityAdapter = {
    adapter_key: "clinical-task-escalate-notify-v1";
    adapter_version: number;
    capability_key: "clinical.task";
    label: string;
    mapping_schema: Record<string, unknown>;
    compatible_nodes: Array<{ id: "escalate.notify"; label: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/i;
const REQUEST_STATUSES = new Set<string>(COMPILER_CAPABILITY_REQUEST_STATUSES);

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

export function operatorActions(request: Pick<OperatorCapabilityRequest, "status">): OperatorCapabilityAction[] {
    switch (request.status) {
        case "requested":
            return ["review", "decline"];
        case "under_review":
            return ["resolve_existing", "request_information", "deliver", "decline"];
        case "needs_information":
            return ["review", "decline"];
        case "delivering":
            return ["resolve_existing", "request_information", "decline"];
        default:
            return [];
    }
}

export function capabilityLabel(key: string): string {
    if (key === "clinical.task") return "Create work for a clinician";
    if (key === "clinical.threshold_mapping") return "Evaluate a clinical observation threshold";
    return "Compiler capability";
}

export function normalizeOperatorCapabilityRequests(input: unknown): OperatorCapabilityRequest[] {
    if (!Array.isArray(input)) return [];
    return input.flatMap((value): OperatorCapabilityRequest[] => {
        const item = record(value);
        const contract = record(item?.requested_contract);
        if (
            !item ||
            typeof item.id !== "string" ||
            !UUID_PATTERN.test(item.id) ||
            typeof item.org_id !== "string" ||
            !UUID_PATTERN.test(item.org_id) ||
            typeof item.run_id !== "string" ||
            !UUID_PATTERN.test(item.run_id) ||
            typeof item.gap_id !== "string" ||
            !UUID_PATTERN.test(item.gap_id) ||
            typeof item.organization_name !== "string" ||
            !item.organization_name.trim() ||
            typeof item.capability_key !== "string" ||
            !item.capability_key ||
            !contract ||
            typeof item.contract_digest !== "string" ||
            !DIGEST_PATTERN.test(item.contract_digest) ||
            typeof item.status !== "string" ||
            !REQUEST_STATUSES.has(item.status) ||
            !Number.isInteger(item.demand_count) ||
            (item.demand_count as number) < 1 ||
            typeof item.created_at !== "string" ||
            typeof item.updated_at !== "string"
        )
            return [];
        const activeResolutionId = item.active_resolution_id === null ? null : nullableString(item.active_resolution_id);
        if (activeResolutionId !== null && !UUID_PATTERN.test(activeResolutionId)) return [];
        return [
            {
                id: item.id,
                org_id: item.org_id,
                organization_name: item.organization_name.trim(),
                run_id: item.run_id,
                gap_id: item.gap_id,
                capability_key: item.capability_key,
                requested_contract: contract,
                contract_digest: item.contract_digest,
                status: item.status as CompilerCapabilityRequestStatus,
                workspace_note: nullableString(item.workspace_note),
                operator_response: nullableString(item.operator_response),
                delivery_reference: nullableString(item.delivery_reference),
                active_resolution_id: activeResolutionId,
                demand_count: item.demand_count as number,
                created_at: item.created_at,
                updated_at: item.updated_at,
            },
        ];
    });
}

export function normalizeOperatorCapabilityAdapters(input: unknown): OperatorCapabilityAdapter[] {
    if (!Array.isArray(input)) return [];
    return input.flatMap((value): OperatorCapabilityAdapter[] => {
        const item = record(value);
        const schema = record(item?.mapping_schema);
        if (
            !item ||
            item.adapter_key !== "clinical-task-escalate-notify-v1" ||
            item.capability_key !== "clinical.task" ||
            !Number.isInteger(item.adapter_version) ||
            (item.adapter_version as number) < 1 ||
            typeof item.label !== "string" ||
            !item.label ||
            !schema ||
            !Array.isArray(item.compatible_nodes)
        )
            return [];
        const compatibleNodes = item.compatible_nodes.flatMap((candidate): Array<{ id: "escalate.notify"; label: string }> => {
            const node = record(candidate);
            if (!node || node.id !== "escalate.notify" || typeof node.label !== "string" || !node.label) return [];
            return [{ id: "escalate.notify", label: node.label }];
        });
        if (compatibleNodes.length === 0) return [];
        return [
            {
                adapter_key: item.adapter_key,
                adapter_version: item.adapter_version as number,
                capability_key: item.capability_key,
                label: item.label,
                mapping_schema: schema,
                compatible_nodes: compatibleNodes,
            },
        ];
    });
}
