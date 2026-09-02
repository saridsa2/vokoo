/**
 * The capability catalogue, as the console sees it.
 *
 * The data comes from `GET /api/v1/catalogue`, which the database builds from
 * four tables. Nothing here invents a model, a voice or a provider: the console
 * used to hold three separate literal arrays plus a hardcoded "Self-hosted"
 * badge, and they disagreed — which is how an agent on Google Gemini could
 * display a badge asserting caller audio never left the operator's hardware.
 *
 * This module is types and lookups only. The rules that read it live in
 * `capability-rules.ts`, so the question "what is true of this model" stays
 * separate from "what is wrong with this agent".
 */

export type InferenceLocation = "self_hosted" | "google_cloud" | (string & {});

export type CatalogueProvider = {
    id: string;
    label: string;
    /** Two or three words, for a select trigger. Never a sentence. */
    tagline: string;
    /** The sentence, for places with room to read one. */
    summary: string;
    inference_location: InferenceLocation;
    /** Inference runs on hardware the operator controls. */
    is_sovereign: boolean;
    sort_order: number;
};

export type CatalogueModel = {
    id: string;
    provider_id: string;
    label: string;
    tagline: string;
    summary: string;
    /** Hears caller audio directly, so no transcriber is needed in front of it. */
    native_audio: boolean;
    supports_tools: boolean;
    supports_structured_output: boolean;
    context_tokens: number | null;
    /** "local" or "network" — decides whether latency thresholds are realistic. */
    latency_class: string;
    sort_order: number;
};

export type CatalogueVoice = {
    id: string;
    provider_id: string;
    label: string;
    engine: string;
    languages: string[];
    sort_order: number;
};

export type CatalogueTranscriber = {
    id: string;
    provider_id: string;
    label: string;
    tagline: string;
    summary: string;
    /** "None" — the model receives caller audio directly. */
    is_passthrough: boolean;
    languages: string[];
    sort_order: number;
};

/** A vendor account the operator can connect a key for. */
export type CatalogueVendor = {
    id: string;
    label: string;
    /** "inference" or "telephony" — connecting a model and connecting a carrier are different errands. */
    kind: string;
    description: string;
    help_url: string | null;
    sort_order: number;
};

/** A node that can be dropped onto the composer canvas. */
export type CatalogueNodeType = {
    /** The implementation key — `agent`, `kookoo.conference`, `business_hours`. */
    id: string;
    /** The primitive the engine runs: condition · loop · var · code · custom. */
    node_type: string;
    label: string;
    description: string;
    /** The carrier endpoint this maps to, for carrier actions. */
    provider_action: string | null;
    /** True when the node parks the flow until an event or a timeout. */
    suspends: boolean;
    default_timeout_seconds: number | null;
    outcomes: { id: string; label: string }[];
    fields: { key: string; label: string; type: string; required?: boolean; hint?: string; default?: unknown }[];
    sort_order: number;
};

/**
 * One provider rustvani can occupy one position in a call chain with.
 *
 * A row is a claim that `src/services/<stage>/<provider>.rs` exists in the
 * crate. The console offers exactly these, because an engine naming a provider
 * the binary cannot construct looks correct in the list and fails at connect
 * time on a real call.
 */
export type CatalogueEngineStage = {
    /** `<stage>:<provider>` — `stt:deepgram`. */
    id: string;
    /** Where in the chain: `realtime` (the whole chain), `stt`, `llm`, `tts`. */
    stage: "realtime" | "stt" | "llm" | "tts";
    provider_id: string;
    label: string;
    /** Two or three words, for a select trigger. Never a sentence. */
    tagline: string;
    /** The sentence, for places with room to read one. */
    summary: string;
    /** The module in rustvani, so a reader can check the claim. */
    source_path: string;
    /** The account this step bills to. Null when it runs on your own hardware. */
    vendor_id: string | null;
    /**
     * What this step's model field can be set to. Empty means the step takes no
     * model choice — a transcriber that only takes a language, say.
     *
     * Held here rather than in `models` because a transcriber model and a voice
     * model are not the same kind of thing as a model an agent runs on, and the
     * agent capability rules read that table.
     */
    models: { id: string; label: string }[];
    /** Likewise for the voice field. Empty hides it. */
    voices: { id: string; label: string }[];
    /**
     * Whether a model on this step can be given the agent's tools.
     *
     * False on `realtime:openai` and `llm:sarvam`, which cannot declare
     * functions at all. Nothing fails when a model is never told a function
     * exists, so an agent on one of those holds a conversation and takes no
     * action — which is why this is stated rather than discovered.
     */
    supports_tools: boolean;
    sort_order: number;
};

export type Catalogue = {
    providers: CatalogueProvider[];
    models: CatalogueModel[];
    voices: CatalogueVoice[];
    transcribers: CatalogueTranscriber[];
    vendors: CatalogueVendor[];
    nodeTypes: CatalogueNodeType[];
    engineStages: CatalogueEngineStage[];
};

export const EMPTY_CATALOGUE: Catalogue = { providers: [], models: [], voices: [], transcribers: [], vendors: [], nodeTypes: [], engineStages: [] };

/**
 * The subset of an agent the capability layer reads.
 *
 * Narrower than the row on purpose: rules that can only see these fields cannot
 * quietly start depending on something else, and every caller — the editor, a
 * list screen, the publish gate — can supply them.
 */
export type CapabilityScope = {
    /**
     * The agent runs on an engine.
     *
     * When it does, the fields below are a *record* of that engine rather than
     * a choice made here — `attachEngine` writes them from it. The engine
     * validates its own steps against `catalogue_engine_stages` and refuses to
     * publish with a missing provider or an unconnected key, so checking them
     * again here against `catalogue_providers` and `catalogue_models` is a
     * second opinion from a different table. Those two tables know `local` and
     * `gemini`; an engine can name OpenAI, Sarvam or Deepgram. The second
     * opinion is simply wrong, and it blocked publish on a correct agent.
     */
    hasEngine: boolean;
    provider: string;
    model: string;
    voice: string | null;
    transcriber: string | null;
};

export function providerOf(catalogue: Catalogue, id: string) {
    return catalogue.providers.find((provider) => provider.id === id) ?? null;
}

export function modelOf(catalogue: Catalogue, id: string) {
    return catalogue.models.find((model) => model.id === id) ?? null;
}

export function voiceOf(catalogue: Catalogue, id: string | null) {
    return id ? (catalogue.voices.find((voice) => voice.id === id) ?? null) : null;
}

export function transcriberOf(catalogue: Catalogue, id: string | null) {
    return id ? (catalogue.transcribers.find((item) => item.id === id) ?? null) : null;
}

export const modelsFor = (catalogue: Catalogue, provider: string) => catalogue.models.filter((model) => model.provider_id === provider);
export const voicesFor = (catalogue: Catalogue, provider: string) => catalogue.voices.filter((voice) => voice.provider_id === provider);
export const transcribersFor = (catalogue: Catalogue, provider: string) =>
    catalogue.transcribers.filter((item) => item.provider_id === provider);

/**
 * Where caller audio is processed, said plainly.
 *
 * This is the one question the product exists to answer, so it is answered from
 * the catalogue rather than assumed. An unknown provider reads as unknown, not
 * as self-hosted — a wrong reassurance is worse here than an admission.
 */
export function inferenceLocation(catalogue: Catalogue, providerId: string) {
    const provider = providerOf(catalogue, providerId);

    if (!provider) {
        return { label: "Unknown", detail: `No catalogue entry for provider "${providerId}".`, isSovereign: false, isKnown: false };
    }

    return {
        label: provider.inference_location === "self_hosted" ? "Self-hosted" : provider.label,
        detail: provider.summary,
        isSovereign: provider.is_sovereign,
        isKnown: true,
    };
}
