"use client";

import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { Toggle } from "@/components/base/toggle/toggle";
import {
    Clock,
    IconBroadcast,
    IconDocument,
    IconGauge,
    IconLanguage,
    IconLock,
    IconShield,
    IconSliders,
    IconStopwatch,
    IconTools,
    IconVoiceLibrary,
    PlayCircle,
    Stars02,
} from "@/components/icons";
import { ConfigCard, ConfigSection, RowDivider, SettingRow } from "./config-primitives";
import {
    inferenceLocation,
    transcribersFor,
    voiceOf,
    voicesFor,
    type Catalogue,
} from "@/utils/capability-registry";

/**
 * Configuration panels for the agent editor.
 *
 * Structure follows the reference console: an uppercase section label, then
 * collapsible cards, then icon-led rows. Each panel writes into one jsonb
 * column on `agents`, so a tab maps to a column rather than scattering
 * across the row.
 *
 * Options are limited to what the telephony bridge can honour. Listing every
 * provider the reference shows would promise things the stack cannot do, and
 * you would only find out on a live call.
 */

export type JsonConfig = Record<string, unknown>;

export function configValue<T>(config: JsonConfig | null | undefined, key: string, fallback: T): T {
    const value = config?.[key];
    return (value ?? fallback) as T;
}

type PanelProps = { config: JsonConfig | null; patch: (next: JsonConfig) => void };

/**
 * Panels whose options depend on where inference runs.
 *
 * The catalogue and the chosen provider are passed in rather than fetched here:
 * one fetch for the screen, and a panel that cannot disagree with the tab strip
 * about which voices exist.
 */
type ProviderScopedProps = PanelProps & { catalogue: Catalogue; provider: string };

/* ------------------------------------------------------------------ Voice */

export function VoicePanel({ config, patch, catalogue, provider }: ProviderScopedProps) {
    const options = voicesFor(catalogue, provider);
    const selectedId = configValue<string | null>(config, "voice", null);
    const selected = voiceOf(catalogue, selectedId);

    // Which languages this voice can render. Speech engines do not all cover
    // the same set: one shipped engine covers twelve and Hindi is not among
    // them, so the model produces a correct Hindi reply and it comes out as
    // noise. That cost a live call to find, so the languages are stated at the
    // point of choosing rather than left in documentation.
    const languages = selected?.languages ?? [];

    const items = options.map((voice) => ({
        id: voice.id,
        label: voice.label,
        supportingText: `${voice.engine} · ${voice.languages.join(", ") || "unspecified"}`,
    }));

    return (
        <ConfigSection icon={IconVoiceLibrary} label="Voice">
            <ConfigCard title="Voice Configuration" description="Select the voice this agent speaks with.">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                        label="Voice"
                        items={items}
                        placeholder={options.length ? "Select a voice" : "No voices for this provider"}
                        isDisabled={!options.length}
                        selectedKey={selectedId}
                        onSelectionChange={(key) => patch({ ...config, voice: String(key) })}
                    >
                        {(item) => (
                            <Select.Item id={item.id} supportingText={item.supportingText}>
                                {item.label}
                            </Select.Item>
                        )}
                    </Select>

                    <Input
                        label="Speed"
                        type="number"
                        value={String(configValue(config, "speed", 1))}
                        onChange={(value) => patch({ ...config, speed: Number(value) || 1 })}
                        hint="1.0 is the natural rate. Telephony callers tolerate slower better than faster."
                    />
                </div>

                {selected && (
                    <p className="text-sm text-tertiary">
                        {selected.label} runs on {selected.engine} and speaks {languages.join(", ") || "an unspecified set of languages"}. A
                        reply in any other language is generated correctly and rendered as noise.
                    </p>
                )}
            </ConfigCard>

            <ConfigCard title="Additional Configuration" description="Background sound and speaking behaviour." defaultOpen={false}>
                <SettingRow icon={IconBroadcast} title="Background sound" description="Played under the agent's voice to mask silence.">
                    <Toggle
                        size="md"
                        aria-label="Background sound"
                        isSelected={configValue(config, "background_sound", false)}
                        onChange={(next) => patch({ ...config, background_sound: next })}
                    />
                </SettingRow>
            </ConfigCard>

            <ConfigCard
                title="Fallback Voices"
                description="No fallbacks configured — if the primary voice fails, these are tried in order."
                defaultOpen={false}
            >
                <p className="text-sm text-tertiary">
                    A fallback only helps across two engines. Within one provider, if the engine is down every voice on it is down.
                </p>
            </ConfigCard>
        </ConfigSection>
    );
}

/* ------------------------------------------------------------ Transcriber */

export function TranscriberPanel({ config, patch, catalogue, provider }: ProviderScopedProps) {
    const options = transcribersFor(catalogue, provider);
    const selectedId = configValue<string | null>(config, "transcriber", null);
    const selected = options.find((option) => option.id === selectedId) ?? null;

    const items = options.map((option) => ({ id: option.id, label: option.label, supportingText: option.tagline }));

    return (
        <ConfigSection icon={IconDocument} label="Transcriber">
            <ConfigCard title="Transcriber" description="How caller speech reaches the model.">
                <Select
                    label="Provider"
                    items={items}
                    placeholder={options.length ? "Select a transcriber" : "No transcribers for this provider"}
                    isDisabled={!options.length}
                    selectedKey={selectedId}
                    onSelectionChange={(key) => patch({ ...config, provider: String(key) })}
                >
                    {(item) => (
                        <Select.Item id={item.id} supportingText={item.supportingText}>
                            {item.label}
                        </Select.Item>
                    )}
                </Select>

                {/* Hidden when the model hears audio directly: there is nothing
                    to configure a language for. */}
                {selected && !selected.is_passthrough && (
                    <Input
                        label="Language"
                        value={configValue(config, "language", "en")}
                        onChange={(value) => patch({ ...config, language: String(value) })}
                        hint={`Use \`auto\` to detect per utterance. ${selected.label} covers ${selected.languages.join(", ") || "an unspecified set"}.`}
                    />
                )}
            </ConfigCard>

            <ConfigCard
                title="Fallback Transcribers"
                description="No fallbacks configured — if the primary transcriber fails, these are tried in order."
                defaultOpen={false}
            >
                <p className="text-sm text-tertiary">Add a second transcriber to keep calls working if the first fails to load.</p>
            </ConfigCard>
        </ConfigSection>
    );
}

/* ------------------------------------------------------------------ Tools */

export function ToolsPanel() {
    return (
        <ConfigSection icon={IconTools} label="Tools">
            <ConfigCard title="Tools" description="Functions the agent can call during a conversation.">
                <p className="text-sm text-tertiary">
                    No tools defined yet. Tools created under Build → Tools can be attached here.
                </p>
            </ConfigCard>
        </ConfigSection>
    );
}

/* --------------------------------------------------------------- Analysis */

export function AnalysisPanel({ config, patch }: PanelProps) {
    return (
        <ConfigSection icon={Stars02} label="Analysis">
            <ConfigCard title="Summary" description="Runs against the transcript once the call ends.">
                <TextArea
                    label="Summary prompt"
                    rows={4}
                    value={configValue(config, "summary_prompt", "")}
                    onChange={(value) => patch({ ...config, summary_prompt: String(value) })}
                    hint="Leave empty to skip summarisation."
                />
            </ConfigCard>

            <ConfigCard title="Success Evaluation" description="Whether the call achieved its purpose." defaultOpen={false}>
                <TextArea
                    label="Success criteria"
                    rows={4}
                    value={configValue(config, "success_prompt", "")}
                    onChange={(value) => patch({ ...config, success_prompt: String(value) })}
                    hint="A yes/no question scored against the transcript."
                />
            </ConfigCard>
        </ConfigSection>
    );
}

/* --------------------------------------------------------------- Monitors */

export function MonitorsPanel({ config, patch }: PanelProps) {
    return (
        <ConfigSection icon={IconGauge} label="Monitors">
            <ConfigCard title="Alerting" description="When this agent should raise an issue.">
                <SettingRow icon={PlayCircle} title="Alert on failed calls" description="A call ended without the agent speaking.">
                    <Toggle
                        size="md"
                        aria-label="Alert on failed calls"
                        isSelected={configValue(config, "alert_on_failure", true)}
                        onChange={(next) => patch({ ...config, alert_on_failure: next })}
                    />
                </SettingRow>

                <RowDivider />

                <SettingRow icon={Clock} title="Alert on high latency" description="Time-to-first-audio exceeded the threshold below.">
                    <Toggle
                        size="md"
                        aria-label="Alert on high latency"
                        isSelected={configValue(config, "alert_on_latency", false)}
                        onChange={(next) => patch({ ...config, alert_on_latency: next })}
                    />
                </SettingRow>

                <Input
                    label="Latency threshold (ms)"
                    type="number"
                    value={String(configValue(config, "latency_threshold_ms", 2000))}
                    onChange={(value) => patch({ ...config, latency_threshold_ms: Number(value) || 2000 })}
                    hint="Measured from the caller finishing speaking to the first audio going back."
                />
            </ConfigCard>
        </ConfigSection>
    );
}

/* ------------------------------------------------------------- Compliance */

export function CompliancePanel({ config, patch, catalogue, provider }: ProviderScopedProps) {
    // Where caller audio is processed, read from the catalogue. This row used
    // to be a hardcoded green "Self-hosted" badge, so an agent running on a
    // third-party provider asserted on the compliance screen that audio never
    // left the operator's hardware. That is the single claim this product
    // exists to make, and getting it wrong in the reassuring direction is the
    // one failure mode worth engineering against.
    const location = inferenceLocation(catalogue, provider);

    return (
        <ConfigSection icon={IconShield} label="Compliance">
            <ConfigCard title="Privacy" description="Recording and data handling for this agent.">
                <SettingRow
                    icon={IconVoiceLibrary}
                    title="Audio recording"
                    description="Ozonetel records the call and returns an MP3 URL when it ends. Recordings are stored on Ozonetel's S3, not on your infrastructure."
                >
                    <Toggle
                        size="md"
                        aria-label="Audio recording"
                        isSelected={configValue(config, "record_calls", true)}
                        onChange={(next) => patch({ ...config, record_calls: next })}
                    />
                </SettingRow>

                <RowDivider />

                <SettingRow icon={IconDocument} title="Transcript" description="Store the conversation transcript against the call record.">
                    <Toggle
                        size="md"
                        aria-label="Transcript"
                        isSelected={configValue(config, "store_transcript", true)}
                        onChange={(next) => patch({ ...config, store_transcript: next })}
                    />
                </SettingRow>

                <RowDivider />

                <SettingRow icon={IconLock} title="Redact PII" description="Strip phone numbers and identifiers before a transcript is stored.">
                    <Toggle
                        size="md"
                        aria-label="Redact PII"
                        isSelected={configValue(config, "redact_pii", false)}
                        onChange={(next) => patch({ ...config, redact_pii: next })}
                    />
                </SettingRow>

                <RowDivider />

                <SettingRow icon={IconShield} title="Inference location" description={location.detail}>
                    <Badge
                        size="sm"
                        type="pill-color"
                        color={!location.isKnown ? "gray" : location.isSovereign ? "success" : "warning"}
                    >
                        {location.label}
                    </Badge>
                </SettingRow>
            </ConfigCard>
        </ConfigSection>
    );
}

/* --------------------------------------------------------------- Advanced */

/** Each of these maps onto behaviour the telephony bridge already implements. */
export function AdvancedPanel({ config, patch }: PanelProps) {
    return (
        <ConfigSection icon={IconSliders} label="Advanced">
            <ConfigCard title="Call Handling" description="How the telephony bridge behaves during a call.">
                <SettingRow
                    icon={IconBroadcast}
                    title="Suppress echo while speaking"
                    description="Stops forwarding caller audio while the agent is talking. The phone network echoes our own output back up the line; without this the provider hears it as the caller interrupting and cancels its own reply mid-sentence."
                >
                    <Toggle
                        size="md"
                        aria-label="Suppress echo while speaking"
                        isSelected={configValue(config, "mic_gate", true)}
                        onChange={(next) => patch({ ...config, mic_gate: next })}
                    />
                </SettingRow>
            </ConfigCard>

            <ConfigCard title="Start Speaking Plan" description="When the agent begins talking.">
                <Input
                    label="Priming silence (ms)"
                    type="number"
                    value={String(configValue(config, "priming_ms", 300))}
                    onChange={(value) => patch({ ...config, priming_ms: Number(value) || 300 })}
                    hint="KooKoo does not stream caller audio until our end sends audio first. This silent burst unblocks the stream at pickup; too short and the first words of the call are lost."
                />
            </ConfigCard>

            <ConfigCard title="Stop Speaking Plan" description="When a turn is considered finished." defaultOpen={false}>
                <SettingRow icon={IconStopwatch} title="End-of-turn silence" description="How long a pause counts as the caller finishing.">
                    <span className="text-sm text-tertiary">ms</span>
                </SettingRow>

                <Input
                    label="End-of-turn silence (ms)"
                    type="number"
                    value={String(configValue(config, "silence_ms", 300))}
                    onChange={(value) => patch({ ...config, silence_ms: Number(value) || 300 })}
                    hint="Lower feels snappier but cuts people off mid-sentence."
                />
            </ConfigCard>

            <ConfigCard title="Call Limits" description="Hard stops regardless of conversation state." defaultOpen={false}>
                <Input
                    label="Maximum call duration (seconds)"
                    type="number"
                    value={String(configValue(config, "max_duration_s", 600))}
                    onChange={(value) => patch({ ...config, max_duration_s: Number(value) || 600 })}
                    hint="The call is ended once this is reached, whatever is happening."
                />
            </ConfigCard>
        </ConfigSection>
    );
}

/* ------------------------------------------------------------------ Model */

/** Exported so the Model tab shares the same section/card structure. */
export { ConfigCard, ConfigSection };
export const ModelSectionIcon = IconLanguage;
