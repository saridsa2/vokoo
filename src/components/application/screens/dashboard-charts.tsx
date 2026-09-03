"use client";

/**
 * What the line has been doing.
 *
 * The dashboard's second half. The band above answers *what is happening*;
 * these answer *what has been happening*, which is a question you cannot read
 * off a number — a count of twenty says nothing about whether that is a good
 * day or a collapse.
 *
 * ## Not all of it is a bar chart, and that is the point
 *
 * The first version was three bar charts because a bar chart is the easy
 * answer, not because the questions were the same. Two of these are not:
 *
 * - **Busy hours are a heatmap**, not a histogram. A flat twenty-four-bar chart
 *   averages Tuesday at ten in the morning together with Sunday at ten in the
 *   morning, and reports a busy hour that may exist on no actual day.
 * - **Concurrency is a line against a limit.** The carrier allows three
 *   simultaneous calls per extension; a fourth caller gets SIP 486 Busy and the
 *   bridge never sees them, so that failure is invisible in every other view we
 *   have. A line at three turns "we have never hit it" from a belief into
 *   something you can look at.
 *
 * ## Data is blue, chrome is marigold, and there is no emphasis colour
 *
 * Arrived at by being wrong twice. Drawn in the achromatic brand ramp the
 * charts read as bland; redrawn in the navigation section's marigold with one
 * ink bar for emphasis, that bar read as a rendering fault — and branding the
 * data made the numbers look like decoration.
 *
 * ## The palette is the logo
 *
 * The mark grades from teal to blue, and so do these: `--chart-1` is its blue
 * end and `--chart-1-soft` its teal one, so a bar is the logo's own gradient
 * standing up. A panel's rule takes the teal — of the logo, but not the data.
 *
 * **The capacity line is the one colour that is not ours**, and deliberately: it
 * marks the carrier's ceiling, a limit imposed from outside, and drawn in a
 * brand colour it would read as a second series.
 */

import { useMemo } from "react";

import { Chart, axis, base, useChartTheme } from "@/components/application/charts/chart";

export type HistoryDay = {
    date: string;
    label: string;
    calls: number;
    seconds: number;
    finished: number;
    average: number;
};

export type History = {
    days: HistoryDay[];
    hours: Array<{ hour: number; calls: number }>;
    heatmap: Array<{ day: number; hour: number; calls: number }>;
    durations: Array<{ label: string; calls: number }>;
    concurrency: Array<{ label: string; peak: number }>;
    capacity: number;
    total: number;
    timezone: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

export const DashboardCharts = ({ history }: { history: History | null }) => {
    const theme = useChartTheme();

    const options = useMemo(() => {
        if (!history) return null;
        const labels = history.days.map((day) => day.label);
        const b = base(theme);
        const down = (from: string, to: string) => ({
            type: "linear" as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
                { offset: 0, color: from },
                { offset: 1, color: to },
            ],
        });

        return {
            volume: {
                ...b,
                xAxis: { type: "category", data: labels, ...axis(theme) },
                yAxis: { type: "value", minInterval: 1, ...axis(theme, { grid: true }) },
                series: [
                    {
                        type: "bar",
                        data: history.days.map((day) => day.calls),
                        barMaxWidth: 26,
                        // Down the bar rather than across it: a vertical fade
                        // reads as height, which is what a bar measures. Blue at
                        // the top to teal at the foot — the logo's own gradient,
                        // in the logo's own direction.
                        itemStyle: { color: down(theme.data, theme.dataSoft) },
                    },
                ],
            },

            talk: {
                ...b,
                xAxis: { type: "category", boundaryGap: false, data: labels, ...axis(theme) },
                yAxis: { type: "value", minInterval: 1, ...axis(theme, { grid: true }) },
                series: [
                    {
                        type: "line",
                        smooth: true,
                        // No marker on every point — at fourteen days they crowd
                        // the line, and the shape is what is being read.
                        showSymbol: false,
                        data: history.days.map((day) => Math.round(day.seconds / 60)),
                        lineStyle: { color: theme.data, width: 2 },
                        itemStyle: { color: theme.data },
                        areaStyle: {
                            color: down(fade(theme.data, 0.28), fade(theme.data, 0.02)),
                        },
                    },
                ],
            },

            heatmap: {
                ...b,
                grid: { top: 12, right: 12, bottom: 24, left: 44 },
                tooltip: {
                    ...b.tooltip,
                    trigger: "item" as const,
                    axisPointer: undefined,
                    formatter: (p: { value: [number, number, number] }) =>
                        `${DAYS[p.value[1]]} ${hour(p.value[0])} — ${p.value[2]} calls`,
                },
                xAxis: {
                    type: "category",
                    data: Array.from({ length: 24 }, (_, h) => hour(h)),
                    ...axis(theme),
                    // Every third hour. Twenty-four labels is a smear; a reader
                    // needs only enough to place a cell in the day.
                    axisLabel: { color: theme.label, fontSize: 11, interval: 2 },
                    // ECharts turns `splitArea` on by default for a heatmap's
                    // category axes, which paints the whole plot area in a
                    // near-white it chooses itself. Invisible on an eggshell
                    // ground and a white slab on a dark one — a colour from
                    // outside the theme, which is exactly what the token system
                    // exists to prevent.
                    splitArea: { show: false },
                },
                yAxis: { type: "category", data: DAYS, ...axis(theme), splitArea: { show: false } },
                visualMap: {
                    min: 0,
                    max: Math.max(1, ...history.heatmap.map((c) => c.calls)),
                    show: false,
                    // Empty is the surface itself, not the palest blue: a quiet
                    // Sunday should read as nothing happened rather than as a
                    // faint something.
                    inRange: { color: [theme.surface, theme.dataSoft, theme.data] },
                },
                series: [
                    {
                        type: "heatmap",
                        data: history.heatmap.map((cell) => [cell.hour, cell.day, cell.calls]),
                        // The gap between cells is the panel showing through,
                        // which keeps the grid square without drawing a grid.
                        itemStyle: { borderColor: theme.surface, borderWidth: 2 },
                        // **Off, or the heatmap paints itself onto a white slab.**
                        // A heatmap past ECharts' progressive threshold renders
                        // on a second canvas layer, and that layer is cleared to
                        // its own opaque background rather than to the option's.
                        // Invisible on an eggshell ground and a white rectangle
                        // on a dark one — found by counting canvases, since only
                        // this chart had two. A hundred and sixty-eight cells
                        // needs no progressive rendering at all.
                        progressive: 0,
                    },
                ],
            },

            durations: {
                ...b,
                xAxis: {
                    type: "category",
                    data: history.durations.map((d) => d.label),
                    ...axis(theme),
                },
                yAxis: { type: "value", minInterval: 1, ...axis(theme, { grid: true }) },
                series: [
                    {
                        type: "bar",
                        data: history.durations.map((d) => d.calls),
                        barMaxWidth: 48,
                        itemStyle: { color: down(theme.data, theme.dataSoft) },
                    },
                ],
            },

            concurrency: {
                ...b,
                xAxis: { type: "category", boundaryGap: false, data: labels, ...axis(theme) },
                yAxis: {
                    type: "value",
                    minInterval: 1,
                    min: 0,
                    // The limit is always on screen, even on a quiet fortnight.
                    // A chart scaled to a peak of one would put the line off the
                    // top and hide the only thing it exists to show.
                    max: Math.max(
                        history.capacity + 1,
                        ...history.concurrency.map((c) => c.peak),
                    ),
                    ...axis(theme, { grid: true }),
                },
                series: [
                    {
                        type: "line",
                        // Stepped: a peak is what the day reached, not a value
                        // sliding between two days. A smooth curve would draw
                        // a concurrency of 2.4 that never happened.
                        step: "end",
                        symbol: "circle",
                        symbolSize: 5,
                        data: history.concurrency.map((c) => c.peak),
                        lineStyle: { color: theme.data, width: 2 },
                        itemStyle: { color: theme.data },
                        // The line, and no label on it. The panel's own note
                        // already says "Carrier allows 3", so a caption on the
                        // line said the same thing twice — and being pinned to
                        // the right edge, it was clipped by the panel. The
                        // dashed rule plus the note is one statement in the
                        // place a reader looks first.
                        markLine: {
                            silent: true,
                            symbol: "none",
                            label: { show: false },
                            lineStyle: { color: theme.limit, type: "dashed", width: 1.5 },
                            data: [{ yAxis: history.capacity }],
                        },
                    },
                ],
            },
        };
    }, [history, theme]);

    if (!history || !options) {
        return <Note>Loading.</Note>;
    }
    if (history.total === 0) {
        return (
            <Note>
                No calls in this window yet. These fill in as the line is used — they are drawn
                from the call records, so nothing has to be collected separately.
            </Note>
        );
    }

    const busiest = history.heatmap.reduce(
        (best, cell) => (cell.calls > best.calls ? cell : best),
        history.heatmap[0] ?? { day: 0, hour: 0, calls: 0 },
    );

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Call Volume" note={`Last ${history.days.length} days · ${history.timezone}`}>
                <Chart option={options.volume} height={210} ariaLabel="Calls per day" />
            </Panel>

            <Panel title="Talk Time" note="Minutes per day">
                <Chart option={options.talk} height={210} ariaLabel="Minutes on the phone per day" />
            </Panel>

            <Panel
                title="Busy Hours"
                note={
                    busiest.calls > 0
                        ? `Busiest ${DAYS[busiest.day]} ${hour(busiest.hour)} · ${history.timezone}`
                        : history.timezone
                }
                className="xl:col-span-2"
            >
                <Chart
                    option={options.heatmap}
                    height={220}
                    ariaLabel="Calls by day of the week and hour of the day"
                />
            </Panel>

            <Panel title="Call Duration" note="Completed calls">
                <Chart option={options.durations} height={200} ariaLabel="How long calls last" />
            </Panel>

            <Panel title="Peak Concurrent Calls" note={`Carrier allows ${history.capacity}`}>
                <Chart
                    option={options.concurrency}
                    height={200}
                    ariaLabel="Most calls in progress at once each day, against the carrier's limit"
                />
            </Panel>
        </div>
    );
};

/**
 * A hex colour at an opacity.
 *
 * ECharts gradient stops take a colour string and the tokens resolve to hex.
 * `color-mix` would be the CSS answer and is not one here: this value goes into
 * a canvas, not a stylesheet.
 */
const fade = (colour: string, alpha: number) => {
    const hex = colour.trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${alpha})`;
};

const Note = ({ children }: { children: React.ReactNode }) => (
    <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">{children}</p>
);

/**
 * A panel wears a rule in the accent along its top edge.
 *
 * The same logic the node cards already follow — an element that belongs to
 * something takes that thing's colour — applied to the section rather than to a
 * node. It is what stops a grid of bordered boxes reading as a spreadsheet.
 */
const Panel = ({
    title,
    note,
    className,
    children,
}: {
    title: string;
    note: string;
    className?: string;
    children: React.ReactNode;
}) => (
    <section
        className={`flex flex-col gap-3 border border-t-2 border-secondary p-4 ${className ?? ""}`}
        style={{ borderTopColor: "var(--chart-accent)" }}
    >
        <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            <span className="text-xs text-quaternary">{note}</span>
        </div>
        {children}
    </section>
);
