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

    const here = organizations.find((org) => org.id === session.organizationId);

    // **Their name, when the workspace knows one.** Deriving from the email is
    // a fallback and a poor one: `hello@…` produced a user called "Hello",
    // which read as a greeting rather than as a person. `memberships.display_name`
    // is where a real name lives, and it is per-organisation because the same
    // person can be "Priya" in one and "Dr Nair" in another.
    //
    // Split on anything that is not a letter or a number, rather than on a list
    // of separators: "s.satya.suman" gives "SS", and "Satya (work)" gives "SW"
    // instead of "S(" — a bracket is not an initial.
    const localPart = session.email.split("@")[0] ?? "";
    const words = (here?.member_name ?? localPart).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const initials =
        (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.slice(0, 2) ?? "VK").toUpperCase();

    const displayName = here?.member_name || words.join(" ") || localPart;

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
    const canSwitch = organizations.length > 1;

    return (
        <div className="flex flex-col gap-2">
            {/* Which workspace, above who you are. Two different facts, and
                they were briefly sharing one line — a name over an
                organisation reads as a greeting. */}
            {here && !canSwitch ? (
                <p className="truncate px-1 text-xs font-medium text-tertiary uppercase">
                    {here.name}
                </p>
            ) : null}
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
                    {/* The email, always. This card answers "who am I signed
                        in as", and replacing that with the workspace name —
                        which the line above it already carries — took away the
                        one thing it existed to say. */}
                    <p className="truncate text-xs text-tertiary">{session.email}</p>
                </div>

                <ButtonUtility size="xs" color="tertiary" tooltip="Sign out" icon={LogOut01} onClick={signOut} />
            </div>
        </div>
    );
}
