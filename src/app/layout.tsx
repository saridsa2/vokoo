import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NotificationProvider } from "@/components/application/notifications/notification-provider";
import { RouteProvider } from "@/providers/router-provider";
import { SessionProvider } from "@/providers/session-provider";
import { Theme } from "@/providers/theme";
import "@/styles/globals.css";
import { cx } from "@/utils/cx";

/**
 * Geist carries everything — display and body.
 *
 * Served through `next/font` rather than a stylesheet link: the files are
 * self-hosted at build time, so there is no request to Google on load and no
 * layout shift while the face arrives.
 *
 * Weight 300 matters. The design system's display voice is whisper-weight, and
 * Geist ships a Light — without it the browser would synthesise one or fall
 * back to Regular, losing the restraint the system is built on.
 */
const geist = Geist({
    subsets: ["latin"],
    display: "swap",
    weight: ["300", "400", "500", "600"],
    variable: "--font-geist",
});

const geistMono = Geist_Mono({
    subsets: ["latin"],
    display: "swap",
    weight: ["400"],
    variable: "--font-geist-mono-loaded",
});

export const metadata: Metadata = {
    title: "Sarvathra",
    description: "Voice AI control plane",
    // Declared rather than left to the `app/icon.png` file convention, which
    // emits one `<link rel="icon" sizes="256x256">` and nothing else — the
    // browser then crushes the full mark to 16px for the tab, where its thin
    // outer arcs turn to a pale blob and the S disappears.
    //
    // `favicon.ico` carries five images: the bold inner S at 16 and 32, the
    // whole fingerprint from 48 up. That is what a multi-size .ico is for, and
    // it only gets used if the browser is told the file exists.
    icons: {
        icon: [
            { url: "/favicon.ico", sizes: "16x16 32x32 48x48 64x64 128x128" },
            { url: "/sarvathra-icon.png", type: "image/png", sizes: "256x256" },
        ],
        apple: { url: "/sarvathra-icon.png", sizes: "180x180" },
    },
};

export const viewport: Viewport = {
    // Eggshell, not white: the canvas is warm paper, and the browser chrome
    // should match it rather than sit a shade cooler.
    themeColor: "#fdfcfc",
    colorScheme: "light",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        // The font variables go on <html>, not <body>. Tailwind resolves
        // `--font-body` at :root, so a `--font-geist` defined only on body is
        // undefined at that point — the whole value becomes invalid and
        // font-family silently falls back to the browser default (Times).
        <html lang="en" className={cx(geist.variable, geistMono.variable)} suppressHydrationWarning>
            <body className="bg-primary antialiased">
                <RouteProvider>
                    <Theme>
                        <SessionProvider>
                            {/* Inside the session provider, so a note about an
                                expired session is raised by something that can
                                already see the session. */}
                            <NotificationProvider>{children}</NotificationProvider>
                        </SessionProvider>
                    </Theme>
                </RouteProvider>
            </body>
        </html>
    );
}
