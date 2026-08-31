# Where This Project Is — 30 August 2026

## The phone works

Dial **+91 80408 02529**. It resolves the number to a flow, runs the flow, and
hands the caller to a Gemini Live agent. Verified on a real call: 27 seconds,
1329 media packets.

```
[flow] Open right now? -> open
flow reached agent node Reception (timeout 600s)
realtime mode — provider=gemini model=models/gemini-2.5-flash-native-audio-latest
session established
```

## The four processes

| | Language | Where | State |
|---|---|---|---|
| console | TypeScript | `vokoo-console/`, localhost:3000 | running |
| control plane | Rust | `vokoo-console/server/` → `vokoo-cp-api` :8081 | running |
| database | PostgreSQL | self-hosted Supabase in Docker on the VPS | running |
| media bridge | **Rust** | `/opt/vokoo/rustvani`, bin `vokoo_bridge` → `vokoo-bridge` :8080 | running |

**The bridge is Rust and only Rust.** A Python through-layer existed and was
deleted on 30 August. Do not write Python for the call path.

## What I added to rustvani

`src/vokoo/` — flow execution, the only VoKoo-specific code in that crate:

- `graph.rs` — DID → published flow over PostgREST, plus the node registry.
  Every failure returns `None`, which falls back to the number's agent.
- `control.rs` — KooKoo call control (Conference, IVRTransfer, Hold,
  PauseMonitor, Disconnect). Key resolved from the vault per call.
- `runner.rs` — walks the graph. Opening hours in the business's timezone.

Also changed: `RealtimeEvent::ToolCall` added in `services/realtime/mod.rs`,
Gemini declares `finish_call(outcome, note)` and both transcriptions,
`vokoo_bridge.rs` resolves the flow before building the pipeline and continues
the flow when the agent reports an outcome.

## Config lives in the database — except the model, which does not

Numbers, flows and agents live in the database, and change without a deploy.

**The model id does not, and this section used to claim otherwise.** It said
`bridge.env` was generated from the published agent and that the model id came
from `catalogue_models.provider_model_id`. Neither the bridge nor the control
plane reads that column — `catalogue_models` appears nowhere in `bridge/src/`
or `server/src/`. The bridge takes the model from one line:

```rust
// bridge/src/bin/vokoo_bridge.rs:306
live_model: env_or("LIVE_MODEL", "models/gemini-3.1-flash-live-preview"),
```

An environment variable, with a model id hardcoded as the fallback in Rust. So
the id now sits in three places that can drift: `agents.model`, `LIVE_MODEL` in
`bridge.env`, and that fallback. On 31 August all three said
`gemini-3.1-flash-live-preview` while `catalogue_models` had no such row at all
— the console showed "Unknown model" over a call path that worked.

Read `bridge/README.md` for the accurate account: it says plainly that
`bridge.env` holds the keys **and the model selection**.

Making the catalogue authoritative is bridge work: resolve
`provider_model_id` for the agent the flow reached, per call, falling back to
`LIVE_MODEL`. The mechanism exists — `src/vokoo/graph.rs` already reads
PostgREST to turn a DID into a flow, and `runner.rs` already carries `agent_id`
to the agent node.

**Ask the provider which models exist** rather than guessing:
`GET /v1beta/models` and filter on `bidiGenerateContent`.

## Known broken or missing

- ~~`finish_call` has never fired on a real call.~~ **It has.** The trace for
  the call at 31 Aug 08:11 reads: `Open right now?` (business_hours → open),
  `Reception` (agent → wants_human), `Hand to the front desk` (kookoo.transfer
  → ok), `Handed over` (kookoo.release → __end__). The agent reported an
  outcome, the flow left the agent node, and the transfer ran.
- **`Conference` has never been exercised.** Untested end to end.
- **Latency is unmeasured.** Transcription was only enabled after the last call.
- `condition`, `loop`, `code` fail at runtime — no expression language decided.
- A second agent node in one flow ends the call.
- ~~`calls` table has never had a row.~~ It has 9, with 27 `call_events` rows.
  Still empty on those calls: `transcript`, `recording_url`, `cost`, and every
  `call_events.duration_ms`.
- Tools reach the prompt; nothing executes one.
- `vokoo-console` has **no git commits**.

## Useful commands

```bash
ssh vokoo
journalctl -u vokoo-bridge -f -o cat          # watch a call
cd /opt/vokoo/rustvani && cargo build --release --bin vokoo_bridge
./target/release/flow_check 918040802529      # dry-run a flow, no call
./target/release/gemini_check                 # prove the model connects
docker exec -it supabase-db psql -U postgres
```

Three reference documents exist as artifacts: the **Flow Vocabulary** (flow,
node, outcome, transition; the five node types), the **Composer Spec**, and the
**Project Map**.

# Survey Before Building

**On 30 August 2026 the user said: "I feel so cheated."** He was right to.

I spent hours extending a Python media bridge while `/opt/vokoo/rustvani` sat
unused on the same server — 159 files, 44,000 lines, containing
`src/bin/vokoo_bridge.rs`, `src/serializers/kookoo.rs` and
`src/services/realtime/gemini.rs`. The KooKoo protocol and a Gemini Live client
were already written, in Rust, which is what he believed we were using. I
reimplemented both in Python, worse. I had listed that directory on screen
several times and never opened it.

He was also right earlier the same day that a spec I wrote was bent toward what
I had already built, and that I stopped on a bug after six guesses instead of
running one minimal test that would have identified it in two minutes.

**The rule**: before writing a component, look for it. Read the directory
listings you have already produced. Open the thing whose name matches the
problem. `ls` on a repo costs one tool call; discovering the duplicate after the
fact costs the user their trust and a day of work.

**Corollaries**:
- State the stack in play before extending it. If work is going into Python and
  the user believes it is Rust, say so on the first file, not the fifth.
- When a fix fails twice, stop guessing and build the smallest reproduction.
- A specification written by the implementer bends toward the implementation.
  Say so, and welcome an independent one.

# Writing Rules

Applies to **UI copy, code comments, commit messages, and replies to the user**.

- **NEVER** use these words: `honest`, `honestly`, `straight`, `straightforward`, `simply`, `just`, `clearly`, `obviously`, `basically`, `actually`, `of course`, `needless to say`.
- **Reason**: they either flatter the writer ("honest") or dismiss the reader's difficulty ("simply", "obviously"). A sentence that needs "honestly" to be believed is not improved by it, and "just do X" tells a stuck reader their problem is trivial.
- **Instead**: state the thing. Cut the adverb.
    - ❌ "Honestly, this is straightforward — just set the flag."
    - ✅ "Set the flag."
    - ❌ "The placeholder is honest about not being built."
    - ✅ "The placeholder names the endpoint it will read."
- Exception: `just` is allowed in its temporal sense (`"just now"`, `"just released"`).

# Tool Use Rules

- **NEVER** use `sed`, `awk`, `grep`, `cat`, `head`, or `tail` inside the Bash tool.
- Always prefer the dedicated structured tools:
    - Use `Read` to view files (never `cat`, `head`, or `sed -n`).
    - Use `Grep` for search patterns (never bash `grep`).
    - Use `Edit` or `Write` for file modifications (never `sed -i` or heredocs).
- **Reason**: Dedicated tools automatically bypass manual approval prompts, generate accurate diffs, and prevent shell execution bugs.

## Project Overview

This is **VoKoo** — a voice-AI control plane: a faithful Vapi-style console built on
KooKoo/Ozonetel telephony, with the AI plane running on self-hosted hardware.

The UI is built with:

- **React 19** with TypeScript
- **Tailwind CSS v4.2** for styling
- **React Aria Components** as the foundation for accessibility and behavior

## Key Architecture Principles

### Component Foundation

- All components are built on **React Aria Components** for consistent accessibility and behavior
- Components follow the compound component pattern with sub-components (e.g., `Select.Item`, `Select.ComboBox`)
- TypeScript is used throughout for type safety

### Import Naming Convention

**CRITICAL**: All imports from `react-aria-components` must be prefixed with `Aria*` for clarity and consistency:

```typescript
// ✅ Correct
import { Button as AriaButton, TextField as AriaTextField } from "react-aria-components";
// ❌ Incorrect
import { Button, TextField } from "react-aria-components";
```

This convention:

- Prevents naming conflicts with custom components
- Makes it clear when using base React Aria components
- Maintains consistency across the entire codebase

### File Naming Convention

**IMPORTANT**: All files must be named in **kebab-case** for consistency:

```
✅ Correct:
- date-picker.tsx
- user-profile.tsx
- api-client.ts
- auth-context.tsx

❌ Incorrect:
- DatePicker.tsx
- userProfile.tsx
- apiClient.ts
- AuthContext.tsx
```

This applies to all file types including:

- Component files (.tsx, .jsx)
- TypeScript/JavaScript files (.ts, .js)
- Style files (.css, .scss)
- Test files (.test.ts, .spec.tsx)
- Configuration files (when creating new ones)

## Development Commands

```bash
# UI (Next.js, not Vite — the scaffold's default text is wrong for this project)
npm run dev              # Dev server on http://localhost:3000
npm run build            # Production build (runs the TypeScript check)
npm run start            # Serve the production build

# Rust control-plane API (server/), deployed on the VPS as vokoo-cp-api
cargo build --release --manifest-path server/Cargo.toml
```

`FA_PACKAGE_TOKEN` must be exported before `npm install`, or the Font Awesome kit
package will fail to resolve.

## Project Structure

### Application Architecture

```
src/
├── components/
│   ├── base/              # Core UI components (Button, Input, Select, etc.)
│   ├── application/       # Complex application components
│   ├── foundations/       # Design tokens and foundational elements
│   ├── marketing/         # Marketing-specific components
│   └── shared-assets/     # Reusable assets and illustrations
├── hooks/                 # Custom React hooks
├── pages/                 # Route components
├── providers/             # React context providers
├── styles/               # Global styles and theme
├── types/                # TypeScript type definitions
└── utils/                # Utility functions
```

### Component Patterns

#### 1. Base Components

Located in `components/base/`, these are the building blocks:

- `Button` - All button variants with loading states
- `Input` - Text inputs with validation and icons
- `Select` - Dropdown selections with complex options
- `Checkbox`, `Radio`, `Toggle` - Form controls
- `Avatar`, `Badge`, `Tooltip` - Display components

#### 2. Application Components

Located in `components/application/`, these are complex UI patterns:

- `DatePicker` - Calendar-based date selection
- `Modal` - Overlay dialogs
- `Pagination` - Data navigation
- `Table` - Data display with sorting
- `Tabs` - Content organization

#### 3. Styling Architecture

- Uses a `sortCx` utility for organized style objects
- Follows size variants: `sm`, `md`, `lg`, `xl`
- Color variants: `primary`, `secondary`, `tertiary`, `destructive`, etc.
- Responsive and state-aware styling with Tailwind

#### 4. Component Props Pattern

```typescript
interface CommonProps {
    size?: "sm" | "md" | "lg";
    isDisabled?: boolean;
    isLoading?: boolean;
    // ... other common props
}

interface ButtonProps extends CommonProps, HTMLButtonElement {
    color?: "primary" | "secondary" | "tertiary";
    iconLeading?: FC | ReactNode;
    iconTrailing?: FC | ReactNode;
}
```

## Styling Guidelines

### Tailwind CSS v4.2

- Uses the latest Tailwind CSS v4.2 features
- Custom design tokens defined in theme configuration
- Consistent spacing, colors, and typography scales

### Brand Color — VoKoo

The brand palette is **not** Untitled UI's purple. `src/styles/vokoo-brand.css` overrides
`--color-brand-*` and `--color-neutral-*` with the Vapi ramps (mint; `brand-500` is
`#00cc8f`), lifted from the reference dashboard's own stylesheet. It is imported after
`theme.css` so it wins.

Overriding those two scales re-skins the whole component library, so **never hardcode a
brand colour in a component** — it would not follow the theme. Edit `vokoo-brand.css`
instead of `theme.css`; the latter is vendor code that `untitledui upgrade` may replace.

### Brand Color Customization (vendor default — superseded above)

To change the main brand color across the entire application:

1. **Update Brand Color Variables**: Edit `src/styles/theme.css` and modify the `--color-brand-*` variables
2. **Maintain Color Scale**: Ensure you provide a complete color scale from 25 to 950 with proper contrast ratios
3. **Example Brand Color Scale**:
    ```css
    --color-brand-25: rgb(252 250 255); /* Lightest tint */
    --color-brand-50: rgb(249 245 255);
    --color-brand-100: rgb(244 235 255);
    --color-brand-200: rgb(233 215 254);
    --color-brand-300: rgb(214 187 251);
    --color-brand-400: rgb(182 146 246);
    --color-brand-500: rgb(158 119 237); /* Base brand color */
    --color-brand-600: rgb(127 86 217); /* Primary interactive color */
    --color-brand-700: rgb(105 65 198);
    --color-brand-800: rgb(83 56 158);
    --color-brand-900: rgb(66 48 125);
    --color-brand-950: rgb(44 28 95); /* Darkest shade */
    ```

The color scale automatically adapts to both light and dark modes through the CSS variable system.

### Style Organization

```typescript
export const styles = sortCx({
    common: {
        root: "base-classes-here",
        icon: "icon-classes-here",
    },
    sizes: {
        sm: { root: "small-size-classes" },
        md: { root: "medium-size-classes" },
    },
    colors: {
        primary: { root: "primary-color-classes" },
        secondary: { root: "secondary-color-classes" },
    },
});
```

### Utility Functions

- `cx()` - Class name utility (from `@/utils/cx`)
- `sortCx()` - Organized style objects
- `isReactComponent()` - Component type checking

## Icon Usage

### Font Awesome duotone — via the shim, always

This project uses **Font Awesome duotone** icons, NOT `@untitledui/icons`. Every icon
in the console is duotone (`duotone/solid`) — this is a project-wide rule, not a
per-component choice.

**Import icons ONLY from `@/components/icons`.** Never from `@untitledui/icons`, and
never from `@awesome.me/kit-*` directly in a component.

```typescript
// ✅ Correct
import { ChevronDown, Settings01, SearchLg } from "@/components/icons";

// ❌ Incorrect — reintroduces Untitled UI icons
import { ChevronDown } from "@untitledui/icons";

// ❌ Incorrect — bypasses the shim, so style/opacity are inconsistent
import { faChevronDown } from "@awesome.me/kit-9a13e121e5/icons/duotone/solid";
```

`src/components/icons.tsx` maps Untitled UI's icon names onto Font Awesome
definitions, so vendored components keep working unchanged. It is the single place
the icon set, style and duotone opacities are decided.

**When `npx untitledui add <component>` pulls in a new component**, it will import
from `@untitledui/icons`. Rewrite that one import line to `@/components/icons`. If a
name is missing from the shim, add it there — do not import Font Awesome directly in
the component.

**Adding a new icon** to the shim: pick the Font Awesome name (`/suggest-icon` or
`fa search <query>` can help), add the `fa*` import from the duotone/solid path, and
export it under the name callers use.

### Kit and tokens

- Kit `9a13e121e5` ("PersonalProjects") — Pro, SVG, Full Library, Font Awesome 6.7.2
- Package: `@awesome.me/kit-9a13e121e5`
- `FA_PACKAGE_TOKEN` **must be set in the environment for `npm install`** (locally, on
  the VPS, and in CI). `.npmrc` references the variable rather than storing the token.

### Duotone opacities

Font Awesome's defaults (primary 1.0 / secondary 0.4) assume dark icons on light
backgrounds. This console is dark, so the shim raises the secondary layer to 0.55 and
eases the primary to 0.95 — otherwise the second layer vanishes and icons read as flat
solid shapes. Change those in one place in the shim, never per component.

### Legacy Untitled UI icon reference (do not use)

Kept only to explain what the shim's names originally came from.

```typescript
import { Home01, Settings01, ChevronDown } from "@untitledui/icons";

// Component props - pass as reference
<Button iconLeading={ChevronDown}>Options</Button>

// Standalone usage
<Home01 className="size-5 text-gray-600" />

// As JSX element - MUST include data-icon
<Button iconLeading={<ChevronDown data-icon className="size-4" />}>Options</Button>
```

### Styling

```typescript
// Size: use size-4 (16px), size-5 (20px), size-6 (24px)
<Home01 className="size-5" />

// Color: use semantic text colors
<Home01 className="size-5 text-brand-600" />

// Stroke width (line icons only)
<Home01 className="size-5" strokeWidth={2} />

// Accessibility: decorative icons need aria-hidden
<Home01 className="size-5" aria-hidden="true" />
```

### PRO Icon Styles

```typescript
import { Home01 } from "@untitledui-pro/icons";
// Line
import { Home01 } from "@untitledui-pro/icons/duocolor";
import { Home01 } from "@untitledui-pro/icons/duotone";
import { Home01 } from "@untitledui-pro/icons/solid";
```

## Form Handling

### Form Components

- `Input` - Text inputs with validation
- `Select` - Dropdown selections
- `Checkbox`, `Radio` - Selection controls
- `Textarea` - Multi-line text input
- `Form` - Form wrapper with validation

## Animation and Interactions

### Animation Libraries

- `motion` (Framer Motion) for complex animations
- `tailwindcss-animate` for utility-based animations
- CSS transitions for simple state changes

### CSS Transitions

For default small transition actions (hover states, color changes, etc.), use:

```typescript
className = "transition duration-100 ease-linear";
```

This provides a snappy 100ms linear transition that feels responsive without being jarring.

### Loading States

- Components support `isLoading` prop
- Built-in loading spinners
- Proper disabled states during loading

### Disabled states

All components use `opacity-50` for disabled states instead of individual disabled color tokens:

```typescript
// Correct (v8)
"disabled:cursor-not-allowed disabled:opacity-50"

// Incorrect (v7 pattern, do not use)
"disabled:bg-disabled_subtle disabled:text-disabled disabled:ring-disabled"
```

## Common Patterns

### Compound Components

```typescript
const Select = SelectComponent as typeof SelectComponent & {
    Item: typeof SelectItem;
    ComboBox: typeof ComboBox;
};
Select.Item = SelectItem;
Select.ComboBox = ComboBox;
```

### Conditional Rendering

```typescript
{label && <Label isRequired={isRequired}>{label}</Label>}
{hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}
```

## State Management

### Component State

- Use React Aria's built-in state management
- Local state for component-specific data
- Context for shared component state (theme, router)

### Global State

- Theme context in `src/providers/theme.tsx`
- Router context in `src/providers/router-provider.tsx`

## Key Files and Utilities

### Core Utilities

- `src/utils/cx.ts` - Class name utilities
- `src/utils/is-react-component.ts` - Component type checking
- `src/hooks/` - Custom React hooks

### Style Configuration

- `src/styles/globals.css` - Global styles
- `src/styles/theme.css` - Theme definitions
- `src/styles/typography.css` - Typography styles

## Best Practices for AI Assistance

### When Adding New Components

1. Follow the existing component structure
2. Use React Aria Components as foundation
3. Implement proper TypeScript types
4. Add size and color variants where applicable
5. Include accessibility features
6. Follow the naming conventions
7. Add components to appropriate folders (`base/`, `application/`, etc.)

## Most Used Components Reference

### Button

The Button component is the most frequently used interactive element across the library.

**Import:**

```typescript
import { Button } from "@/components/base/buttons/button";
```

**Common Props:**

- `size`: `"xs" | "sm" | "md" | "lg" | "xl"` - Button size (default: `"sm"`)
- `color`: `"primary" | "secondary" | "tertiary" | "link-gray" | "link-color" | "primary-destructive" | "secondary-destructive" | "tertiary-destructive" | "link-destructive"` - Button color variant (default: `"primary"`)
- `iconLeading`: `FC | ReactNode` - Icon or component to display before text
- `iconTrailing`: `FC | ReactNode` - Icon or component to display after text
- `isDisabled`: `boolean` - Disabled state
- `isLoading`: `boolean` - Loading state with spinner
- `showTextWhileLoading`: `boolean` - Keep text visible during loading
- `children`: `ReactNode` - Button content

**Examples:**

```typescript
// Basic button
<Button size="md">Save</Button>

// With leading icon
<Button iconLeading={Check} color="primary">Save</Button>

// Loading state
<Button isLoading showTextWhileLoading>Submitting...</Button>

// Destructive action
<Button color="primary-destructive" iconLeading={Trash02}>Delete</Button>
```

### Input

Text input component with extensive customization options.

**Import:**

```typescript
import { Input } from "@/components/base/input/input";
import { InputGroup } from "@/components/base/input/input-group";
```

**Common Props:**

- `size`: `"sm" | "md" | "lg"` - Input size (default: `"md"`)
- `label`: `string` - Field label
- `placeholder`: `string` - Placeholder text
- `hint`: `string` - Helper text below input
- `tooltip`: `string` - Tooltip text for help icon
- `icon`: `FC` - Leading icon component
- `isRequired`: `boolean` - Required field indicator
- `isDisabled`: `boolean` - Disabled state
- `isInvalid`: `boolean` - Error state

**Examples:**

```typescript
// Basic input with label
<Input label="Email" placeholder="olivia@untitledui.com" />

// With icon and validation
<Input
  icon={Mail01}
  label="Email"
  isRequired
  isInvalid
  hint="Please enter a valid email"
/>

// Input group with button
<InputGroup label="Website" trailingAddon={<Button>Copy</Button>}>
  <InputBase placeholder="www.untitledui.com" />
</InputGroup>
```

### Select

Dropdown selection component with search and multi-select capabilities.

**Import:**

```typescript
import { MultiSelect } from "@/components/base/select/multi-select";
import { Select } from "@/components/base/select/select";
```

**Common Props:**

- `size`: `"sm" | "md" | "lg"` - Select size (default: `"md"`)
- `label`: `string` - Field label
- `placeholder`: `string` - Placeholder text
- `hint`: `string` - Helper text
- `tooltip`: `string` - Tooltip text
- `items`: `Array` - Data items to display
- `isRequired`: `boolean` - Required field
- `isDisabled`: `boolean` - Disabled state
- `icon`: `FC | ReactNode` - Icon for placeholder

**Item Props:**

- `id`: `string` - Unique identifier
- `supportingText`: `string` - Secondary text
- `icon`: `FC | ReactNode` - Leading icon
- `avatarUrl`: `string` - Avatar image URL
- `isDisabled`: `boolean` - Disabled item

**Examples:**

```typescript
// Basic select
<Select label="Team member" placeholder="Select member" items={users}>
  {(item) => (
    <Select.Item id={item.id} supportingText={item.email}>
      {item.name}
    </Select.Item>
  )}
</Select>

// With search (ComboBox)
<Select.ComboBox label="Search" placeholder="Search users" items={users}>
  {(item) => <Select.Item id={item.id}>{item.name}</Select.Item>}
</Select.ComboBox>

// With avatars
<Select items={users} icon={User01}>
  {(item) => (
    <Select.Item avatarUrl={item.avatar} supportingText={item.role}>
      {item.name}
    </Select.Item>
  )}
</Select>
```

### Checkbox

Checkbox component for boolean selections.

**Import:**

```typescript
import { Checkbox } from "@/components/base/checkbox/checkbox";
```

**Common Props:**

- `size`: `"sm" | "md"` - Checkbox size (default: `"sm"`)
- `label`: `string` - Checkbox label
- `hint`: `string` - Helper text below label
- `isSelected`: `boolean` - Checked state
- `isDisabled`: `boolean` - Disabled state
- `isIndeterminate`: `boolean` - Indeterminate state

**Examples:**

```typescript
// Basic checkbox
<Checkbox label="Remember me" />

// With hint text
<Checkbox
  label="Remember me"
  hint="Save my login details for next time"
/>

// Controlled state
<Checkbox isSelected={checked} onChange={setChecked} />
```

### Badge

Badge components for status indicators and labels.

**Import:**

```typescript
import { Badge, BadgeWithDot, BadgeWithIcon } from "@/components/base/badges/badges";
```

**Common Props:**

- `size`: `"sm" | "md" | "lg"` - Badge size
- `color`: `"gray" | "brand" | "error" | "warning" | "success" | "slate" | "sky" | "blue" | "indigo" | "purple" | "pink" | "rose" | "orange"` - Color theme
- `type`: `"pill-color" | "color" | "modern"` - Badge style variant

**Examples:**

```typescript
// Basic badge
<Badge color="brand" size="md">New</Badge>

// With dot indicator
<BadgeWithDot color="success" type="pill-color">Active</BadgeWithDot>

// With icon
<BadgeWithIcon iconLeading={ArrowUp} color="success">12%</BadgeWithIcon>
```

### Avatar

Avatar component for user profile images.

**Import:**

```typescript
import { Avatar } from "@/components/base/avatar/avatar";
import { AvatarLabelGroup } from "@/components/base/avatar/avatar-label-group";
```

**Common Props:**

- `size`: `"xs" | "sm" | "md" | "lg" | "xl" | "2xl"` - Avatar size (note: `"xxs"` was removed in v8)
- `src`: `string` - Image URL
- `alt`: `string` - Alt text for accessibility
- `initials`: `string` - Text initials when no image
- `icon`: `FC` - Icon when no image
- `status`: `"online" | "offline"` - Status indicator
- `verified`: `boolean` - Verification badge
- `badge`: `ReactNode` - Custom badge element

**Examples:**

```typescript
// Basic avatar
<Avatar src="/avatar.jpg" alt="User Name" size="md" />

// With status
<Avatar src="/avatar.jpg" status="online" />

// With initials fallback
<Avatar initials="OR" size="lg" />

// Label group
<AvatarLabelGroup
  src="/avatar.jpg"
  title="Olivia Rhye"
  subtitle="olivia@untitledui.com"
  size="md"
/>
```

### FeaturedIcon

Decorative icon component with themed backgrounds for emphasis and visual hierarchy.

**Import:**

```typescript
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
```

**Common Props:**

- `icon`: `FC` - Icon component to display (required)
- `size`: `"sm" | "md" | "lg" | "xl"` - Icon container size
- `color`: `"brand" | "gray" | "error" | "warning" | "success"` - Color scheme
- `theme`: `"light" | "gradient" | "dark" | "modern" | "modern-neue" | "outline"` - Visual theme style

**Theme Styles:**

- `light`: Subtle background with colored icon
- `gradient`: Gradient background effect
- `dark`: Solid colored background with white icon
- `modern`: Contemporary gray styling (gray color only)
- `modern-neue`: Alternative modern style (gray color only)
- `outline`: Border style with transparent background

**Examples:**

```typescript
// Basic featured icon
<FeaturedIcon icon={CheckCircle} color="success" theme="light" size="lg" />

// With gradient theme
<FeaturedIcon icon={AlertCircle} color="warning" theme="gradient" size="xl" />

// Dark theme for emphasis
<FeaturedIcon icon={XCircle} color="error" theme="dark" size="md" />

// Outline style
<FeaturedIcon icon={InfoCircle} color="brand" theme="outline" size="lg" />

// Modern styles (IMPORTANT: gray only)
<FeaturedIcon icon={Settings} color="gray" theme="modern" size="lg" />
```

### Link

**Note**: There is no dedicated Link component. Instead, use the Button component with an `href` prop and link-specific color variants.

**Import:**

```typescript
import { Button } from "@/components/base/buttons/button";
```

**Link Colors:**

- `link-gray` - Gray link styling
- `link-color` - Brand color link styling
- `link-destructive` - Destructive link styling

**Examples:**

```typescript
// Basic link
<Button href="/dashboard" color="link-color">View Dashboard</Button>

// With icon
<Button href="/settings" color="link-gray" iconLeading={Settings01}>
  Settings
</Button>

// Destructive link
<Button href="/delete" color="link-destructive" iconLeading={Trash02}>
  Delete Account
</Button>

// External link
<Button href="https://example.com" color="link-color" iconTrailing={ExternalLink01}>
  Visit Site
</Button>
```

### Common Component Patterns

1. **Size Variants**: Most components support `sm`, `md`, `lg` sizes
2. **State Props**: `isDisabled`, `isLoading`, `isInvalid`, `isRequired` are common
3. **Icon Support**: Components accept icons as both components (`Icon`) or elements (`<Icon />`)
4. **Compound Components**: Complex components use dot notation (e.g., `Select.Item`, `Select.ComboBox`)
5. **Accessibility**: All components include proper ARIA attributes and keyboard support

### Icon Usage

When passing icons to components:

```typescript
// As component reference (preferred)
<Button iconLeading={ChevronDown}>Options</Button>

// As element (must include data-icon)
<Button iconLeading={<ChevronDown data-icon className="size-4" />}>Options</Button>
```

## COLORS

MUST use color classes to style elements.

Bad:

- text-gray-900
- text-gray-600
- bg-blue-700

Good:

- text-primary
- text-secondary
- bg-primary

### Text Color

Use text color variables to manage all text fill colors in your designs across light and dark modes.

| Name                       | Usage                                                                                                                                                                |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text-primary               | Primary text such as page headings.                                                                                                                                  |
| text-primary_on-brand      | Primary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. CTA sections).                                         |
| text-secondary             | Secondary text such as labels and section headings.                                                                                                                  |
| text-secondary_hover       | Secondary text when in hover state.                                                                                                                                  |
| text-secondary_on-brand    | Secondary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. CTA sections).                                       |
| text-tertiary              | Tertiary text such as supporting text and paragraph text.                                                                                                            |
| text-tertiary_hover        | Tertiary text when in hover state.                                                                                                                                   |
| text-tertiary_on-brand     | Tertiary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. CTA sections).                                        |
| text-quaternary            | Quaternary text for more subtle and lower-contrast text, such as footer column headings.                                                                             |
| text-quaternary_on-brand   | Quaternary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. footers).                                           |
| text-white                 | Text that is always white, regardless of the mode.                                                                                                                   |
| text-placeholder           | Default color for placeholder text such as input field placeholders. This can be changed to gray-400, but gray-500 is more accessible because it is higher contrast. |
| text-brand-primary         | Primary brand text useful for headings (e.g. cards in pricing page headers).                                                                                         |
| text-brand-secondary       | Secondary brand text for brand buttons, as well as accented text, highlights, and subheadings (e.g. subheadings in blog post cards).                                 |
| text-brand-secondary_hover | Secondary brand text when in hover state (e.g. brand buttons).                                                                                                       |
| text-brand-tertiary        | Tertiary brand text for lighter accented text and highlights (e.g. numbers in metric cards).                                                                         |
| text-brand-tertiary_alt    | An alternative to tertiary brand text that is lighter in dark mode (e.g. numbers in metric cards).                                                                   |
| text-error-primary         | Default error state semantic text color (e.g. input field error states).                                                                                             |
| text-warning-primary       | Default warning state semantic text color.                                                                                                                           |
| text-success-primary       | Default success state semantic text color.                                                                                                                           |

### Border Color

Use border color variables to manage all stroke colors in your designs across light and dark modes. You can use the same values for `ring-` and `outline-` as well (i.e. `ring-primary` `outline-secondary`).

| Name                 | Usage                                                                                                                                                                                   |
| :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| border-primary       | High contrast borders. These are used for components such as input fields, button groups, and checkboxes.                                                                               |
| border-secondary     | Medium contrast borders. This is the most commonly used border color and is the default for most components (e.g. file uploaders), cards (such as tables), and content dividers.        |
| border-secondary_alt | An alternative to secondary border that uses alpha transparency. This is used exclusively for floating menus such as input dropdowns and notifications to create sharper bottom border. |
| border-tertiary      | Low contrast borders useful for very subtle dividers and borders such as line and bar chart axis dividers.                                                                              |
| border-brand         | Default brand border color. Useful for active states in components such as input fields.                                                                                                |
| border-brand_alt     | An brand border color that switches to gray when in dark mode. Useful for components such as brand-style variants of banners and footers.                                               |
| border-error         | Default error state semantic border color. Useful for error states in components such as input fields and file uploaders.                                                               |
| border-error_subtle  | A more subtle (lower contrast) alternative for error state semantic borders such as error state input fields.                                                                           |

### Foreground Color

Use foreground color variables to manage all non-text foreground elements in your designs across light and dark modes. Can be used via `text-`, `bg-`, `ring-`, `outline-`, `stroke-`, `fill-`, etc.

| Name                   | Usage                                                                                                                                                         |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fg-primary             | Highest contrast non-text foreground elements such as icons.                                                                                                  |
| fg-secondary           | High contrast non-text foreground elements such as icons.                                                                                                     |
| fg-secondary_hover     | Secondary foreground elements when in hover state.                                                                                                            |
| fg-tertiary            | Medium contrast non-text foreground elements such as icons.                                                                                                   |
| fg-tertiary_hover      | Tertiary foreground elements when in hover state.                                                                                                             |
| fg-quaternary          | Low contrast non-text foreground elements such as icons in buttons, help icons and icons used in input fields.                                                |
| fg-quaternary_hover    | Quaternary foreground elements when in hover state, such as help icons.                                                                                       |
| fg-white               | Foreground elements that are always white, regardless of the mode.                                                                                            |
| fg-brand-primary       | Primary brand color non-text foreground elements such as featured icons and progress bars.                                                                    |
| fg-brand-primary_alt   | An alternative for primary brand color non-text foreground elements that switches to gray when in dark mode such as active horizontal tabs.                   |
| fg-brand-secondary     | Secondary brand color non-text foreground elements such as accents and arrows in marketing site sections (e.g. hero header sections).                         |
| fg-brand-secondary_alt | An alternative for secondary brand color non-text foreground elements that switches to gray when in dark mode such as brand buttons.                          |
| fg-error-primary       | Primary error state color for non-text foreground elements such as featured icons.                                                                            |
| fg-error-secondary     | Secondary error state color for non-text foreground elements such as icons in error state input fields and negative metrics item charts and icons.            |
| fg-warning-primary     | Primary warning state color for non-text foreground elements such as featured icons.                                                                          |
| fg-warning-secondary   | Secondary warning state color for non-text foreground elements.                                                                                               |
| fg-success-primary     | Primary success state color for non-text foreground elements such as featured icons.                                                                          |
| fg-success-secondary   | Secondary success state color for non-text foreground elements such as button dots, avatar online indicator dots, and positive metrics item charts and icons. |

### Background Color

Use background color variables to manage all fill colors for elements in your designs across light and dark modes.

| Name                    | Usage                                                                                                                                                                                         |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bg-primary              | The primary background color (white) used across all layouts and components.                                                                                                                  |
| bg-primary_alt          | An alternative primary background color (white) that switches to bg-secondary when in dark mode.                                                                                              |
| bg-primary_hover        | Primary background hover color. This acts as the default hover state background color for components with white backgrounds (e.g. input dropdown menu items).                                 |
| bg-primary-solid        | The primary dark background color used across layouts and components. This switches to bg-secondary when in dark mode and is useful for components such as tooltips and Text editor tooltips. |
| bg-secondary            | The secondary background color used to create contrast against white backgrounds, such as website section backgrounds.                                                                        |
| bg-secondary_alt        | An alternative secondary background color that switches to bg-primary when in dark mode. Useful for components such as border-style horizontal tabs.                                          |
| bg-secondary_hover      | Secondary background hover color. Useful for hover states for components with gray-50 backgrounds such as active states (e.g. navigation items and date pickers).                             |
| bg-secondary_subtle     | An alternative secondary background color that is slightly lighter and more subtle in light mode. This is useful for components such as banners.                                              |
| bg-secondary-solid      | The secondary dark background color used across layouts and components. This is useful for components such as featured icons.                                                                 |
| bg-tertiary             | The tertiary background color used to create contrast against light backgrounds such as toggles.                                                                                              |
| bg-quaternary           | The quaternary background color used to create contrast against light backgrounds, such as sliders and progress bars.                                                                         |
| bg-active               | Default active background color for components such as selected menu items in input dropdowns.                                                                                                |
| bg-overlay              | Default background color for background overlays. These are useful for overlay components such as modals.                                                                                     |
| bg-brand-primary        | The primary brand background color. Useful for components such as check icons.                                                                                                                |
| bg-brand-primary_alt    | An alternative primary brand background color that switches to bg-secondary when in dark mode. Useful for components such as active horizontal tabs.                                          |
| bg-brand-secondary      | The secondary brand background color. Useful for components such as featured icons.                                                                                                           |
| bg-brand-solid          | Default solid (dark) brand background color. Useful for components such as toggles and messages.                                                                                              |
| bg-brand-solid_hover    | Solid brand background color when in hover state. Useful for components such as toggles.                                                                                                      |
| bg-brand-section        | This is the default dark brand color background used for website sections such as CTA sections and testimonials. Switches to bg-secondary when in dark mode.                                  |
| bg-brand-section_subtle | An alternative brand section background color to provide contrast for website sections such as FAQ sections. Switches to bg-primary when in dark mode.                                        |
| bg-error-primary        | Primary error state background color for components such as buttons.                                                                                                                          |
| bg-error-secondary      | Secondary error state background color for components such as featured icons.                                                                                                                 |
| bg-error-solid          | Default solid (dark) error state background color for components such as buttons, featured icons and metric items.                                                                            |
| bg-error-solid_hover    | Default solid (dark) error hover state background color for components such as buttons.                                                                                                       |
| bg-warning-primary      | Primary warning state background color for components.                                                                                                                                        |
| bg-warning-secondary    | Secondary warning state background color for components such as featured icons.                                                                                                               |
| bg-warning-solid        | Default solid (dark) warning state background color for components such as featured icons.                                                                                                    |
| bg-success-primary      | Primary success state background color for components.                                                                                                                                        |
| bg-success-secondary    | Secondary success state background color for components such as featured icons.                                                                                                               |
| bg-success-solid        | Default solid (dark) success state background color for components such as featured icons and metric items.                                                                                   |
