import type { ReactNode } from "react";
import { PlatformShell } from "@/components/application/app-navigation/platform-shell";

/**
 * The platform portal: a different product from the console.
 *
 * Its own route group so it gets its own chrome and its own gate by placement
 * rather than by each screen remembering — and so that nothing under it can
 * accidentally inherit the console's sidebar or its organisation header.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
    return <PlatformShell>{children}</PlatformShell>;
}
