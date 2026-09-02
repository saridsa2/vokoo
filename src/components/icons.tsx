import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { config } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { CSSProperties, FC } from "react";
import {
    faAnglesLeft,
    faAnglesRight,
    faArrowDown,
    faArrowLeft,
    faArrowLeftLong,
    faArrowRight,
    faArrowRightLong,
    faArrowRotateLeft,
    faArrowRotateRight,
    faArrowUpFromBracket,
    faArrowsRotate,
    faBars,
    faBell,
    faBook,
    faBookOpen,
    faBox,
    faCalendar,
    faCheck,
    faChevronDown,
    faChevronLeft,
    faChevronRight,
    faChevronUp,
    faCircleCheck,
    faCircleExclamation,
    faCircleInfo,
    faCirclePlay,
    faCircleQuestion,
    faCircleXmark,
    faClock,
    faCloudArrowUp,
    faCode,
    faCopy,
    faCube,
    faDownload,
    faEllipsisVertical,
    faEye,
    faEyeSlash,
    faFileCode,
    faGear,
    faLayerGroup,
    faLifeRing,
    faMagnifyingGlass,
    faMinus,
    faMoon,
    faPen,
    faPenToSquare,
    faPlus,
    faRightFromBracket,
    faScissors,
    faSpinnerThird,
    faStar,
    faTerminal,
    faTrash,
    faUpDown,
    faUser,
    faWandMagicSparkles,
    faXmark,
    // VoKoo navigation and screen icons (not part of the Untitled UI name set).
    faBuilding,
    faChartSimple,
    faClockRotateLeft,
    faComments,
    faDiagramProject,
    faFlask,
    faFolder,
    faGaugeHigh,
    faKey,
    faMicrophoneLines,
    faPaperPlane,
    faPhone,
    faPhoneVolume,
    faRectangleList,
    faTriangleExclamation,
    faFileLines,
    faGaugeSimpleHigh,
    faLanguage,
    faLock,
    faLockOpen,
    faShieldHalved,
    faSlidersUp,
    faStopwatch,
    faSun,
    faTowerBroadcast,
    faUserGroup,
    faUsers,
    faBracketsCurly,
    faPlug,
    faWrench,
} from "@awesome.me/kit-9a13e121e5/icons/duotone/solid";

import "@fortawesome/fontawesome-svg-core/styles.css";

/* Font Awesome icons, exposed under the names Untitled UI components expect.
 *
 * Every vendored component imports icons from "@untitledui/icons". Rewriting
 * each of those 59 files to call FontAwesomeIcon directly would mean redoing
 * the work every time `untitledui add` pulls in a new component. Instead the
 * components import from here, and this file is the single place the icon set
 * is decided -- swapping style, family, or vendor is a one-file change.
 *
 * Style is `duotone/solid` across the whole console. Duotone renders two layers
 * -- a primary path and a secondary one at reduced opacity -- which is why the
 * opacity variables below matter: at their defaults the secondary layer is
 * nearly invisible on a dark ground, and the icons read as flat solid.
 */

// Next injects the stylesheet above at build time; letting Font Awesome also
// inject it at runtime double-applies the CSS and makes icons flash oversized
// on first paint.
config.autoAddCss = false;

/* Duotone layer opacities.
 *
 * Font Awesome's defaults (primary 1.0 / secondary 0.4) are tuned for dark
 * icons on light backgrounds. This console is dark, so a 0.4 secondary layer
 * disappears into the background and every icon collapses to a solid shape.
 * Lifting the secondary and easing the primary keeps both layers legible at
 * the 16-20px sizes the UI actually uses.
 */
// Deliberately not annotated as CSSProperties: FontAwesomeIcon's style prop is
// `CSSProperties & CSSVariables`, and CSSProperties alone lacks the `--fa-*`
// index signature, so annotating it here fails to assign.
const DUOTONE_OPACITY = {
    "--fa-primary-opacity": "1",
    "--fa-secondary-opacity": "0.45",
};

type IconProps = {
    className?: string;
    /** Untitled UI sizes some icons in pixels rather than with a class. */
    size?: number;
    /** Untitled UI icons are stroked; Font Awesome glyphs are filled paths, so
     *  this is accepted for call-site compatibility and intentionally ignored. */
    strokeWidth?: string | number;
    /**
     * Passed through to the `<svg>`, and merged *after* the duotone defaults so
     * a caller can override them.
     *
     * This is how a caller colours the two layers: `--fa-primary-color` and
     * `--fa-secondary-color`. Without it the prop was silently dropped, which
     * is the worst shape for a style prop — the call site looks right and the
     * icon does not change.
     *
     * `CSSProperties`, not a custom-property record: an icon is passed around
     * as a plain `ComponentType` in several places, and a narrower `style` than
     * React's own makes it unassignable there. Call sites cast their `--fa-*`
     * object, which is what the note above `DUOTONE_OPACITY` describes.
     */
    style?: CSSProperties;
};

const icon = (definition: IconDefinition): FC<IconProps> =>
    function FaIcon({ className, size, style }) {
        // Untitled UI sizes icons with Tailwind classes (size-4, size-5), so the
        // class must land on the <svg> itself rather than a wrapper. When a pixel
        // size is passed instead, translate it to explicit dimensions.
        return (
            <FontAwesomeIcon
                icon={definition}
                className={className}
                style={{
                    ...DUOTONE_OPACITY,
                    ...(size ? { width: size, height: size } : {}),
                    ...(style as Record<string, unknown> | undefined),
                }}
            />
        );
    };

export const AlertCircle = icon(faCircleExclamation);
export const ArrowDown = icon(faArrowDown);
export const ArrowLeft = icon(faArrowLeft);
export const ArrowNarrowLeft = icon(faArrowLeftLong);
export const ArrowNarrowRight = icon(faArrowRightLong);
export const ArrowRight = icon(faArrowRight);
// Undo and redo. A mirrored refresh glyph reads as "reload", which is a
// different promise to the reader than "step back".
export const ArrowRotateLeft = icon(faArrowRotateLeft);
export const ArrowRotateRight = icon(faArrowRotateRight);
export const Bell01 = icon(faBell);
export const BookClosed = icon(faBook);
export const BookOpen01 = icon(faBookOpen);
export const Calendar = icon(faCalendar);
export const Check = icon(faCheck);
export const CheckCircle = icon(faCircleCheck);
export const ChevronDown = icon(faChevronDown);
export const ChevronLeft = icon(faChevronLeft);
export const ChevronLeftDouble = icon(faAnglesLeft);
export const ChevronRight = icon(faChevronRight);
export const ChevronRightDouble = icon(faAnglesRight);
export const ChevronSelectorVertical = icon(faUpDown);
export const ChevronUp = icon(faChevronUp);
export const Clock = icon(faClock);
export const ClockRewind = icon(faClockRotateLeft);
export const Code02 = icon(faCode);
export const Container = icon(faBox);
export const Copy01 = icon(faCopy);
export const Cube01 = icon(faCube);
export const DotsVertical = icon(faEllipsisVertical);
export const Download01 = icon(faDownload);
export const Edit01 = icon(faPenToSquare);
export const Edit04 = icon(faPen);
export const Eye = icon(faEye);
export const EyeOff = icon(faEyeSlash);
export const FileCode01 = icon(faFileCode);
export const HelpCircle = icon(faCircleQuestion);
export const InfoCircle = icon(faCircleInfo);
export const LayersTwo01 = icon(faLayerGroup);
export const LifeBuoy01 = icon(faLifeRing);
export const LogOut01 = icon(faRightFromBracket);
export const Menu02 = icon(faBars);
export const Minus = icon(faMinus);
export const Moon01 = icon(faMoon);
export const PlayCircle = icon(faCirclePlay);
export const Plus = icon(faPlus);
export const RefreshCcw02 = icon(faArrowsRotate);
/** Spins. Used for work in flight — a test run, a walk of a flow. */
export const Spinner = icon(faSpinnerThird);
export const Scissors01 = icon(faScissors);
export const SearchLg = icon(faMagnifyingGlass);
export const Settings01 = icon(faGear);
export const Share04 = icon(faArrowUpFromBracket);
export const Star01 = icon(faStar);
export const Stars02 = icon(faWandMagicSparkles);
export const TerminalSquare = icon(faTerminal);
export const Trash01 = icon(faTrash);
export const UploadCloud02 = icon(faCloudArrowUp);
export const User01 = icon(faUser);
export const X = icon(faXmark);
export const XCircle = icon(faCircleXmark);
export const XClose = icon(faXmark);

/* VoKoo navigation icons, named for what they represent in this product rather
 * than for the Untitled UI component they replaced. */
export const IconAgents = icon(faUsers);
export const IconSquads = icon(faDiagramProject);
export const IconTools = icon(faWrench);
export const IconPhoneNumbers = icon(faPhone);
export const IconVoiceLibrary = icon(faMicrophoneLines);
export const IconApiKeys = icon(faKey);
export const IconFiles = icon(faFolder);
export const IconTestSuites = icon(faFlask);
export const IconEvals = icon(faChartSimple);
export const IconIssues = icon(faTriangleExclamation);
export const IconMonitors = icon(faGaugeHigh);
export const IconNotifiers = icon(faPaperPlane);
export const IconBoards = icon(faChartSimple);
export const IconCallLogs = icon(faRectangleList);
// The two composer boards. Distinct from `IconPhoneNumbers` (a number you own)
// and `IconTools` (a wrench), both of which they previously borrowed — Calls
// was still wearing the magic wand from when the section was called VoKoo Labs.
export const IconCallFlows = icon(faPhoneVolume);
export const IconIntegrations = icon(faPlug);
// A shape is a schema. `IconFiles` is a folder, which Files already wears.
export const IconShapes = icon(faBracketsCurly);
export const IconChatLogs = icon(faComments);
export const IconSessionLogs = icon(faClockRotateLeft);
export const IconOrganization = icon(faBuilding);
export const IconMembers = icon(faUserGroup);
export const Sun = icon(faSun);

/* Agent-editor setting icons. */
export const IconLanguage = icon(faLanguage);
export const IconLock = icon(faLock);
// The open state, so a lock toggle shows what it will become rather than only
// what it is.
export const IconUnlock = icon(faLockOpen);
export const IconShield = icon(faShieldHalved);
export const IconSliders = icon(faSlidersUp);
export const IconStopwatch = icon(faStopwatch);
export const IconBroadcast = icon(faTowerBroadcast);
export const IconGauge = icon(faGaugeSimpleHigh);
export const IconDocument = icon(faFileLines);
