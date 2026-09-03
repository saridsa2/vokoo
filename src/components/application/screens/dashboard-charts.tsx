"use client";

/**
 * What the line has been doing.
 *
 * The dashboard's second half. The band above answers *what is happening*;
 * these answer *what has been happening*, which is a question you cannot read
 * off a number — a count of twenty says nothing about whether that is a good
 * day or a collapse.
 *
 * ## The data is marigold, and everything around it is not
 *
 * The first version drew all three in ink, and read as bland — correctly. The
 * brand ramp is achromatic, which is right for controls and wrong for data.
 *
 * The console already has a real accent system: one saturated pair per
 * navigation section, and the dashboard's is marigold. So the data takes the
 * colour of the section it belongs to, and the axes, grid and labels stay
 * neutral. **One hue at several weights, never two** — a second colour on the
 * same screen claims two things are different when they are one measurement
 * seen two ways. The only other value is ink, and it is used for exactly one
 * bar per chart: today, and the busiest hour.
 *
 * Every colour is a token from `vokoo-brand.css`. A hex here could not follow
 * the theme, and there are two themes.
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
    Rectangle,
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

const ACCENT = "var(--chart-accent)";
const SOFT = "var(--chart-accent-soft)";
const EMPHASIS = "var(--chart-emphasis)";
const GRID = "var(--color-border-secondary)";
const LABEL = "var(--color-text-tertiary)";

const axis = { stroke: LABEL, fontSize: 11, tickLine: false, axisLine: false } as const;
const margin = { top: 6, right: 10, bottom: 0, left: -20 } as const;

export const DashboardCharts = ({ history }: { history: History | null }) => {
    if (!history) {
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

    const days = withMinutes(history.days);
    const last = days.length - 1;
    // The busiest hour, emphasised rather than left for the reader to find by
    // comparing twenty-four bars.
    const peak = history.hours.reduce(
        (best, row, index) => (row.calls > history.hours[best].calls ? index : best),
        0,
    );

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Calls a day" note={`Last ${days.length} days · ${history.timezone}`}>
                <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={days} margin={margin}>
                        <defs>
                            {/* Down the bar rather than across it: a vertical
                                fade reads as height, which is what the bar is
                                measuring. */}
                            <linearGradient id="bar-accent" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={ACCENT} stopOpacity={1} />
                                <stop offset="100%" stopColor={SOFT} stopOpacity={0.85} />
                            </linearGradient>
                        </defs>
                        {/* Horizontal only. Vertical rules over a bar chart draw
                            a box around every bar and add nothing — the bars
                            already say where the categories are. */}
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip {...tooltipProps} content={<Card unit="calls" />} />
                        <Bar dataKey="calls" maxBarSize={26} shape={emphasise((index) => index === last)} />
                    </BarChart>
                </ResponsiveContainer>
            </Panel>

            <Panel title="Time on the phone" note="Minutes a day">
                <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={days} margin={margin}>
                        <defs>
                            <linearGradient id="area-accent" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
                                <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip {...tooltipProps} content={<Card unit="minutes" />} />
                        <Area
                            type="monotone"
                            dataKey="minutes"
                            stroke={ACCENT}
                            strokeWidth={2}
                            fill="url(#area-accent)"
                            // No dot on every point — at fourteen days they
                            // crowd the line, and the shape is what is read.
                            // The hovered one still appears.
                            dot={false}
                            activeDot={{ r: 4, fill: ACCENT, stroke: "var(--color-bg-primary)", strokeWidth: 2 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Panel>

            <Panel
                title="When the phone rings"
                note={`Busiest at ${hour(peak)} · ${history.timezone}`}
                className="xl:col-span-2"
            >
                <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={history.hours} margin={margin}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis
                            dataKey="hour"
                            {...axis}
                            // Every third hour. Twenty-four labels on a wide
                            // chart is a smear; a reader needs only enough to
                            // place a bar in the day.
                            interval={2}
                            tickFormatter={hour}
                        />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip
                            {...tooltipProps}
                            content={<Card unit="calls" />}
                            labelFormatter={(value) => hour(Number(value))}
                        />
                        <Bar
                            dataKey="calls"
                            maxBarSize={20}
                            shape={emphasise((index) => index === peak, {
                                // The quiet hours recede rather than
                                // disappearing: an empty 03:00 is a fact about
                                // the line, not a gap in the chart.
                                rest: ACCENT,
                                restOpacity: 0.55,
                            })}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </Panel>
        </div>
    );
};

/**
 * One bar per chart carries the emphasis; the rest carry the accent.
 *
 * The `shape` prop rather than `<Cell>`: Cell is deprecated in Recharts 3 and
 * goes in 4, and it was always the wrong shape for this — a child element per
 * datum, purely to set a fill.
 */
const emphasise =
    (isEmphasised: (index: number) => boolean, options?: { rest?: string; restOpacity?: number }) =>
    (props: unknown) => {
        const bar = props as { index?: number };
        const on = isEmphasised(bar.index ?? -1);
        return (
            <Rectangle
                {...(props as object)}
                fill={on ? EMPHASIS : (options?.rest ?? "url(#bar-accent)")}
                fillOpacity={on ? 1 : (options?.restOpacity ?? 1)}
            />
        );
    };

/** Seconds are what the record holds; minutes are what a person reads. */
const withMinutes = (days: HistoryDay[]) =>
    days.map((day) => ({ ...day, minutes: Math.round(day.seconds / 60) }));

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

const tooltipProps = {
    cursor: { fill: "var(--chart-accent-wash)" },
} as const;

/**
 * The tooltip, as a component rather than a pile of style props.
 *
 * Recharts' default is a rounded white card with a hairline border — another
 * project's styling showing through, the same way the borrowed editor's eight
 * radii did. Square, on the app's own surface, with the value carrying the
 * accent so the card belongs to the series it came from.
 */
const Card = ({
    active,
    payload,
    label,
    unit,
    labelFormatter,
}: {
    active?: boolean;
    payload?: Array<{ value?: number | string; payload?: HistoryDay }>;
    label?: string | number;
    unit: string;
    labelFormatter?: (value: string | number) => string;
}) => {
    if (!active || !payload?.length) return null;
    const point = payload[0];
    return (
        <div className="border border-secondary bg-primary px-3 py-2 shadow-lg">
            <p className="text-xs text-tertiary">
                {labelFormatter && label !== undefined ? labelFormatter(label) : label}
            </p>
            <p className="text-sm font-semibold text-primary tabular-nums">
                <span style={{ color: ACCENT }}>{point.value}</span> {unit}
            </p>
        </div>
    );
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
        style={{ borderTopColor: ACCENT }}
    >
        <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            <span className="text-xs text-quaternary">{note}</span>
        </div>
        {children}
    </section>
);
