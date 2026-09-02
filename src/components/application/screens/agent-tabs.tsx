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

/*
 * The Voice, Transcriber, Analysis, Monitors, Compliance and Advanced panels
 * were here.
 *
 * Every field in them was written to `agents` and read by nothing: the bridge
 * takes four things from an agent — its name, its system prompt, its skills and
 * its engine — and none of those panels touched any of them. A console that
 * offers a choice with no consequence is worse than one that offers fewer.
 *
 * What they configured belongs to an engine, which the bridge does read: a voice
 * and a transcriber are properties of the chain a call runs through, shared by
 * every agent on it. See `engine-detail-screen.tsx`.
 */

/* ------------------------------------------------------------------ Model */

/** Exported so the Model tab shares the same section/card structure. */
export { ConfigCard, ConfigSection };
export const ModelSectionIcon = IconLanguage;
