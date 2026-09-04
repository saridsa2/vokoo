"use client";

import Image from "next/image";

import { AnimatePresence, motion } from "motion/react";
import { Menu02, X } from "@/components/icons";
import { useEffect, useState, type ReactNode } from "react";

const easeOutExpo = [0.33, 1, 0.68, 1] as const;

const links = [
  { label: "What it does", href: "#product" },
  { label: "Questions", href: "#faq" },
  { label: "Contact", href: "#contact" },
] as const;

interface NavProps {

  delay?: number;
}

export function Nav({ delay = 1.4 }: NavProps): ReactNode {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <motion.nav
      aria-label="Primary"
      // `hero-surface` picks the white focus ring: this nav sits over the
      // shader, where the brand cyan is the same colour as the ground.
      className="hero-surface fixed inset-x-0 top-0 z-50 pointer-events-none"
      initial="hidden"
      animate="visible"
      transition={{ staggerChildren: 0.08, delayChildren: delay }}
    >
      <div className="mx-auto flex items-center justify-between px-10 py-6 max-[850px]:px-6 max-[850px]:py-4 max-w-[1680px]">
        <motion.div
          className="pointer-events-auto"
          variants={{
            hidden: { opacity: 0, y: -12 },
            visible: { opacity: 1, y: 0 },
          }}
          transition={{ duration: 0.7, ease: easeOutExpo }}
        >
          <motion.a
            href="/"
            className="relative inline-flex items-center gap-3 text-xl font-medium tracking-tight rounded-lg border"
            initial={false}
            animate={{
              paddingLeft: scrolled ? 12 : 0,
              paddingRight: scrolled ? 12 : 0,
              paddingTop: scrolled ? 8 : 0,
              paddingBottom: scrolled ? 8 : 0,
              backgroundColor: scrolled
                ? "rgba(255,255,255,1)"
                : "rgba(255,255,255,0)",
              color: scrolled ? "#0a0a0a" : "#ffffff",

              borderColor: scrolled
                ? "rgba(10,10,10,0.08)"
                : "rgba(255,255,255,0)",
            }}
            transition={{ duration: 0.45, ease: easeOutExpo }}
          >
            {/* The mark itself, not a placeholder ring.

                **Its gradient does not carry on both grounds**, which was the
                first thing looking at the page disproved: teal-to-blue on the
                blue shader is the mark hiding inside its own palette. Over the
                hero it is knocked out to white, and it returns to its own
                colour on the white pill once scrolled — the same two states
                the wordmark beside it already animates between.

                A filter rather than a second file: one asset, and the
                transition matches the wordmark's because it is driven by the
                same `scrolled` flag. */}
            <motion.div
              initial={false}
              animate={{ filter: scrolled ? "none" : "brightness(0) invert(1)" }}
              transition={{ duration: 0.45, ease: easeOutExpo }}
              className="shrink-0"
            >
              <Image
                src="/sarvathra-mark.png"
                alt=""
                aria-hidden="true"
                width={25}
                height={32}
                priority
                className="h-8 w-auto"
              />
            </motion.div>
            {/* Nine characters, so the tracking is tighter than a five-letter
                wordmark would take — the same value `VokooLogo` settled on. */}
            <span className="text-base font-bold tracking-[0.09em]">SARVATHRA</span>
          </motion.a>
        </motion.div>

        <motion.div
          className="pointer-events-auto"
          variants={{
            hidden: { opacity: 0, y: -12 },
            visible: { opacity: 1, y: 0 },
          }}
          transition={{ duration: 0.7, ease: easeOutExpo }}
        >
          <div className="flex items-center gap-1 rounded-lg border border-neutral-900/[0.08] bg-white p-1.5 text-xs font-medium uppercase tracking-widest text-neutral-700">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="hidden min-[850px]:inline-flex items-center px-4 py-2.5 rounded-md hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
              >
                {l.label}
              </a>
            ))}
            <a
              href="tel:+918040802529"
              className="inline-flex items-center px-4 py-2.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 transition-colors duration-200"
            >
              Call us
            </a>
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="min-[850px]:hidden inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-neutral-100 text-neutral-900 transition-colors"
            >
              {menuOpen ? <X size={18} /> : <Menu02 size={18} />}
            </button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            className="min-[850px]:hidden fixed inset-0 z-40 pointer-events-auto bg-background"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: easeOutExpo }}
          >
            <div className="flex justify-end px-6 py-4">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-md text-foreground hover:bg-foreground/5 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <motion.ul
              className="px-6 pt-8 flex flex-col gap-2"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.05 } },
              }}
            >
              {links.map((l) => (
                <motion.li
                  key={l.href}
                  variants={{
                    hidden: { opacity: 0, y: 12 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.4, ease: easeOutExpo }}
                >
                  <a
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="block py-4 text-3xl font-medium tracking-tight text-foreground border-b border-foreground/[0.08]"
                  >
                    {l.label}
                  </a>
                </motion.li>
              ))}
              <motion.li
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.4, ease: easeOutExpo }}
                className="mt-6"
              >
                {/* The same destination as the desktop CTA. On a phone this
                    one is a tap that actually dials, which is the best version
                    of this button anywhere on the site. */}
                <a
                  href="tel:+918040802529"
                  onClick={() => setMenuOpen(false)}
                  className="inline-flex items-center justify-center w-full px-4 py-4 rounded-md bg-neutral-900 text-white text-sm font-medium uppercase tracking-widest"
                >
                  Call +91 80408 02529
                </a>
              </motion.li>
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
