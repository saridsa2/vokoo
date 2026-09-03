"use client";

/**
 * What the line has been doing.
 *
 * The dashboard's second half. The band above answers *what is happening*;
 * these answer *what has been happening*, which is a question you cannot read
 * off a number — a count of twenty says nothing about whether that is a good
 * day or a collapse.
 *
 * ## Data is blue, chrome is marigold, and there is no emphasis colour
 *
 * Arrived at by being wrong twice. Drawn in the achromatic brand ramp the
 * charts read as bland; redrawn in the navigation section's marigold with one
 * ink bar for emphasis, that bar read as a rendering fault — and branding the
 * data made the numbers look like decoration.
 *
 * So the data has a hue of its own and the section colour stays on the frame,
 * where it says which part of the product you are in. **One fill per series,
 * no second value inside it**: a differently coloured bar claims the bars are
 * different kinds of thing. The newest day is marked by being last, which the
 * axis already says.
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

const DATA = "var(--chart-1)";
const DATA_SOFT = "var(--chart-1-soft)";
const DATA_WASH = "var(--chart-1-wash)";
/** Chrome only — a panel's top rule. Never inside a chart. */
const ACCENT = "var(--chart-accent)";
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
    // The busiest hour, emphasised rather than left for the reader to find by
    // comparing twenty-four bars.
    const peak = history.hours.reduce(
        (best, row, index) => (row.calls > history.hours[best].calls ? index : best),
        0,
    );

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Call Volume" note={`Last ${days.length} days · ${history.timezone}`}>
                <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={days} margin={margin}>
                        <defs>
                            {/* Down the bar rather than across it: a vertical
                                fade reads as height, which is what the bar is
                                measuring. */}
                            <linearGradient id="bar-data" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={DATA} stopOpacity={1} />
                                <stop offset="100%" stopColor={DATA_SOFT} stopOpacity={0.9} />
                            </linearGradient>
                        </defs>
                        {/* Horizontal only. Vertical rules over a bar chart draw
                            a box around every bar and add nothing — the bars
                            already say where the categories are. */}
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip {...tooltipProps} content={<Card unit="calls" />} />
                        <Bar dataKey="calls" maxBarSize={26} fill="url(#bar-data)" />
                    </BarChart>
                </ResponsiveContainer>
            </Panel>

            <Panel title="Talk Time" note="Minutes per day">
                <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={days} margin={margin}>
                        <defs>
                            <linearGradient id="area-data" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={DATA} stopOpacity={0.28} />
                                <stop offset="100%" stopColor={DATA} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                        <YAxis {...axis} allowDecimals={false} width={40} />
                        <Tooltip {...tooltipProps} content={<Card unit="minutes" />} />
                        <Area
                            type="monotone"
                            dataKey="minutes"
                            stroke={DATA}
                            strokeWidth={2}
                            fill="url(#area-data)"
                            // No dot on every point — at fourteen days they
                            // crowd the line, and the shape is what is read.
                            // The hovered one still appears.
                            dot={false}
                            activeDot={{ r: 4, fill: DATA, stroke: "var(--color-bg-primary)", strokeWidth: 2 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Panel>

            <Panel
                title="Calls by Hour"
                note={`Peak ${hour(peak)} · ${history.timezone}`}
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
                        {/* Lighter than the daily chart, because this is the
                            same measurement cut a second way rather than a
                            second measurement. */}
                        <Bar dataKey="calls" maxBarSize={20} fill={DATA} fillOpacity={0.7} />
                    </BarChart>
                </ResponsiveContainer>
            </Panel>
        </div>
    );
};

/** Seconds are what the record holds; minutes are what a person reads. */
const withMinutes = (days: HistoryDay[]) =>
    days.map((day) => ({ ...day, minutes: Math.round(day.seconds / 60) }));

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

const tooltipProps = {
    cursor: { fill: DATA_WASH },
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
                <span style={{ color: DATA }}>{point.value}</span> {unit}
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
