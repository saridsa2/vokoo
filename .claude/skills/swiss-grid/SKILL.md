---
name: swiss-grid
description: "Build landing pages in the International Typographic Style: a visible 12-column modular grid, flush-left grotesque type at three sizes, and one accent used as data. Use when the user asks for a Swiss, International Typographic, modernist, systematic or grid-based design, names Helvetica, modular grids, baseline alignment or Muller-Brockmann, or wants a rigorous flush-left layout with mathematical spacing and a visible column structure."
---

# Swiss Grid

A landing-page system built on **structure made visible**. The International
Typographic Style, also called Swiss design, replaces decoration with organisation:
no ornaments, only a grid, a type scale, and one colour to spend.
The discipline *is* the design.

Guard against the page that uses Helvetica, centres everything, and calls itself
Swiss. That page has a centred hero headline, six type sizes, lucide icons in rounded
tiles, by-eye section padding, and no visible grid. It is a generic template wearing a grotesque. Swiss design reverses every structural
decision: the grid is real and visible, text is flush-left and never centred, the
type scale is brutally short, and every measurement uses one base unit.

Everything below is derived from one number, an 8px base unit, and one grid. Read
the anti-patterns (§13) first, then build the grid and place content into it, never
the reverse.

## 1. The core idea

> One grid. One typeface. One accent. Everything aligns or it is wrong.

A Swiss page is a **field of aligned relationships**, not a stack of centred blocks.
The eye is guided by position and negative space on a modular grid, not by
boxes, colour, or size contrast for its own sake. Objectivity is the goal: the
information is presented neutrally, and the designer's hand shows only in the
precision of the arrangement.

Four consequences drive the rules:

1. **The grid is the layout.** Do not centre and hope. Every element starts and
   ends on a column line. Asymmetry is default; balance comes from grid position,
   not symmetry.
2. **Text is flush-left, ragged-right.** Always. Centred and justified text are both
   banned. The left edge is the reader's anchor.
3. **The type scale is short.** Three sizes carry the entire page. A fourth fails
   the discipline.
4. **Colour is information.** Black, white, one accent. The accent marks a link,
   a category, or a datum. It never decorates.

## 2. The modular grid

This is the defining system. Define it before content. A Swiss grid has four
parameters: **columns**, **gutter**, **margin**, and **baseline unit**. Every
horizontal measure is a column or gutter; every vertical measure is a baseline
multiple.

The base unit is **8px**. The baseline grid is **8px**. Columns are **12** on
desktop, then 6, 4, and 2 as the viewport narrows. Gutters and margins are always
base-unit multiples.

| Breakpoint | Width | Columns | Gutter | Outer margin | Max content |
|---|---|---|---|---|---|
| `base` (mobile) | `< 640px` | 2 | `16px` | `16px` | fluid |
| `sm` | `≥ 640px` | 4 | `16px` | `24px` | fluid |
| `md` | `≥ 768px` | 6 | `24px` | `32px` | fluid |
| `lg` | `≥ 1024px` | 12 | `24px` | `48px` | fluid |
| `xl` | `≥ 1280px` | 12 | `32px` | `64px` | `1280px` |
| `2xl` | `≥ 1536px` | 12 | `32px` | `auto` | `1440px` |

**Hard rules:**

- **Every element snaps to a column line.** A headline spans columns 1–8. A caption
  sits in column 1. A paragraph occupies columns 1–5 while an image fills 7–12.
- **The baseline grid is 8px and vertical rhythm obeys it.** Every margin,
  line-height, and vertical gap is a multiple of 8px. A 24px gap is legal; a 22px
  gap is a bug.
- **Content max-width caps at `1440px`** and the grid centres inside it with growing
  margins beyond `1536px`. The columns stay a readable width and the outer margin
  absorbs the extra space.
- **Asymmetry is the default.** Do not fill all 12 columns evenly. A canonical Swiss
  field is unbalanced by column count (a 5-column text block against a 7-column
  image) and rebalanced by element weight.

## 3. Making the grid visible

Swiss design does not hide its structure. It celebrates it. The grid should be
*perceptible* in the finished page even without an overlay.

- **Align hard to column edges.** When a caption in column 1 lines up with the headline above and image below, the
  reader feels the grid without ruled lines.
- **Repeat the same start column.** If the eyebrow, headline, and body all begin at column 1, that shared edge becomes
  a visible spine.
- **A single hairline rule** (`1px`, text colour) at the top of a section, spanning
  the content width, is the one permitted structural ornament. Use it to
  separate major sections, never to box content.
- **In development, render the grid overlay** (§17) and confirm every element lands
  on a line. Ship with it removed. If an element does not align, the element is
  wrong, not the grid.

Never draw the full grid as visible ruled columns in production. That is a
wireframe, not a design. The grid is felt through alignment, punctuated by hairlines.

## 4. Type scale

The scale is **three sizes**, derived from the 8px unit and a ratio near 1.5 at the
display end. Agents reach for six sizes; use three, plus a caption. Restraint is
the style.

| Token | Desktop | Mobile | Weight | Tracking | Leading | Use |
|---|---|---|---|---|---|---|
| `display` | `clamp(40px, 6vw, 88px)` | `40px` | 500 | `-0.02em` | `1.0` | Hero and section headlines |
| `heading` | `clamp(20px, 2vw, 28px)` | `20px` | 500 | `-0.01em` | `1.2` | Sub-headlines, feature titles |
| `body` | `16px` | `16px` | 400 | `0` | `1.5` | All running copy |
| `caption` | `12px` | `12px` | 400 | `0.01em` | `1.33` | Labels, numbers, metadata, footnotes |

**Hard rules:**

- **Three sizes carry the page. Caption is the fourth and last.** There is no
  `text-lg` lead paragraph, no `text-xl` pull-quote, no fifth size. If a block needs
  emphasis, change its *weight* (400 → 500) or *grid position*.
- **One typeface only:** a neutral grotesque: Helvetica Now, Neue Haas Grotesk,
  Inter, or Univers. Never pair two families, never use a serif for accent. The
  whole page is one voice at three volumes.
- **Weight is 400 or 500. Never 600+.** Swiss grotesques carry hierarchy through
  size and position, not bold weight. `font-bold` is a different aesthetic.
- **Tracking is zero or slightly negative on display.** Positive letter-spacing
  appears only on `caption` labels at `0.01em`. No wide "luxury" spacing anywhere.
- **Line length for body is 60–75 characters** (`max-w-[66ch]`), roughly 5–6 columns.
  Wider than that and the flush-left setting loses its left anchor on the return.
- **Numbers are typographic content.** A large statistic is set in `display` weight
  500 with a `caption` label beneath, aligned to a column edge, never in a card.

## 5. Flush-left, ragged-right, and why centred text is banned

Every block of text in this style is **flush-left, ragged-right**. This is not a
preference; it is what makes the grid legible.

- **The left edge is the anchor.** A shared left edge across headline, body, and caption creates the vertical spine
  that makes an asymmetric layout read as ordered. Centre the text and that spine
  disappears.
- **Centred text is banned everywhere:** hero headline, section headings, body,
  captions. The sole exception is a centred glyph or number used as a graphic element, not
  reading text.
- **Justified text is also banned.** Forced justification creates rivers that fight the rational grid. Ragged-right is correct: the right edge may be
  uneven because the *left* edge is perfect.
- **Do not `text-balance` display headlines into a centred pyramid.** Control line
  breaks with explicit `<br />` at `lg:` so the ragged right edge is intentional.
- **Right-alignment is permitted only for numeric columns** in a data table, where
  place-value alignment aids reading. Never right-align prose.

## 6. Spacing system

Every vertical and horizontal gap is a multiple of the **8px base unit**. There are no arbitrary values. Choosing spacing "by eye" is the clearest tell
that a page is not Swiss.

| Relationship | Desktop | Mobile | Unit multiple |
|---|---|---|---|
| Section vertical padding | `96–128px` | `64px` | 12–16 / 8 |
| Headline → body | `24px` | `16px` | 3 / 2 |
| Body paragraph → paragraph | `16px` | `16px` | 2 |
| Caption → element it labels | `8px` | `8px` | 1 |
| Between grid fields (rows) | `64px` | `48px` | 8 / 6 |
| Column gutter | `24–32px` | `16px` | 3–4 / 2 |
| Hairline rule → content | `16px` | `16px` | 2 |

**Hard rules:**

- **The permitted spacing values are `8, 16, 24, 32, 48, 64, 96, 128`.** If you
  reach for `20px`, `40px`, or `72px`, you have left the system. Round to the unit.
- **Vertical rhythm accumulates on the 8px baseline.** Line-heights, margins, and
  padding resolve to multiples of 8, so text baselines across columns line up.
- **Space between fields is larger than space within a field**, by at least 3×. This
  separates one idea-field from the next without a border.
- **Negative space is structural, not leftover.** An empty grid field is a
  deliberate compositional element. Do not fill every column.

## 7. Colour

The library's tightest palette: **black, white, one accent, and greys from black.** The accent is used as *information*, never as ornament.

```
Light mode
  Paper / background   #FFFFFF
  Ink / text primary   #111111   (near-black, not pure #000)
  Ink secondary        #666666
  Hairline / rule      #111111   (rules are full-strength ink, hairline weight)
  Grid tint (dev only) rgba(17,17,17,0.06)
  Accent               #E2231A   (one signal colour: links, marks, active state)

Dark mode
  Background           #111111
  Ink primary          #F2F2F2
  Ink secondary        #999999
  Hairline / rule      #F2F2F2
  Accent               #FF3B30
```

**Hard rules:**

- **One accent, and it carries meaning.** The accent marks a link, an active nav
  item, a category tag, or a single emphasised number. It never fills a decorative
  shape, never tints a background, never appears on a heading "for interest".
- **No gradients anywhere.** Not on text, not on backgrounds, not on buttons. Swiss
  colour is flat, printed-poster flat.
- **Greys are derived from ink, not invented.** `#666666` is ink at reduced
  contrast, not a separate blue-grey. Secondary text uses it; nothing else needs a
  third neutral.
- **Rules are full-strength ink at hairline weight**, not a soft grey line. A Swiss
  rule is a confident `1px` black line, not a `border-neutral-200` whisper.
- **Colour blocks are allowed as content, not decoration.** A single solid accent
  field in specific grid columns (e.g. a CTA panel filling columns 8–12) is
  legitimate. A gradient blob behind the hero is not.

## 8. Navigation

- **Height `64px`**, aligned to the grid margins. The nav's left edge is the same
  column-1 edge as the content below. Not a floating pill, not a centred island.
- **Type `13–14px`, weight 400** for links, `500` for the active item, which also
  takes the accent colour. Links are flush against the grid margin, never centred.
- Left: wordmark in the grotesque at `heading` weight (a name, not a logo lockup).
  Right: 3–6 links plus at most one action.
- **A single hairline bottom border** (`1px` ink) separates nav from content. No
  shadow, no blur, no translucency. It may appear only after `8px` of scroll.
- Mobile: links collapse into a full-width sheet, stacked flush-left in column 1 at
  `heading` size. The menu is left-aligned like everything else.

## 9. Hero

The hero is a **grid composition**, not a centred stack. The strongest Swiss signal is a headline that begins in column 1 and spans 7–9
columns, with supporting elements placed in the remaining fields.

```
Grid: 12 columns
  Row 1  [caption/eyebrow: column 1, flush-left, accent or ink-secondary]
  Row 2  [display headline: columns 1–8, flush-left, ragged-right]
  Row 3  [body claim: columns 1–5]     [image or figure: columns 7–12, spans rows]
  Row 4  [primary action: column 1]   [metadata caption: column 12, right-aligned]
```

**Rules:**

- **The headline starts at column 1 and is flush-left.** It never centres, never
  sits in the middle of the viewport. Control its ragged right edge with `<br />` at `lg:`.
- **Asymmetry is the composition.** Text occupies the left fields and the visual
  the right fields, or the reverse, but never a symmetric centred column.
- **No pill badge, gradient, logo cloud, or "trusted by" strip.** A small `caption`
  label in column 1 (a category, a date, an issue number) is the only thing above
  the headline, and it is plain text, not a bordered pill.
- **The visual is objective:** a straight-on photograph, a geometric abstraction, or
  a single bold graphic form. No 3D-tilted device mockups, no floating cards.
- Negative space in the unused grid fields is part of the composition. Do not fill
  every column.

## 10. Content sections and grid fields

Each section is a **grid composition occupying specific fields**, not a centred
content block. Think by column ownership.

- **Text + figure:** text in columns 1–5, figure in columns 7–12 (or mirrored).
  Alternate which side the figure sits on between sections to create rhythm.
- **Index / list sections:** a numbered list where the number sits in `caption` in
  column 1 and item text begins in column 2 or 3. Every row shares edges, so the list
  reads as a ruled table without rules.
- **Three related items** are **three fields in one grid row** (columns 1–4, 5–8,
  9–12), each flush-left, separated by gutters and negative space. **Never use three
  bordered, shadowed cards**. The grid separates; boxes are forbidden.
- **A statistic block** sets the number in `display` with its `caption` label beneath, aligned to a column
  edge, several to a row.
- **Hairline rules** may top a section to mark a new field. Content is never boxed
  on all four sides.

Vertical alignment inside a multi-column field is `items-start`: text and figure
share a top edge on the baseline grid. Do not vertically centre unequal columns; the
top alignment reinforces the grid.

## 11. Imagery

- **Objective photography or pure geometric abstraction.** Straight-on product or subject photography with even lighting, or hard-edged
  geometric forms (circles, bars, rules) in ink and the single accent. Nothing painterly or decorative.
- **Images snap to grid fields**, filling them edge to edge (`object-cover`) or
  contained (`object-contain`) on paper. The image's box aligns to column lines.
- **Corner radius is `0`.** Swiss imagery is rectangular. No `rounded-xl`, no
  `rounded-full` except a genuinely circular graphic form used as content.
- **No drop shadows, reflections, floor planes, or glow.** An image sits flat.
- If you lack real imagery, use a solid accent or ink field, or a neutral placeholder
  sized to its grid columns. **Never fabricate a UI screenshot in
  markup** and never fill the space with a stock gradient.
- Duotone or single-accent-tinted photography is a classic Swiss device; full-colour
  photography is fine if it is objective and straight-on.

## 12. Motion

Motion in this style is **minimal and functional**. The grid is static and confident; movement clarifies structure, never entertains.
When in doubt, use none.

**The only motions permitted:**

1. **Fade / short rise on first view**, once. `opacity 0 → 1`, `y: 8px → 0`
   (**8px, one base unit; never more**), `400ms`, ease-out.

   ```tsx
   <motion.div
     initial={{ opacity: 0, y: 8 }}
     whileInView={{ opacity: 1, y: 0 }}
     viewport={{ once: true, margin: "-10% 0px" }}
     transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
   />
   ```

2. **Instant, snappy hover states** on links and actions: a colour change to the
   accent or an underline appearing, `150ms linear`. No scale, no lift, no glow.

3. **A single structural reveal:** a hairline rule drawing in from left to right
   (`scaleX 0 → 1`, transform-origin left, `500ms`) as a section enters, at most
   once or twice on the page. This draws the grid.

**Timing constants:**

| Interaction | Duration | Easing |
|---|---|---|
| Fade-in on view | `400ms` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Hover state | `150ms` | `linear` |
| Rule draw-in | `500ms` | `cubic-bezier(0.4, 0, 0.2, 1)` |

**Never:** parallax, letter-by-letter text animation, count-up numbers, marquees,
looping anything, spring bounce, magnetic buttons, cursor followers, tilt on hover,
blur-in text, or anything that pulls attention from content.
Wrap all motion in a `useReducedMotion()` guard that renders the final static state.

## 13. Anti-patterns: what makes a page fail this style

Each item alone breaks the style. Most are agent defaults.

**Composition**
1. Centred hero headline (the single most common failure: Swiss headlines are
   flush-left).
2. A symmetric, centred single-column page with no visible grid at all.
3. Elements floating between grid lines instead of aligning to a column line.
4. A 3-up or 4-up feature **card** grid (three fields is fine; three cards is not).
5. Cards of any kind: bordered, shadowed, or `bg-muted` rounded rectangles.
6. A "bento grid" of mismatched rounded tiles.
7. Filling all 12 columns evenly instead of composing asymmetrically.
8. Content wider than `1440px`, or a `max-w-7xl` that keeps stretching past `1536px`.

**Typography**
9. Six type sizes where three plus a caption would do.
10. A `text-lg` lead paragraph or `text-xl` pull-quote breaking the three-size scale.
11. `font-bold` / `font-extrabold` headlines (weight tops out at 500).
12. Two typefaces, or a serif accent font.
13. Justified body text with rivers of whitespace.
14. Centred body copy or centred captions.
15. Wide positive letter-spacing on display type for a "luxury" feel.
16. Gradient text on any headline.
17. Line length beyond 75 characters with no `max-w` constraint.

**Colour**
18. More than one accent colour.
19. The accent used as decoration (a tinted background, a coloured heading) rather
    than as a link/mark/datum.
20. Any gradient: text, background, or button.
21. Soft `border-neutral-200` whisper lines instead of confident `1px` ink rules.
22. A third invented neutral (a blue-grey) instead of ink at reduced contrast.
23. Coloured glows, shadows, or halos behind elements.

**Decoration**
24. Lucide/emoji icons in rounded-square coloured tiles.
25. A pill badge above the headline ("Now in beta").
26. Grid-pattern, dot-pattern, or noise/grain background overlays.
27. Decorative corner brackets, crosshairs, or `+` glyphs at intersections.
28. Glassmorphism / `backdrop-blur` on anything.
29. Drop shadows on images or blocks.

**Content and spacing**
30. Spacing values chosen by eye (`20px`, `40px`, `72px`) instead of multiples of 8.
31. A "How it works" 1-2-3 section with circular step badges.
32. A testimonial carousel with avatars, or a logo cloud in the hero.
33. Marketing-speak headlines ("Supercharge your workflow", "All-in-one platform").

## 14. Responsive behaviour

The modular grid does not break on small screens. It **reduces column count** while
preserving every other rule.

- **Columns step down: 12 → 6 → 4 → 2.** A field spanning columns 1–5 of 12 becomes
  full-width at `md`; a two-field row stacks to one column at `sm`. The reduction is systematic, not a reflow-and-hope.
- **Text stays flush-left at every breakpoint.** Do not centre on mobile "to fill
  the width". That is the exact failure the style forbids. Left-aligned, ragged
  right, always.
- **The type scale drops via `clamp()`**: `display` lands at `40px` on mobile,
  `heading` at `20px`, `body` and `caption` hold constant. No new sizes appear.
- **Spacing drops to the mobile column** of the §6 table, still in multiples of 8.
  Section padding `96–128px → 64px`; field gaps `64px → 48px`.
- **Margins shrink to `16–24px`** but never to zero; the flush-left spine needs a
  margin to sit against.
- Test at **375, 640, 768, 1024, 1280, 1440, and 1920**. At 1440+ the content caps and outer margins grow; columns stay readable and type
  stops scaling.

## 15. Accessibility

- **Contrast:** `#666666` on `#FFFFFF` is 5.7:1, which passes AA for all text sizes.
  The accent `#E2231A` on white is 4.6:1, adequate for `body`+ text and UI; pair links with an underline so colour is not the
  only signal.
- **Never rely on the accent alone** to convey state. An active nav item takes the
  accent *and* weight 500; a link takes the accent *and* an underline.
- Every section is a `<section>` with `aria-labelledby` pointing at its headline.
  Use exactly one `<h1>` (the hero headline); section headlines are `<h2>`.
- **Flush-left text is inherently more accessible** than centred or justified
  because it gives dyslexic and low-vision readers a consistent return point. This
  is a feature, not only an aesthetic.
- Focus rings are visible: `2px` solid accent, `2px` offset. Do not remove them for
  minimalism.
- Data tables use real `<table>`, `<th scope>`, and a `<caption>`; do not fake tabular
  data with aligned `<div>`s that a screen reader cannot parse.
- Full `prefers-reduced-motion` path: fades and rule draw-ins render as their final
  static state instantly.

## 16. Performance

- **The system is cheap by nature:** flat colour, no gradients, no blur, no heavy
  imagery. Budgets are tight: **LCP < 1.8s, CLS < 0.03, total weight < 1MB** for a
  text-and-figure page.
- The hero figure (if any) is the LCP element: preload it, serve AVIF/WebP, set
  explicit `width`/`height` to protect CLS, mark it `priority`.
- **The grid itself is pure CSS** (`grid-template-columns`): no JS layout, no
  measurement-driven positioning. Never compute grid positions in JavaScript.
- Load one font family in one or two weights (400, 500); a grotesque subset is
  `< 80KB`. Use `font-display: swap` with a metric-matched fallback so the
  flush-left layout does not shift on font load.
- Only animate `transform` and `opacity`. The rule draw-in uses `scaleX`.
- Remove the dev grid overlay from the production bundle entirely.

## 17. Implementation notes

Tailwind v4 theme tokens, so the scale and grid are used consistently:

```css
@theme {
  --text-display:  clamp(2.5rem, 6vw, 5.5rem);
  --text-heading:  clamp(1.25rem, 2vw, 1.75rem);
  --text-body:     1rem;
  --text-caption:  0.75rem;

  --color-paper:    #FFFFFF;
  --color-ink:      #111111;
  --color-ink-soft: #666666;
  --color-accent:   #E2231A;

  --grid-margin:  3rem;   /* 48px at lg */
  --grid-gutter:  1.5rem; /* 24px */

  --ease-swiss: cubic-bezier(0.4, 0, 0.2, 1);
}
```

**Reusable grid container:** every section places content into this:

```tsx
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="
        mx-auto grid w-full
        max-w-[1440px]
        grid-cols-2 gap-x-4 px-4
        sm:grid-cols-4 sm:px-6
        md:grid-cols-6 md:gap-x-6 md:px-8
        lg:grid-cols-12 lg:px-12
        xl:gap-x-8 xl:px-16
      "
    >
      {children}
    </div>
  );
}
```

**A hero field composed on the grid** (flush-left, asymmetric):

```tsx
<section aria-labelledby="hero" className="py-24 md:py-32">
  <Grid>
    <p className="col-span-2 md:col-span-6 lg:col-span-8 text-caption uppercase tracking-[0.01em] text-accent">
      Issue 01: Systematic Design
    </p>
    <h1
      id="hero"
      className="col-span-2 mt-4 md:col-span-6 lg:col-span-8 text-display font-medium leading-[1.0] tracking-[-0.02em]"
    >
      Structure is<br />the design.
    </h1>
    <p className="col-span-2 mt-6 md:col-span-4 lg:col-span-5 text-body leading-[1.5] text-ink-soft">
      Flush-left, ragged-right, on a twelve-column grid. No decoration, only order.
    </p>
    <div className="col-span-2 mt-8 lg:col-span-3 lg:col-start-1">
      <a className="text-body text-accent underline underline-offset-4 transition-colors duration-150 hover:opacity-70">
        Read the system
      </a>
    </div>
  </Grid>
</section>
```

**Dev-only grid overlay:** confirm alignment, then remove:

```tsx
{process.env.NODE_ENV === "development" && (
  <div className="pointer-events-none fixed inset-0 z-50 mx-auto max-w-[1440px] px-12">
    <div className="grid h-full grid-cols-12 gap-x-8">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-full bg-[rgba(226,35,26,0.06)]" />
      ))}
    </div>
  </div>
)}
```

## 18. Pairs well with React Bits Pro (optional)

You do **not** need React Bits Pro to use this skill. The grid, type scale, and
colour system are plain Tailwind and hold on their own. If the project has the
`@reactbits-pro` and `@reactbits-starter` registries configured, a few items
accelerate the build without fighting the system:

- `@reactbits-starter/staggered-text-tw`: restrained line-level reveals for a
  flush-left headline (§12.1). Set the rise distance to `8px` and disable per-letter
  splitting.
- `@reactbits-pro/hero-4`: a near-compliant asymmetric hero shell. Strip any pill
  badge and centring before use.
- `@reactbits-pro/features-2`: a column-based feature row. Remove card borders and
  shadows so the grid does the separating.

Ignore this section entirely if the registries are not configured. Never add a
dependency on them, and never let a pre-built block reintroduce cards, centring, or a
second typeface.

## 19. Self-verification loop

Re-read the rendered output and check every item. If any fails, fix it and rerun the
loop. Do not report completion with known failures.

**Grid**
- [ ] Every element starts and ends on a column line; nothing floats between lines.
- [ ] The composition is asymmetric; content does not fill all 12 columns evenly.
- [ ] Content caps at `1440px`; margins grow past `1536px` and columns stop widening.
- [ ] The grid is *felt* through alignment; no visible ruled columns ship to prod.

**Typography**
- [ ] Exactly three type sizes plus caption are in use. No fourth size.
- [ ] All text is flush-left, ragged-right. Nothing is centred or justified.
- [ ] No font weight above 500 appears anywhere.
- [ ] Exactly one typeface is loaded. No serif accent.
- [ ] No gradient text; body line length is under 75 characters.

**Spacing**
- [ ] Every gap is a multiple of 8 (`8, 16, 24, 32, 48, 64, 96, 128`). No `20/40/72`.
- [ ] Space between fields exceeds space within a field by at least 3×.

**Colour**
- [ ] Black, white, greys-from-ink, and exactly one accent. Nothing else.
- [ ] The accent marks information (link, active, tag, datum), never decoration.
- [ ] No gradient, glow, glass, noise, or pattern overlay exists anywhere.
- [ ] Rules are confident `1px` ink, not soft grey whispers.

**Motion**
- [ ] Rise distance is ≤ 8px; nothing loops, bounces, or animates letter-by-letter.
- [ ] `prefers-reduced-motion` renders a fully static, complete page.

**Anti-patterns (§13)**
- [ ] Re-read the full list against the page. Zero hits.
- [ ] Specifically confirm: no centred headline, no cards, no icon tiles, no pill
      badge, no by-eye spacing.

**Generic-AI smell test**
- [ ] Could this page be re-skinned into any centred SaaS template by centring the
      text? If yes, the grid is not doing its job. You have Helvetica on a brochure,
      not a Swiss page.
- [ ] Does any headline say "supercharge", "seamless", "all-in-one", or "built for
      modern teams"? Rewrite it as an objective statement.

**Responsive, a11y, performance**
- [ ] Verified at 375, 768, 1024, 1440, 1920. Columns step 12 → 6 → 4 → 2.
- [ ] Text stays flush-left at every breakpoint; nothing centres on mobile.
- [ ] One `<h1>`; sections labelled; focus rings visible; contrast passes AA.
- [ ] Grid is pure CSS; LCP figure preloaded with explicit dimensions.
