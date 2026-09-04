"use client";

import { features } from "@/lib/marketing/config";
import Lenis from "lenis";
import { useEffect, type ReactNode } from "react";

const LENIS_OPTIONS = {
  duration: 1.6,
  easing: (t: number): number => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: "vertical" as const,
  gestureOrientation: "vertical" as const,
  smoothWheel: true,
  wheelMultiplier: 1,
  touchMultiplier: 2,
};

const ANCHOR_OFFSET = -100;

export function SmoothScroll({ children }: { children: ReactNode }): ReactNode {
  useEffect(() => {
    if (!features.smoothScroll) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) return;

    const lenis = new Lenis(LENIS_OPTIONS);

    const MAX_DT = 50; 
    let synthTime = 0;
    let lastReal = performance.now();

    function raf(time: number): void {
      const dt = time - lastReal;
      lastReal = time;

      synthTime += Math.max(0, Math.min(dt, MAX_DT));
      lenis.raf(synthTime);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    function handleAnchorClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href^="#"]');
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const element = document.querySelector(href);
      if (!element || !(element instanceof HTMLElement)) return;
      event.preventDefault();
      lenis.scrollTo(element, { offset: ANCHOR_OFFSET });
    }

    document.addEventListener("click", handleAnchorClick);
    return () => {
      document.removeEventListener("click", handleAnchorClick);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
