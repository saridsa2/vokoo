"use client";

/**
 * What the line has been doing.
 *
 * The dashboard's second half. The band above it answers *what is happening*;
 * these answer *what has been happening*, which is a question you cannot read
 * off a number — a count of twenty says nothing about whether that is a good
 * day or a collapse.
 *
 * ## Colour comes from the theme, never from a palette
 *
 * `--color-fg-brand-primary` is ink in light mode and eggshell in dark: this
 * system is achromatic, so the accent is "maximum contrast against the canvas"
 * rather than a hue. Writing a hex here would give a chart that is invisible in
 * one of the two modes, and Recharts takes `var(...)` for every colour prop, so
 * there is no reason to.
 *
 * ## Every day in the window, including the empty ones
 *
 * The server fills the gaps rather than returning only days that had calls. A
 * chart drawn from the rows that exist draws a straight line through a quiet
 * weekend and reports business as steady.
 */

import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

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
    total: number;
    timezone: string;
};

const INK = "var(--color-fg-brand-primary)";
const MUTED = "var(--color-fg-quaternary)";
const GRID = "var(--color-border-secondary)";
const LABEL = "var(--color-text-tertiary)";

const axis = { stroke: LABEL, fontSize: 11, tickLine: false, axisLine: false } as const;

export const DashboardCharts = ({ history }: { history: History | null }) => {
    if (!history) {
        return <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">Loading.</p>;
    }

    if (history.total === 0) {
        return (
            <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">
                No calls in this window yet. These fill in as the line is used — they are drawn
                from the call records, so nothing has to be collected separately.
            </p>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Calls a day" note={`Last ${history.days.length} days, ${history.timezone}`}>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={history.days} margin={{ top: 4, right: 10, bottom: 0, left: -20 }}>
                        {/* Horizontal only. Vertical rules over a bar chart draw
                            a box around every bar and add nothing: the bars
                            already say where the categories are. */}
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip {...tooltip} />
                        <Bar dataKey="calls" fill={INK} maxBarSize={28} />
                    </BarChart>
                </ResponsiveContainer>
            </Panel>

            <Panel title="Time on the phone" note="Minutes a day">
                <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={minutes(history.days)} margin={{ top: 4, right: 10, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip {...tooltip} />
                        <Area
                            type="monotone"
                            dataKey="minutes"
                            stroke={INK}
                            fill={INK}
                            fillOpacity={0.12}
                            strokeWidth={2}
                            // No dot per point: at fourteen days they crowd the
                            // line, and the shape is what is being read.
                            dot={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Panel>

            <Panel
                title="When the phone rings"
                note={`By hour, ${history.timezone}`}
                className="xl:col-span-2"
            >
                <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={history.hours} margin={{ top: 4, right: 10, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis
                            dataKey="hour"
                            {...axis}
                            // Every third hour. Twenty-four labels on a wide
                            // chart is a smear; a reader only needs enough to
                            // place a bar in the day.
                            interval={2}
                            tickFormatter={(hour: number) => `${String(hour).padStart(2, "0")}:00`}
                        />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip
                            {...tooltip}
                            labelFormatter={(hour) => `${String(hour).padStart(2, "0")}:00`}
                        />
                        <Bar dataKey="calls" fill={MUTED} maxBarSize={22} />
                    </BarChart>
                </ResponsiveContainer>
            </Panel>
        </div>
    );
};

/** Seconds are what the record holds; minutes are what a person reads. */
const minutes = (days: HistoryDay[]) =>
    days.map((day) => ({ ...day, minutes: Math.round(day.seconds / 60) }));

/**
 * Square, like everything else. Recharts' default tooltip is a rounded white
 * card with a hairline border, which is another project's styling showing
 * through — the same way the borrowed editor's eight radii did.
 */
const tooltip = {
    cursor: { fill: "var(--color-bg-secondary)" },
    contentStyle: {
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-border-secondary)",
        borderRadius: 0,
        fontSize: 12,
        boxShadow: "none",
    },
    labelStyle: { color: "var(--color-text-tertiary)" },
    itemStyle: { color: "var(--color-text-primary)" },
} as const;

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
    <section className={`flex flex-col gap-3 border border-secondary p-4 ${className ?? ""}`}>
        <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            <span className="text-xs text-quaternary">{note}</span>
        </div>
        {children}
    </section>
);
