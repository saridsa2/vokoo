export function agentStackSubtitle(transcriberProvider: string | null | undefined, model: string | null | undefined): string {
    return [transcriberProvider || "no transcriber", model, "kookoo"].filter(Boolean).join(" · ");
}
