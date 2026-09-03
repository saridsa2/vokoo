"use client";

import { Avatar } from "@/components/base/avatar/avatar";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { LogOut01 } from "@/components/icons";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { useSession } from "@/hooks/use-session";

/**
 * Signed-in account, at the foot of the sidebar.
 *
 * Replaces Untitled UI's `NavAccountCard`, which renders a hardcoded demo user
 * ("Caitlyn King") and offers no way to sign out.
 */
export function VokooAccountCard({ iconOnly }: { iconOnly?: boolean } = {}) {
    const { session, signOut, organizations, switchOrganization } = useSession();

    if (!session) return null;

    // No display name is stored — the account is created directly in Supabase
    // Auth with an email only — so derive initials from the local part rather
    // than showing a blank avatar.
    //
    // Split on separators instead of taking the first two characters:
    // "s.satya.suman" would otherwise render as "S." rather than "SS".
    const localPart = session.email.split("@")[0] ?? "";
    const words = localPart.split(/[._-]+/).filter(Boolean);
    const initials =
        (words.length > 1 ? words[0][0] + words[words.length - 1][0] : localPart.slice(0, 2)).toUpperCase() || "VK";

    // Same reason: show "satya suman", not the raw "s.satya.suman".
    const displayName = words.join(" ") || localPart;

    if (iconOnly) {
        // Sign out stays reachable rather than being hidden behind expanding
        // the nav: it is the one action here, and burying it is how someone
        // ends up unable to leave a shared machine.
        return (
            <div className="flex flex-col items-center gap-2">
                <Tooltip title={displayName} description={session.email} placement="right">
                    <Avatar size="md" initials={initials} alt={session.email} />
                </Tooltip>
                <ButtonUtility size="xs" color="tertiary" tooltip="Sign out" icon={LogOut01} onClick={signOut} />
            </div>
        );
    }

    // Only when there is somewhere to switch to. A picker over one workspace is
    // a control that cannot do anything, which is the kind of thing this
    // console keeps deleting.
    const here = organizations.find((org) => org.id === session.organizationId);
    const canSwitch = organizations.length > 1;

    return (
        <div className="flex flex-col gap-2">
            {canSwitch ? (
                <label className="flex flex-col gap-1">
                    <span className="sr-only">Workspace</span>
                    <select
                        value={session.organizationId}
                        onChange={(event) => switchOrganization(event.target.value)}
                        className="w-full bg-primary px-3 py-2 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand"
                    >
                        {organizations.map((org) => (
                            <option key={org.id} value={org.id}>
                                {org.name}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}

            <div className="flex items-center gap-3 rounded-xl p-3 ring-1 ring-secondary">
                <Avatar size="md" initials={initials} alt={session.email} />

                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-primary capitalize">{displayName}</p>
                    {/* The workspace, when there is only one — a person who
                        belongs to several picks above, and a person who belongs
                        to one should still be able to see which. */}
                    <p className="truncate text-xs text-tertiary">
                        {canSwitch ? session.email : (here?.name ?? session.email)}
                    </p>
                </div>

                <ButtonUtility size="xs" color="tertiary" tooltip="Sign out" icon={LogOut01} onClick={signOut} />
            </div>
        </div>
    );
}
