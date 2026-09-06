import type { FlowGraph, FlowNode, FlowTransition } from "@/utils/flow-graph";

export type IntegrationMigrationPreview = {
    integration: FlowGraph;
    call: FlowGraph;
    removedFromIntegration: string[];
    addedToCall: string[];
};

function uniqueId(graph: FlowGraph, wanted: string): string {
    let id = wanted;
    let suffix = 1;
    while (graph.nodes.some((node) => node.id === id)) id = `${wanted}_${suffix++}`;
    return id;
}

/** Pure preview: callers must explicitly persist both returned graphs. */
export function previewLegacyIntegrationMigration(integration: FlowGraph, call: FlowGraph, integrationId: string): IntegrationMigrationPreview {
    const ended = integration.nodes.find((node) => node.implementation === "trigger.call_ended");
    const extraction = integration.nodes.find((node) => node.implementation === "intelligence");
    if (!ended) throw new Error("legacy integration has no call-ended trigger");
    if (!extraction) throw new Error("legacy integration has no extraction node");
    const schemaId = typeof extraction.config.shape_id === "string" ? extraction.config.shape_id : "";
    if (!schemaId) throw new Error("legacy extraction node has no output schema");

    const removed = new Set([ended.id, extraction.id]);
    const trigger: FlowNode = {
        ...structuredClone(ended),
        implementation: "trigger.integration_invoked",
        name: "Integration invoked",
        config: { input_schema_id: schemaId },
    };
    const outgoing = integration.transitions.filter((edge) => edge.from === extraction.id);
    const keptTransitions = integration.transitions.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
    const integrationTransitions: FlowTransition[] = [...keptTransitions, ...outgoing.map((edge) => ({ ...edge, from: trigger.id, outcome: "started" }))];

    const callEnded = call.nodes.find((node) => node.implementation === "trigger.call_ended");
    const triggerId = callEnded?.id ?? uniqueId(call, "call_ended");
    if (
        call.transitions.some(
            (edge) => edge.from === triggerId && ["caller_hung_up", "we_ended"].includes(edge.outcome),
        )
    ) {
        throw new Error("the call-ended trigger already has a route; choose how to merge it manually");
    }
    const extractionId = uniqueId(call, "extract_for_integration");
    const callWithExtraction = { ...call, nodes: [...call.nodes, { ...structuredClone(extraction), id: extractionId }] };
    const invokeId = uniqueId(callWithExtraction, "invoke_integration");
    const addedNodes: FlowNode[] = [
        ...(callEnded
            ? []
            : [
                  {
                      id: triggerId,
                      type: "trigger",
                      implementation: "trigger.call_ended",
                      name: "Call ended",
                      position: { x: extraction.position.x - 320, y: extraction.position.y },
                      config: {},
                  },
              ]),
        { ...structuredClone(extraction), id: extractionId },
        {
            id: invokeId,
            type: "custom",
            implementation: "integration.invoke",
            name: `Invoke integration`,
            position: { x: extraction.position.x + 320, y: extraction.position.y },
            config: { target_flow_id: integrationId, input: "={{ $json }}", max_attempts: 5 },
        },
    ];

    return {
        integration: {
            ...structuredClone(integration),
            version: 3,
            nodes: [trigger, ...integration.nodes.filter((node) => !removed.has(node.id))],
            transitions: integrationTransitions,
        },
        call: {
            ...structuredClone(call),
            version: 3,
            nodes: [...call.nodes, ...addedNodes],
            transitions: [
                ...call.transitions,
                { id: `${triggerId}-${extractionId}`, from: triggerId, outcome: "we_ended", to: extractionId },
                {
                    id: `${triggerId}-${extractionId}-caller`,
                    from: triggerId,
                    outcome: "caller_hung_up",
                    to: extractionId,
                },
                { id: `${extractionId}-${invokeId}`, from: extractionId, outcome: "filled", to: invokeId },
            ],
        },
        removedFromIntegration: [ended.name, extraction.name],
        addedToCall: addedNodes.map((node) => node.name),
    };
}
