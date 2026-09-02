/**
 * Carry a configuration across a provider or model change.
 *
 * Changing the provider invalidates settings chosen for the old one: a Kokoro
 * voice cannot be spoken by Google, a local transcriber has nothing to do in a
 * remote pipeline, a model belongs to one stack. Those values are rewritten to
 * the new provider's defaults and the rewrites are reported, so the change is
 * visible rather than discovered later in a diff.
 *
 * Rewriting rather than flagging is a deliberate trade. It loses the previous
 * selection — switching back does not restore it — in exchange for never
 * leaving an agent in a state that cannot be published. The alternative,
 * keeping the old value and flagging it, leaves the editor holding a
 * combination the publish gate refuses, which is a worse place to be stuck.
 *
 * Everything here is pure. The screen decides what to do with the result.
 */

import {
    modelOf,
    modelsFor,
    providerOf,
    transcriberOf,
    transcribersFor,
    voiceOf,
    voicesFor,
    type Catalogue,
} from "./capability-registry";

export type ReconcileTarget = {
    provider: string;
    model: string;
    voice_config: Record<string, unknown> | null;
    transcriber_config: Record<string, unknown> | null;
};

export type Rewrite = {
    /** Editor tab the rewritten field lives on, so the screen can mark it. */
    tab: "Persona";
    label: string;
    from: string;
    to: string;
    reason: string;
};

export type Reconciliation<T extends ReconcileTarget> = {
    next: T;
    rewrites: Rewrite[];
};

const nameOf = (value: { label: string } | null, fallback: string) => value?.label ?? fallback;

/**
 * The default choice for a provider.
 *
 * First by sort order, which is the catalogue's own opinion about what to offer
 * first — not alphabetical, and not whatever the query happened to return.
 */
function defaults(catalogue: Catalogue, providerId: string) {
    const model = modelsFor(catalogue, providerId)[0] ?? null;
    const voice = voicesFor(catalogue, providerId)[0] ?? null;
    const options = transcribersFor(catalogue, providerId);

    // A model that reads text needs something transcribing for it, so the
    // default depends on the model rather than being a fixed choice.
    const transcriber = model?.native_audio
        ? (options.find((option) => option.is_passthrough) ?? options[0] ?? null)
        : (options.find((option) => !option.is_passthrough) ?? options[0] ?? null);

    return { model, voice, transcriber };
}

/**
 * Reconcile after the provider changed.
 *
 * `previousProvider` is only used to word the reason, so a caller that has lost
 * it can pass the new one and still get correct rewrites.
 */
export function reconcileProvider<T extends ReconcileTarget>(catalogue: Catalogue, target: T, nextProviderId: string): Reconciliation<T> {
    const provider = providerOf(catalogue, nextProviderId);
    if (!provider || !catalogue.providers.length) {
        // Nothing to reconcile against. Take the change and leave the rest
        // alone rather than rewriting fields on the strength of an empty
        // catalogue.
        return { next: { ...target, provider: nextProviderId }, rewrites: [] };
    }

    const fallback = defaults(catalogue, provider.id);
    const rewrites: Rewrite[] = [];

    const voiceConfig = { ...(target.voice_config ?? {}) };
    const transcriberConfig = { ...(target.transcriber_config ?? {}) };

    let model = target.model;
    const currentModel = modelOf(catalogue, model);
    if (!currentModel || currentModel.provider_id !== provider.id) {
        model = fallback.model?.id ?? model;
        if (model !== target.model) {
            rewrites.push({
                tab: "Persona",
                label: "Model",
                from: nameOf(currentModel, target.model),
                to: nameOf(fallback.model, model),
                reason: `${provider.label} runs its own models.`,
            });
        }
    }

    const currentVoiceId = (voiceConfig.voice as string | undefined) ?? null;
    const currentVoice = voiceOf(catalogue, currentVoiceId);
    if (currentVoiceId && (!currentVoice || currentVoice.provider_id !== provider.id)) {
        const next = fallback.voice?.id;
        if (next) {
            voiceConfig.voice = next;
            rewrites.push({
                tab: "Persona",
                label: "Voice",
                from: nameOf(currentVoice, currentVoiceId),
                to: nameOf(fallback.voice, next),
                reason: currentVoice
                    ? `${currentVoice.engine} is part of the ${currentVoice.provider_id} stack.`
                    : "The previous voice is not in the catalogue.",
            });
        }
    }

    const currentTranscriberId = (transcriberConfig.transcriber as string | undefined) ?? null;
    const currentTranscriber = transcriberOf(catalogue, currentTranscriberId);
    if (currentTranscriberId && (!currentTranscriber || currentTranscriber.provider_id !== provider.id)) {
        const next = fallback.transcriber?.id;
        if (next) {
            transcriberConfig.transcriber = next;
            rewrites.push({
                tab: "Persona",
                label: "Transcriber",
                from: nameOf(currentTranscriber, currentTranscriberId),
                to: nameOf(fallback.transcriber, next),
                reason: `${provider.label} does not offer that transcriber.`,
            });
        }
    }

    return {
        next: { ...target, provider: provider.id, model, voice_config: voiceConfig, transcriber_config: transcriberConfig },
        rewrites,
    };
}

/**
 * Reconcile after the model changed within one provider.
 *
 * Narrower than a provider change: the voice is unaffected, but a text model
 * with nothing transcribing for it produces a call where the caller speaks and
 * the agent never answers, so that one gap is filled rather than flagged.
 */
export function reconcileModel<T extends ReconcileTarget>(catalogue: Catalogue, target: T, nextModelId: string): Reconciliation<T> {
    const model = modelOf(catalogue, nextModelId);
    if (!model) return { next: { ...target, model: nextModelId }, rewrites: [] };

    const transcriberConfig = { ...(target.transcriber_config ?? {}) };
    const rewrites: Rewrite[] = [];

    if (!model.native_audio) {
        const current = transcriberOf(catalogue, (transcriberConfig.transcriber as string | undefined) ?? null);
        if (!current || current.is_passthrough || current.provider_id !== model.provider_id) {
            const next = transcribersFor(catalogue, model.provider_id).find((option) => !option.is_passthrough);
            if (next) {
                transcriberConfig.transcriber = next.id;
                rewrites.push({
                    tab: "Persona",
                    label: "Transcriber",
                    from: current ? current.label : "None",
                    to: next.label,
                    reason: `${model.label} reads text, so something has to transcribe the caller for it.`,
                });
            }
        }
    }

    return { next: { ...target, model: model.id, transcriber_config: transcriberConfig }, rewrites };
}
