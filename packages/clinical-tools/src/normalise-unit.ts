import { defineTool } from "@vokoo/sdk";

/**
 * Convert a lab measurement between units.
 *
 * A care path compares numbers to thresholds — NG28 wants HbA1c against a
 * target in `mmol/mol`, CG151 wants a neutrophil count against 0.5 ×10⁹/L. A
 * value in the wrong unit is worse than a missing one, because a threshold
 * still evaluates and the answer is confidently wrong.
 *
 * ## Why this refuses rather than guesses
 *
 * Mass and molar units cannot be converted without knowing the substance:
 * `mg/dL → mmol/L` is a different number for glucose than for creatinine,
 * because it is a division by the molar mass. A table keyed only on
 * `(from, to)` therefore cannot be right, and one that answers anyway is the
 * shape of bug that reads as working.
 *
 * The copied implementation in `vokoo-unit-normalizer` has that shape,
 * and it also carries the two directions as separate constants:
 *
 *     ("mg/dL", "mmol/L"): 0.0555      1 / 18.0182 = 0.0554994
 *     ("mmol/L", "mg/dL"): 18.0182     not reciprocal
 *
 * Round-tripping a glucose reading through those does not return the value it
 * started as. So this defines **one direction only** — the molar mass — and
 * derives everything else from it. There is no second constant to disagree.
 *
 * ## The molar masses are auditable on purpose
 *
 * Each is stated with the analyte so a clinician can check it against a
 * reference without reading the code. An analyte that is not in the table is
 * **refused**: a conversion nobody has checked, reported as a number, is how a
 * wrong threshold decision gets made silently.
 */

/** g/mol. One entry per analyte, and the only conversion constant that exists. */
const MOLAR_MASS: Record<string, { grams_per_mole: number; note: string }> = {
    glucose: { grams_per_mole: 180.156, note: "C6H12O6" },
    creatinine: { grams_per_mole: 113.12, note: "C4H7N3O" },
    urea: { grams_per_mole: 60.06, note: "CH4N2O — not BUN, which reports nitrogen only" },
    cholesterol: { grams_per_mole: 386.65, note: "total cholesterol, C27H46O" },
    triglyceride: { grams_per_mole: 885.4, note: "as triolein, the convention for serum" },
    bilirubin: { grams_per_mole: 584.66, note: "C33H36N4O6" },
    calcium: { grams_per_mole: 40.078, note: "elemental" },
    uric_acid: { grams_per_mole: 168.11, note: "C5H4N4O3" },
    albumin: { grams_per_mole: 66500, note: "human serum albumin, ~66.5 kDa" },
};

/**
 * How many of the base unit one of this unit is.
 *
 * Mass in grams, volume in litres, amount in moles. A compound unit is the
 * ratio of the two, so `mg/dL` is 1e-3 g over 1e-1 L.
 */
const SCALE: Record<string, number> = {
    g: 1, mg: 1e-3, ug: 1e-6, µg: 1e-6, ng: 1e-9, pg: 1e-12,
    mol: 1, mmol: 1e-3, umol: 1e-6, µmol: 1e-6, nmol: 1e-9, pmol: 1e-12,
    L: 1, dL: 1e-1, mL: 1e-3, uL: 1e-6, µL: 1e-6,
};

/** `mg/dL` → mass 1e-3, volume 1e-1. Anything else is not a concentration. */
function split(unit: string): { top: string; bottom: string } | null {
    const parts = unit.split("/");
    if (parts.length !== 2) return null;
    const [top, bottom] = parts.map((p) => p.trim());
    if (!(top in SCALE) || !(bottom in SCALE)) return null;
    return { top, bottom };
}

const AMOUNT = new Set(["mol", "mmol", "umol", "µmol", "nmol", "pmol"]);

export default defineTool({
    id: "5908a9e5-542f-459e-a95a-08d66b5f79db",
    name: "normalise_unit",
    description:
        "Convert a lab measurement from one unit to another, for example mg/dL to mmol/L. " +
        "Mass-to-molar conversions need the analyte, because the factor is its molar mass. " +
        "Returns converted: false with a reason when the conversion is not one this can make " +
        "correctly — treat that as no answer, never as zero.",
    input: {
        value: { type: "number", description: "The measured number, in `from` units.", required: true },
        from: { type: "string", description: "The unit as reported, e.g. 'mg/dL'.", required: true },
        to: { type: "string", description: "The unit wanted, e.g. 'mmol/L'.", required: true },
        analyte: {
            type: "string",
            description:
                "What was measured, lower case with underscores — glucose, creatinine, urea, " +
                "cholesterol, triglyceride, bilirubin, calcium, uric_acid, albumin. " +
                "Required when crossing between mass and molar units.",
        },
    },
    timeoutSeconds: 5,

    handler(args: { value: number; from: string; to: string; analyte?: string }) {
        const { value, from, to, analyte } = args;

        if (typeof value !== "number" || !Number.isFinite(value)) {
            return { converted: false, reason: `"${String(value)}" is not a number` };
        }
        if (from === to) return { converted: true, value, unit: to, factor: 1 };

        const a = split(from);
        const b = split(to);
        if (!a || !b) {
            return {
                converted: false,
                reason: `this converts concentrations written as amount/volume; "${!a ? from : to}" is not one`,
            };
        }

        const fromMolar = AMOUNT.has(a.top);
        const toMolar = AMOUNT.has(b.top);

        // Same kind on both sides: pure scaling, no substance involved.
        if (fromMolar === toMolar) {
            const factor = (SCALE[a.top] / SCALE[a.bottom]) / (SCALE[b.top] / SCALE[b.bottom]);
            return { converted: true, value: value * factor, unit: to, factor };
        }

        // Crossing mass and molar. This is where a table keyed on units alone
        // gets it wrong, so the analyte is required and an unknown one refused.
        if (!analyte) {
            return {
                converted: false,
                reason: `converting ${from} to ${to} depends on the substance — pass analyte`,
            };
        }
        const key = analyte.trim().toLowerCase().replace(/\s+/g, "_");
        const mass = MOLAR_MASS[key];
        if (!mass) {
            return {
                converted: false,
                reason:
                    `no molar mass on file for "${analyte}". Known: ${Object.keys(MOLAR_MASS).join(", ")}. ` +
                    `Add it with a reference rather than converting with a guess.`,
            };
        }

        // grams per litre -> moles per litre is a division by g/mol, and the
        // reverse is a multiplication. One constant, both directions.
        const fromBase = SCALE[a.top] / SCALE[a.bottom];
        const toBase = SCALE[b.top] / SCALE[b.bottom];
        const factor = fromMolar
            ? (fromBase * mass.grams_per_mole) / toBase   // molar -> mass
            : fromBase / mass.grams_per_mole / toBase;    // mass  -> molar

        return {
            converted: true,
            value: value * factor,
            unit: to,
            factor,
            analyte: key,
            grams_per_mole: mass.grams_per_mole,
        };
    },
});
