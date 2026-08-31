/* eslint-disable @typescript-eslint/no-explicit-any */
// Stub. The imported stackplane editor calls these server actions for its
// coding-agent half, which depends on that project's database and auth. VoKoo
// wants the canvas, not that half, so these resolve to "unavailable" rather
// than being ported. Return types are deliberately loose: the shapes are the
// other project's, and pinning them here would be inventing a contract we do
// not implement. Not route files — Next only routes page/route modules.
export type ComponentDeliveryRun = {
    id: string;
    status: string;
    prUrl: string | null;
    queuedAt: string;
    finishedAt: string | null;
    agentMinutes: number;
    humanMinutes: number;
    interventions: number;
    inputTokens: number;
    outputTokens: number;
};

const unavailable = { ok: false, error: "The coding-agent half is not wired up in VoKoo." };

export async function codingRunsForDiagramAction(..._args: any[]): Promise<any> { return { ok: true, runsByNodeId: {} }; }
export async function componentDeliveryAction(..._args: any[]): Promise<any> { return unavailable; }
export async function mintEditorSessionAction(..._args: any[]): Promise<any> { return unavailable; }
export async function runCodingAgentAction(..._args: any[]): Promise<any> { return unavailable; }
export async function stopCodingRunAction(..._args: any[]): Promise<any> { return unavailable; }
