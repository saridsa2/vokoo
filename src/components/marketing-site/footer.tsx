"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowChip } from "@/components/marketing-site/arrow-chip";

/**
 * The foot of the page, and where "talk to us" actually leads.
 *
 * **Three of the template's four link columns are gone.** It shipped Product,
 * Company, Resources and Connect — nineteen links, fourteen of them `href="#"`,
 * plus X, LinkedIn, GitHub and YouTube pointing at the services' home pages
 * rather than at us. A footer of links that go nowhere is the clearest signal a
 * site is a template with the copy changed, and it is the one part of a page
 * people click to check whether a company is real.
 *
 * What is left is what exists: two anchors on this page, the console customers
 * sign in to, an address that receives mail, and a number that answers. Privacy
 * and terms are absent rather than linked to `#`, because a legal link that
 * 404s is worse than one that is not offered yet.
 */
const LINKS = [
    { label: "What it does", href: "#product" },
    { label: "Questions", href: "#faq" },
    { label: "Sign in", href: "https://console.sarvathra.ai" },
] as const;

export function Footer(): ReactNode {
    return (
        <footer
            id="contact"
            className="z-0 flex flex-col bg-background text-foreground min-[851px]:sticky min-[851px]:bottom-0"
        >
            <div className="mx-auto w-full max-w-[1680px] px-6 pt-24 lg:px-10 lg:pt-32">
                <span className="inline-flex items-center rounded-md border border-foreground/[0.08] px-3.5 py-1.5 font-mono text-xs tracking-widest text-foreground/70 uppercase">
                    Get in touch
                </span>
                <div className="mt-6 max-w-5xl text-4xl leading-[0.95] font-medium tracking-tighter sm:text-6xl lg:text-7xl xl:text-8xl">
                    <p className="block">Ring the line.</p>
                    <p className="block text-foreground/55">Then let&rsquo;s map your journeys.</p>
                </div>

                {/* Two, in the order somebody actually uses them: hear the thing
                    work, then write to a person about your own clinic. */}
                <div className="mt-12 flex flex-wrap items-stretch gap-3">
                    <Link href="tel:+918040802529" className="group inline-flex items-stretch gap-1">
                        <span className="rounded-md bg-foreground px-5 py-3 text-xs font-medium tracking-widest text-background uppercase">
                            +91 80408 02529
                        </span>
                        <ArrowChip className="bg-foreground text-background" />
                    </Link>
                    <Link
                        href="mailto:hello@sarvathra.ai"
                        className="inline-flex items-center rounded-md border border-foreground/15 px-5 py-3 text-xs font-medium tracking-widest text-foreground uppercase transition-colors hover:bg-foreground/5"
                    >
                        hello@sarvathra.ai
                    </Link>
                </div>
            </div>

            <div className="mx-auto mt-24 grid w-full max-w-[1680px] grid-cols-1 gap-10 px-6 py-16 lg:mt-32 lg:grid-cols-12 lg:gap-8 lg:px-10 lg:py-20">
                <div className="lg:col-span-6">
                    <Link href="/" className="inline-flex items-center gap-3 text-xl font-medium tracking-tight">
                        <Image
                            src="/sarvathra-mark.png"
                            alt=""
                            aria-hidden="true"
                            width={25}
                            height={32}
                            className="h-8 w-auto shrink-0"
                        />
                        <span className="text-base font-bold tracking-[0.09em]">SARVATHRA</span>
                    </Link>
                    <p className="mt-4 max-w-sm leading-relaxed text-foreground/55">
                        Sarvathra turns patient care journeys into AI agents — on voice,
                        WhatsApp and your front desk, in the patient&rsquo;s own language.
                    </p>
                </div>

                <div className="lg:col-span-3 lg:col-start-10">
                    <h4 className="mb-5 font-mono text-xs tracking-widest text-foreground/55 uppercase">
                        Elsewhere
                    </h4>
                    <ul className="space-y-3">
                        {LINKS.map((link) => (
                            <li key={link.label}>
                                <Link
                                    href={link.href}
                                    className="text-foreground/85 transition-colors hover:text-foreground"
                                >
                                    {link.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="mt-auto">
                <div className="mx-auto w-full max-w-[1680px] px-6 py-6 text-sm text-foreground/55 lg:px-10">
                    <p>© {new Date().getFullYear()} Sarvathra. Hyderabad, India.</p>
                </div>
            </div>
        </footer>
    );
}
