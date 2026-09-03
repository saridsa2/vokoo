"use client";

/**
 * One ECharts instance, wrapped so the rest of the app stays declarative.
 *
 * ECharts is imperative — `init`, `setOption`, `dispose` — and this is the only
 * place that has to know. Everything else passes an option object and gets a
 * chart.
 *
 * ## Only the pieces that are used
 *
 * Imported through `echarts/core` with an explicit `use([...])` rather than the
 * whole library, which is ECharts' own documented tree-shaking path. The full
 * bundle carries maps, 3D, graphs and a dozen chart types this console will
 * never draw, on the landing route of all places.
 *
 * ## Colour has to be resolved, not referenced
 *
 * This is the one real cost of leaving Recharts. An SVG `fill` accepts
 * `var(--chart-1)` and the browser resolves it per theme; ECharts takes literal
 * values and knows nothing about CSS custom properties. So the tokens are read
 * out of the document with `getComputedStyle` and passed in as strings — and
 * re-read when the theme changes, because a value read under one theme is wrong
 * under the other.
 *
 * `vokoo-brand.css` stays the single place a colour is decided, which is the
 * property that mattered; what changes is that reading it is now a step rather
 * than a reference. `useChartTheme` is that step, in one place.
 */

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
    GridComponent,
    MarkLineComponent,
    TooltipComponent,
    VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
    BarChart,
    LineChart,
    HeatmapChart,
    GridComponent,
    TooltipComponent,
    VisualMapComponent,
    MarkLineComponent,
    CanvasRenderer,
]);

export type ChartTheme = {
    data: string;
    dataSoft: string;
    dataWash: string;
    accent: string;
    grid: string;
    label: string;
    surface: string;
    border: string;
    text: string;
};

const TOKENS: Record<keyof ChartTheme, string> = {
    data: "--chart-1",
    dataSoft: "--chart-1-soft",
    dataWash: "--chart-1-wash",
    accent: "--chart-accent",
    grid: "--color-border-secondary",
    label: "--color-text-tertiary",
    surface: "--color-bg-primary",
    border: "--color-border-secondary",
    text: "--color-text-primary",
};

/**
 * The palette, as literal values ECharts can use.
 *
 * Re-read whenever the theme changes. Reading once at module load would bake in
 * whichever theme happened to be active on the first render, and the charts
 * would keep light-mode colours on a dark ground — the exact failure the
 * stylesheet's own comments warn about, arriving through a different door.
 */
export function useChartTheme(): ChartTheme {
    const { resolvedTheme } = useTheme();
    const [theme, setTheme] = useState<ChartTheme | null>(null);

    useEffect(() => {
        const styles = getComputedStyle(document.documentElement);
        const read = (token: string) => styles.getPropertyValue(token).trim();
        setTheme(
            Object.fromEntries(
                Object.entries(TOKENS).map(([key, token]) => [key, read(token)]),
            ) as ChartTheme,
        );
    }, [resolvedTheme]);

    // Before the first read there is no document to read from — server render,
    // and the first client paint. Values that are legible on either ground
    // rather than a flash of the wrong palette.
    return (
        theme ?? {
            data: "#2563eb",
            dataSoft: "#7ba4f5",
            dataWash: "rgba(37,99,235,0.08)",
            accent: "#b45309",
            grid: "#00000014",
            label: "#77716930",
            surface: "transparent",
            border: "#00000014",
            text: "#171512",
        }
    );
}

export const Chart = ({
    option,
    height,
    ariaLabel,
}: {
    option: echarts.EChartsCoreOption;
    height: number;
    /** What the chart says, for somebody who cannot see it. */
    ariaLabel: string;
}) => {
    const box = useRef<HTMLDivElement>(null);
    const instance = useRef<echarts.ECharts | null>(null);

    useEffect(() => {
        if (!box.current) return;
        const chart = echarts.init(box.current, undefined, { renderer: "canvas" });
        instance.current = chart;

        // ECharts sizes itself once and never again. Without this the chart is
        // correct until the sidebar collapses or the window moves, and then
        // draws at the width it was born at.
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(box.current);

        return () => {
            observer.disconnect();
            chart.dispose();
            instance.current = null;
        };
    }, []);

    useEffect(() => {
        // `true` replaces the option rather than merging. A merge leaves the
        // previous series in place when a chart changes shape, so an old series
        // stays drawn under the new one.
        instance.current?.setOption(option, true);
    }, [option]);

    return (
        <div
            ref={box}
            style={{ height }}
            className="w-full"
            role="img"
            aria-label={ariaLabel}
        />
    );
};

/**
 * The parts of an option every chart here shares.
 *
 * Not an ECharts "theme" object: a registered theme is a second place a colour
 * lives, and it cannot be re-read when the app's theme changes without
 * re-registering and re-initialising every chart. A function that takes the
 * resolved palette is the same thing without that problem.
 */
export const base = (theme: ChartTheme) =>
    ({
        // The panel behind it is the ground. Left unset, any layer ECharts
        // decides to create clears itself to an opaque default of its own —
        // which is invisible on eggshell and a white slab on dark.
        backgroundColor: "transparent",
        // Tight, because each chart already sits inside a titled panel.
        grid: { top: 12, right: 12, bottom: 24, left: 40 },
        textStyle: { fontFamily: "inherit" },
        tooltip: {
            trigger: "axis" as const,
            backgroundColor: theme.surface,
            borderColor: theme.border,
            borderWidth: 1,
            // Square, like every other surface in this console.
            borderRadius: 0,
            padding: [8, 12],
            extraCssText: "box-shadow: none;",
            textStyle: { color: theme.text, fontSize: 12 },
            axisPointer: { type: "shadow" as const, shadowStyle: { color: theme.dataWash } },
        },
    }) as const;

/** Axis styling shared by both directions. */
export const axis = (theme: ChartTheme, options?: { grid?: boolean }) =>
    ({
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.label, fontSize: 11 },
        // Horizontal rules only, ever. Vertical rules over a bar chart draw a
        // box around every bar and say nothing the bars have not already said.
        splitLine: options?.grid ? { lineStyle: { color: theme.grid } } : { show: false },
    }) as const;
