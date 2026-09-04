"use client";

import { ArrowRight } from "@/components/icons";
import type { ReactNode } from "react";

interface RollingArrowProps {

  iconSize?: number;

  name?: string;

  className?: string;
}

function trackHoverClasses(name?: string): string {
  if (name === "cta") {
    return "group-hover/cta:translate-x-full";
  }
  return "group-hover:translate-x-full";
}

export function RollingArrow({
  iconSize = 16,
  name,
  className = "",
}: RollingArrowProps): ReactNode {
  return (
    <span
      className={[
        "relative inline-block overflow-hidden align-middle",
        className,
      ].join(" ")}
      style={{ width: iconSize, height: iconSize }}
      aria-hidden
    >
      <span
        className={[
          "absolute inset-0 transition-transform",
          "duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "will-change-transform",
          trackHoverClasses(name),
        ].join(" ")}
      >
        <span
          className="absolute inset-0 flex items-center justify-center"
        >
          <ArrowRight size={iconSize} />
        </span>
        <span
          className="absolute inset-y-0 right-full flex items-center justify-center"
          style={{ width: iconSize }}
        >
          <ArrowRight size={iconSize} />
        </span>
      </span>
    </span>
  );
}

interface ArrowChipProps extends RollingArrowProps {

  className?: string;

  padX?: string;

  padY?: string;
}

export function ArrowChip({
  className = "bg-accent text-accent-foreground",
  padX = "px-3",
  padY = "py-3",
  iconSize = 16,
  name,
}: ArrowChipProps): ReactNode {
  return (
    <span
      className={[

        "relative inline-flex h-full items-center justify-center rounded-md overflow-hidden",
        padX,
        padY,
        className,
      ].join(" ")}
      aria-hidden
    >
      <span
        className="invisible"
        style={{ width: iconSize, height: iconSize }}
      />

      <span
        className={[
          "absolute inset-0 transition-transform",
          "duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "will-change-transform",
          trackHoverClasses(name),
        ].join(" ")}
      >
        <span className="absolute inset-0 flex items-center justify-center">
          <ArrowRight size={iconSize} />
        </span>
        <span className="absolute inset-y-0 right-full w-full flex items-center justify-center">
          <ArrowRight size={iconSize} />
        </span>
      </span>
    </span>
  );
}

