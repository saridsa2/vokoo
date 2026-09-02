/**
 * Where the CLI keeps who you are.
 *
 * One file, profiles keyed by name, so a workspace and a staging workspace do
 * not need two checkouts. `--profile` picks one; `defaultProfile` decides when
 * nothing is passed.
 *
 * The file holds an API key in the clear, which is what every CLI that talks to
 * an API does, and is why it is written with mode 600 and lives outside the
 * repository. A key in a project directory ends up committed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Profile = {
    /** Where the control plane is. */
    apiUrl: string;
    /** The organisation the key belongs to, sent as `x-org-id`. */
    orgId: string;
    /** `vk_live_…`. */
    key: string;
};

export type Config = {
    defaultProfile: string;
    profiles: Record<string, Profile>;
};

export const EMPTY_CONFIG: Config = { defaultProfile: "default", profiles: {} };

/** Overridable so tests do not write to the developer's real home directory. */
export function configPath(home: string = homedir()): string {
    return join(home, ".vokoo", "config.json");
}

export async function readConfig(home?: string): Promise<Config> {
    try {
        const parsed = JSON.parse(await readFile(configPath(home), "utf8")) as Partial<Config>;
        return {
            defaultProfile: parsed.defaultProfile ?? "default",
            profiles: parsed.profiles ?? {},
        };
    } catch (error) {
        // A missing file is somebody who has not logged in yet, which is a
        // normal state and not worth an error. Anything else is worth saying,
        // because a config that fails to parse would otherwise look like a
        // config that is empty, and the fix for those is different.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_CONFIG };
        throw new Error(`could not read ${configPath(home)}: ${(error as Error).message}`);
    }
}

export async function writeConfig(config: Config, home?: string): Promise<string> {
    const path = configPath(home);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Written 600 because it holds a credential. The mode is set in the open,
    // not afterwards, so the file is never briefly readable by others.
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    return path;
}

export function selectProfile(config: Config, name?: string): { name: string; profile: Profile } {
    const wanted = name ?? config.defaultProfile;
    const profile = config.profiles[wanted];
    if (!profile) {
        const known = Object.keys(config.profiles);
        throw new Error(
            known.length === 0
                ? "no workspace is configured yet — run `vokoo login` first"
                : `no workspace named "${wanted}". Configured: ${known.join(", ")}`,
        );
    }
    return { name: wanted, profile };
}

export function upsertProfile(config: Config, name: string, profile: Profile): Config {
    return {
        // The first workspace configured becomes the default, so a single
        // workspace never needs --profile.
        defaultProfile: Object.keys(config.profiles).length === 0 ? name : config.defaultProfile,
        profiles: { ...config.profiles, [name]: profile },
    };
}

/** What is safe to print. A key is shown by its prefix and never in full. */
export function describeProfile(profile: Profile): string {
    return `${profile.apiUrl}  org ${profile.orgId}  key ${maskKey(profile.key)}`;
}

export function maskKey(key: string): string {
    // The prefix is what identifies the row in the console, so it is the useful
    // half to show. The rest is the secret.
    return key.length <= 11 ? "…" : `${key.slice(0, 11)}…`;
}
