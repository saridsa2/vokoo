import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/application/app-navigation/console-shell";

/**
 * Every authenticated console screen lives under this route group, so the
 * sidebar and the auth gate are applied by placement rather than by each screen
 * remembering to opt in.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
    return <ConsoleShell>{children}</ConsoleShell>;
}
