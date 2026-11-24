# better-vault design system (redesign, round 4)

This document locks the design system for the redesign. It is written for the engineers and designers who build the screens in `design-brief.md`, starting with the hero screen (the document reader with the companion panel).

## 1. Purpose and sources of truth

The system already exists in code. This document adds usage rules and the redesign's new patterns on top of it. It does not add a visual direction.

| Layer | Source of truth |
|---|---|
| Colour, radius, fonts | `src/styles/tokens.css` (light in `:root`/`.theme-light`, dark in `.dark`), accent presets in `src/styles/accents.css` |
| Components | Panel UI, vendored in `components/panelui/`; shadcn in `components/ui/` only where Panel has nothing |
| App-wide CSS | `src/styles/globals.css` (one `@layer components` block: `.markdown`, `.study-reading-text`, `::highlight` rules) |
| Icons | Hugeicons only (`@hugeicons/react`, `@hugeicons/core-free-icons`) |
| Strings | i18next; English in `locales/en/*.json` |
| Hero mock-up | `R3-Fixed.dc.html` (round 3). Its hex values are the dark tokens; read it for sizes, states and rules, never copy its hex |

Rules that hold everywhere:

- Never put raw colours (hex, `rgb()`, `bg-neutral-800`) in app code. Use semantic utilities (`bg-card`, `text-muted-foreground`, `border-input`, `bg-chart-5/15`). Opacity modifiers and `color-mix()` on a token are allowed.
- Use logical properties (`ms-*`, `pe-*`, `start-*`, `inset-inline-end`, `text-start`) everywhere.
- Every user-facing string goes through `t("…")`, including `aria-label`s and reasons.
- Where a Panel component exists, use it. Change vendored code only when this document says so, and note why in the file.

## 2. Colour tokens and roles

### Surface and text

| Token (utility) | Role | Light | Dark |
|---|---|---|---|
| `background` | Page behind the desk; the prompt's field; the first-open strip | `oklch(1 0 0)` | `oklch(0.145 0 0)` ≈ #0a0a0a |
| `foreground` | Primary text, titles, active nav label | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` ≈ #fafafa |
| `card` / `card-foreground` | The desk (main column and companion), sidebar drawer, cited-line strip | white | `oklch(0.205 0 0)` ≈ #171717 |
| `popover` / `popover-foreground` | Menus, non-modal dialogs, the selection toolbar | white | #171717 |
| `primary` / `primary-foreground` | The one filled button; done segments of a progress bar; the reading-progress line | `oklch(0.205 0 0)` / near white | `oklch(0.922 0 0)` ≈ #e5e5e5 / #171717 |
| `secondary`, `muted`, `accent` | Tonal buttons, selected nav row, selected tab indicator, hover fill, selected exercise card | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` ≈ #262626 |
| `muted-foreground` | Secondary text, captions, section labels, idle icons, timestamps | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` ≈ #a1a1a1 |
| `border` | Hairlines: bar bottoms, list dividers, desk edge, column divider | `oklch(0.922 0 0)` | white 10% |
| `input` | Edges of controls and floating surfaces: tonal and outline buttons, popovers, toolbars, alert cards | `oklch(0.922 0 0)` | white 15% |
| `ring` | Non-text boundaries that must be seen (dark): prompt border, selected-tab and pressed-segment edge | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` ≈ #737373 |

Accent presets (`data-accent` on `<html>`) change `primary`, `primary-foreground` and `ring` only. Everything below must still work with each preset.

### Status and special roles

| Role | Token | Rule |
|---|---|---|
| **What Ask reads** | `chart-5` (violet: #8b5cf6 light, #a78bfa dark) | Used only for the scope: the scope chip, the margin rule, the passage mark, a pressed citation, the selection toolbar's Ask, the quoted passage in the prompt, and the dotted lead to the cited line. **In the reader and the companion, violet only means what Ask reads.** It is never a highlight colour, a button fill, a focus ring or decoration there. Elsewhere `chart-5` stays a data colour (chart series, book covers, Studio tints, mind maps, calendar). |
| Result, success | `success` | The check disc of a result row (`bg-success/15 text-success`). Never text colour; in light it is 2.5:1 on white. The text beside it carries the meaning. |
| Error | `destructive` | The icon of an inline error, destructive menu items, the red highlight swatch. The error's title stays `foreground`. |
| Live text selection | `info` | `color-mix(in oklab, var(--info) 35%, transparent)` while the selection toolbar is open (matches the PDF layer's native selection). |
| Warning | `warning` | Unchanged (Panel alert and tooltip tones). |

**Highlight colours** come from four tokens. Purple is not offered, because violet belongs to Ask.

| Swatch | Token | Paint |
|---|---|---|
| Yellow | `chart-4` | `::highlight(study-yellow)` at about 40% |
| Green | `chart-3` | about 35% |
| Blue | `chart-2` | about 35% |
| Red | `destructive` | about 35% |

Swatches are 14px circles with an inset 1px `black/20` edge. The `::highlight` rules in `components/study/study-pdf-page.css` move from raw `rgb()` to `color-mix()` on these tokens. Stored `pink` highlights draw with the red swatch and stored `purple` ones with blue; the stored value does not change, so no migration is needed.

### Non-text contrast (≥3:1)

Boundaries and indicators that identify a control or its state need 3:1 against their surface. Measured values:

| Pair | Dark | Light |
|---|---|---|
| `ring` on `card` / `background` / `muted` | 3.8 / 4.2 / 3.2 ✓ | 2.6 ✗ |
| `muted-foreground` on `background` | 6.9 ✓ | 4.7 ✓ |
| `chart-5` (full) on `card` / white | 6.6 ✓ | 4.2 ✓ |
| `chart-5` at 65% on its surface | 3.5 ✓ | 2.4 ✗ |
| `border`, `input` | decorative only | decorative only |

Rules that follow:

- The prompt border, the selected tab's edge and a pressed segment use **`ring` in dark and `muted-foreground` in light**: `border-muted-foreground dark:border-ring`. Accent rings pass in dark (blue 3.5, violet 3.1) and fail in light, so the light fallback stays `muted-foreground`.
- The margin rule is `chart-5/65` in dark and full `chart-5` in light.
- `border` and `input` hairlines never carry meaning alone. A tonal or outline button is identified by its label; a disabled one by its reason text.
- The scope chip's violet edge is decorative; the chip is identified by its text.

## 3. Type

### UI (Geist, `font-sans`)

Minimum size is 12px. Nothing smaller, including keyboard hints and badges. Weights: 400 regular, 500 medium (labels, buttons, titles), 600 semibold (the two-line primary's top line, large headings). Numbers that change or compare use `tabular-nums`.

| Size / line | Utility | Used for |
|---|---|---|
| 12 / 16 | `text-xs` | Captions, section labels (`h3` in panels), timestamps, counts, reasons under buttons, citation numbers, hints |
| 13 / 20 | `text-[0.8125rem] leading-5` | The default UI size: nav rows, header, tabs, menu rows in the companion, small buttons, scope chip, result rows, error text |
| 14 / 20 | `text-sm` | 40px buttons, exercise titles, Studio tool rows, Results body, empty-state titles |
| 14 / 22 | `text-sm leading-[22px]` | Short paragraphs in cards (Gemini card, Results summary) |
| 15 / 22 | `text-[0.9375rem] leading-[22px]` | Card titles ("No captions on this video") |
| 15 / 24 | Panel `Prompt` textarea | Prompt text (unchanged) |
| 15 / 28 | `.markdown` | Chat answers (unchanged) |
| 28 / 36 | serif, 600 | The Results title ("3 of 5 explained") |

### Reading serif

Reading text, quotes from the material, the cited line and the Results title use **Source Serif 4** with optical sizing (`font-optical-sizing: auto`). The app today falls back to Tailwind's `font-serif` (Georgia); the redesign bundles `@fontsource-variable/source-serif-4` (self-hosted, as Geist is; the content-security policy forbids Google Fonts) and sets `--font-serif: "Source Serif 4 Variable", Charter, Georgia, serif` in `tokens.css`. The reader's Sans option stays.

| Property | Value |
|---|---|
| Sizes | 15 to 25px in steps of 2 (Aa: Smaller / Larger); default 19. The stored setting (`textSize`, 14–28) is clamped to this range when shown. |
| Line height | `round(size × 1.684 / 4) × 4`, a multiple of 4: 15→24, 17→28, 19→32, 21→36, 23→40, 25→44 |
| Measure | `max-width: calc(32em + 40px)`: about 64 characters, plus the 16px rule column and 24px gap |
| Features | `font-feature-settings: "kern", "liga", "calt", "onum", "pnum"`; `letter-spacing: 0.003em` |
| Wrapping | `text-wrap: pretty` on paragraphs; `hanging-punctuation: first allow-end last` on `p` and `li` |
| Colour | `text-foreground/90` (≈ #e5e5e5 on card in dark) |
| Paragraph gap | 16px |
| Padding | 48px above, 96px below; logical inline padding |
| Other serif uses | Cited line 17/28; quotes in Results 16/24; quote in the scope menu and reader panel 15 / relaxed |

Headings inside reading text keep the `.markdown.study-reading-text` ratios in `globals.css`. Material in a right-to-left script sets `dir` on its own block (`dir="auto"`, `DirectionalText`), whatever the interface direction.

## 4. Spacing, radii, elevation, motion, icons

### Spacing

A 4px rhythm: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 96 (Tailwind `0.5` to `24`). Fixed measures from the mock-up:

| Measure | Value |
|---|---|
| Top bars (header, companion tabs) | `min-height: 52px`, so their hairlines meet in one line |
| Header padding | inline 20px start / 8px end; 4px on phones |
| Companion content | 16px inline |
| Rows | 32px (nav, menu, ghost), 36px (example asks), 44px (result rows, Studio tool rows, first-open strip) |

### Radii

`--radius` is 10px. Map the mock-up's radii to tokens, never to literal pixels:

| Mock-up | Token | Used for |
|---|---|---|
| 2–5px | `rounded-sm` (6px) or `rounded-[inherit]` | Citation numbers, swatch rings, progress segments (`rounded-full` for 4px bars) |
| 6–8px | `rounded-md` (8px) | Icon buttons, nav rows, menu rows, segment buttons, toolbar buttons |
| 10px | `rounded-lg` (10px) | 36px buttons, example asks |
| 12–14px | `rounded-xl` (14px) | Popovers, selection toolbar, cards, 40px buttons, result rows, the desk |
| 16px+ | Panel's own | Prompt (`rounded-[1.375rem]`), sheets, alerts |
| pills | `rounded-full` | Scope chip, switches, progress bars |

### Elevation

Surfaces are flat and separated by hairlines (`border`). Only floating things have a shadow, and they share **one popover shadow**: Panel Menu's `shadow-lg` with a `border-input` edge on `bg-popover`. In dark the mock-up draws it as `inset 0 1px 0 white/4%, 0 2px 4px black/30%, 0 12px 28px -6px black/60%`; if Panel's `shadow-lg` reads too weak on #171717, add that as one shared class, never per component. The filled button keeps Panel's `shadow-xs` and top inset highlight. The overlay companion (768–1279) and the phone drawer get one side shadow and a `black/50` scrim. Sheets keep Panel's.

### Motion

| What | Duration | Curve |
|---|---|---|
| Hover and colour changes | 150ms | `cubic-bezier(0.23, 1, 0.32, 1)` (the ease-out used by Panel's tooltip) |
| Press | 120ms, `scale(0.97)` | same; Panel Button already has `active:scale-[0.97]` |
| Menus, popovers, toolbar ("pop") | 160ms, from `scale(0.96)` and transparent | same, growing from the trigger (`origin-(--transform-origin)`) |
| Strips and panels appearing ("rise") | 200ms, from `translateY(6px)` | same |
| Companion tab indicator | 200ms on `inset-inline-start` | same (Panel Tabs keep their own 300ms curve if used unchanged) |
| Sheets, tabs content | Panel's own | — |

- A menu, popover or toolbar opened from the keyboard (`event.detail === 0`) appears at once, with no animation. A keyboard press (`:focus-visible:active`) does not scale.
- `prefers-reduced-motion: reduce` turns transitions and animations off (Panel components already use `motion-reduce:`). Spinners slow down instead (Panel's `--panelui-spinner-pace`).
- Nothing loops except progress (spinner, streaming caret).

### Icons

Hugeicons only, through `HugeiconsIcon`. Stroke 1.5. 16px in buttons, rows and menus (Panel's `size-4` default); 18px for the phone menu button; 14px for chevrons and inline glyphs (breadcrumb, chip chevron, "You left off here"); 12px with stroke 2 only inside small discs (the result row's check). Idle icons are `text-muted-foreground`; they take `currentColor` on hover and when selected. Every icon is `aria-hidden`; an icon-only button has a translated `aria-label`.

## 5. Layout and breakpoints

| Width | Sidebar | Main column | Companion | Targets |
|---|---|---|---|---|
| ≥1280 | Full, 216px, on `background` | The desk: `bg-card`, `border`, `rounded-xl`, 8px gap and page padding | A column inside the desk, `clamp(340px, 30vw, 440px)`, `border-s` | 32px controls with a 32px hit area |
| 768–1279 | Icon rail, 56px; labels become `sr-only`, section headings hide; rows 40px wide and centred | The desk fills the rest | Overlays the main column from the inline end: `width: min(400px, 100% − 48px)`, side shadow, `black/50` scrim; Escape or the scrim closes it | 32px |
| ≤767 | A drawer from the inline start (`min(304px, 86vw)`) with a scrim, opened from the header's menu button | The desk meets the screen edges (no border or radius) | A full-screen sheet (Panel `Sheet`, `size="full"`). With a video, the player docks to the top and the sheet starts under it | Every button, tab, switch and link row at least **44px**; hit areas of small controls grow to 44px |

On phones the header hides its position text, percentage and the primary's reason line (the reason stays as the button's accessible description). Both top bars are 52px at every width.

The video player sits under the header, 16:9, capped at `40vh × 16/9` wide, `rounded-xl`, `border`, on `background`.

## 6. Core components and states

### Buttons (Panel `Button`)

| Mock-up name | Panel | Look |
|---|---|---|
| **Filled** | `variant="default"` | `bg-primary text-primary-foreground`, `shadow-xs`. **One per view.** In the reader it is Practise this. While the Practise tab is open, Practise this steps back to outline and the session's Send answer may be filled. Ask's Send is tonal. |
| **Tonal** | `variant="secondary"` + `border border-input` | `bg-secondary`; hover raises the edge to `ring`. For the second most likely action: Send, Retry, Make it, Add a key, Make cards, Add the N you missed as cards. |
| **Outline** | `variant="outline"` | Answer actions (Make cards, Note, Copy, Listen), Next step, a primary that has stepped back. |
| **Ghost** | `variant="ghost"` | Icon buttons, Open, Undo, Cancel, Got it, menu-like rows. Idle text is `muted-foreground` for icon buttons. |

Sizes: Panel `sm` (32px, `rounded-md`) in bars and rows; a 40px `rounded-xl` variant for panel actions (Start, Make cards); `icon-sm` (32px) for icon buttons. On phones all become ≥44px.

**Two-line primary.** Practise this carries its reason under the label: top line 13/16 semibold (`Practise this`, or `Resume · 3 of 5` mid-session), reason 12/16 regular at `primary-foreground/72`; `min-height: 40px`, padding 4px block, 12px start, 16px end, `rounded-xl`. The reason has an id and the button points to it with `aria-describedby`. It is not a toggle: it opens the Practise tab and has no pressed state.

**Disabled with a reason.** An action that cannot run stays focusable: `aria-disabled="true"` (not `disabled`), the click handler returns early, and visible text says why, linked with `aria-describedby` ("Start needs a model. Practice uses it to read your answers."). It is drawn as outline with `border` and `text-muted-foreground`, no hover, no press scale, `cursor: not-allowed`. The fix sits next to it as a button (Add a key, Choose a model). Panel's `disabled` stays for controls that need no explanation (a stepper at its limit).

### Prompt (Panel `Prompt`)

The field is Panel's card with three changes, to be noted in the vendored file: the border is the non-text-contrast boundary (`border-muted-foreground dark:border-ring`, full opacity); focus adds a 1px ring of `muted-foreground` outside the border (2px total) instead of `border-ring/70`; and in the companion the field sits on `background`. Above the textarea, bands hold the quoted passage (a 2px `chart-5` bar, the quote in `foreground`, a clear button) or the no-AI notice (reason, Add a key, Choose a model). The footer holds the model picker (`Prompt.Model`), the Sources/Web segment and Send. While streaming, Stop (tonal, with a label) replaces Send. After a failure the question stays in the box. Under the field, a 12px hint: "Type `/` to see what I can make", with `kbd` in a 1px `input` box.

**Segmented toggle (Sources · Web):** a 32px group (`role="group"`, `aria-label`), `border`, `rounded-md`, 2px padding; 26px segments with `aria-pressed`. The pressed segment is `bg-muted` with a 1px `ring` edge (light: `muted-foreground`). Web, when unavailable, is `aria-disabled` with its reason.

### Tabs (Panel `Tabs`, `segmented`)

The companion's Ask · Practise · Make use Panel's segmented tabs (Base UI gives `tablist`/`tab`/`tabpanel`, `aria-selected`, roving tabindex, arrow keys that follow the direction, Home and End). Three equal tabs, 32px, 13/20 medium; idle `muted-foreground`, selected `foreground`. The indicator is `bg-muted` (dark: `bg-input` stays acceptable) with a 1px edge in the contrast boundary token, so the selected tab passes 3:1. Base UI measures the indicator, so it is right in RTL; a hand-built one moves on `inset-inline-start`. Tabs activate on arrow keys (automatic activation).

### Menus and non-modal dialogs

| Kind | Component | Use | Keyboard |
|---|---|---|---|
| **Menu** (`role="menu"`) | Panel `Menu` | A list of choices that closes on choice: the scope menu (`Menu.RadioItem`, label + detail, a separator before Everything, an `aria-hidden` "Ask reads" label), model picker, row overflow | Opening by keyboard focuses the checked item; arrows, Home, End; Enter chooses and returns focus to the trigger; Escape closes and returns focus; Tab closes |
| **Non-modal dialog** (`role="dialog"`, `aria-modal="false"`) | New `Popover`, built on Base UI's Popover (the primitive under Panel) and styled exactly as Panel Menu's popup | Mixed controls: **Contents** (Outline, Highlights, Words, each with a detail) and **Aa** (Text size group with Smaller, an `output aria-live="polite"` value, Larger, and More reading settings) | Focus moves to the first control when opened by keyboard; Tab moves inside; Escape closes and returns focus to the trigger |

Both: 256px wide (scope 248px), `p-1`, `rounded-xl`, `border-input`, the popover shadow, a 12/16 `muted-foreground` title. Triggers carry `aria-haspopup`, `aria-expanded`, `aria-controls`; an open trigger shows `bg-muted text-foreground`. Contents keeps its visible label; Aa is an icon button whose glyph is set in the serif.

### Selection toolbar

New, built from Panel `Button` (ghost, `icon-sm`) and the popover surface. It floats above the selection, anchored at its inline start, wraps when narrow, `p-1`, `gap-0.5`, `rounded-xl`, `border-input`, popover shadow, 13/20 text. Content, in order: a **Highlight** group (four swatches), divider, Translate, Listen, Save word, Make card, Note, divider, **Ask** (the only violet control: `border-chart-5/50 bg-chart-5/15`, medium). `role="toolbar"`, `aria-label="Selection"`, `aria-orientation="horizontal"`, roving tabindex over all ten buttons. Ask sets the scope to Passage, quotes the selection into the prompt and opens the companion on Ask.

### Navigation

| Part | Build | Rules |
|---|---|---|
| **Sidebar** | New `AppSidebar` from Panel `Button` (ghost) rows | `nav aria-label="App"`. Rows 32px, `rounded-md`, 16px icon, 12px gap, 13/20, idle `muted-foreground`, hover `foreground/5`. Current row: `bg-muted`, 1px inset `border`, `foreground`, medium, `aria-current="page"`. Section labels (Study, Notebooks, Tools) 12/16 medium `muted-foreground`. Counts ("12 due") 12/16 tabular. Account and Settings at the foot above a hairline. |
| **Add** | Outline row under the vault switcher | 32px, `border-input`, label plus "Link, file, text" in 12px muted. |
| **Rail** (768–1279) | Same component, collapsed | Labels `sr-only`, `title` tooltips (Panel `Tooltip`), rows 40px centred. |
| **Drawer** (≤767) | Same component in a fixed panel | Escape closes, the scrim closes, focus returns to the menu button. |
| **Vault switcher** | Panel `Menu` from a 36px row | A 20px monogram (`bg-muted`, inset `border`), the vault's name always visible, an up-down chevron; `aria-label` names the current vault. |
| **Header** | New `ReaderHeader` | One bar: breadcrumb `nav` (notebook ›), `h1` document title (13/20 medium, truncates with `title`), position and percentage (12px tabular, hidden on phones), Contents, Aa, a divider, the two-line primary, the companion toggle (`aria-expanded`, `aria-controls`). A 1px `role="progressbar"` in `primary` runs along its bottom edge with `aria-valuetext` ("5% read"). |

### Cards and rows

Rows inside panels are flat: 44px, a `border` divider, label 14/20 and a 12/16 muted detail at the end (Studio tools, outputs, cards count + Open). Choice cards (exercise options) are `label` + radio, 12px padding, `rounded-xl`; the chosen one is `bg-muted` with a `border-input` edge, the others a transparent border. Example asks are 36px outline rows (`border`, `rounded-lg`, 13/20, `text-start`). Panel `Card` is used for standalone cards (Gemini card, confirm card); Panel `Alert` for inline errors and the first-open strip.

## 7. Redesign patterns

**Companion panel (Ask · Practise · Make).** An `aside aria-label="Companion"` on the desk's `card` surface. A 52px bar holds the tabs and, below 1280, a close button. Each tab is a `tabpanel` with its own scroll (`ScrollArea`).

**Scope chip and margin rule.** Under the tabs on Ask, a 12px "Answers from" label and the chip: 28px pill, `border-chart-5/50 bg-chart-5/15`, a 2×12px `chart-5` bar, the scope's name (13/20 medium), a muted chevron. `aria-label`: "What Ask reads: Chapter 7. Change". It opens the scope menu (Passage · Chapter · Document · Notebook · Everything, each with a detail). History and New question sit beside it as icon buttons. In the text, a 2px rule in a 16px column at the inline start (24px gap) runs beside every paragraph Ask reads, with rounded ends at the first and last. With Passage scope the rule shrinks to the selected line and the passage is marked `bg-chart-5/15` with a 1.5px `chart-5` underline. The rule is `aria-hidden`; the chip states the scope in words.

**Citations and the cited-line strip.** A citation is a 20px button after the cited sentence: 12px medium tabular number, `rounded-sm`, `border-input`, `bg-foreground/5`, `text-muted-foreground`; hover and pressed use violet (`border-chart-5/50 bg-chart-5/20 text-foreground`). It is `aria-pressed` and labelled "Source 2: show the line under the text"; its hit area is 32px (44px on phones). Pressing it opens the **cited-line strip** at the bottom of the main column (`section aria-label="Cited line" aria-live="polite"`, top `border`, `bg-card`, rise animation): a caption ("Source 1 of 3 · further on in Chapter 7", or "at 14:20 in this video"), the line in the serif at 17/28, **Go to it** (ghost; in a video it plays from that time) and a close button. The margin rule continues to the strip as a dotted `chart-5` lead, meaning "further on". Pressing the same citation again closes it. Every answer starts with a stamp, "From Chapter 7 · 3 passages" ("Reading Chapter 7…" while streaming).

**Result row.** What the chat or an action made: 44px, `border`, `rounded-xl`, `bg-foreground/[0.02]`, 13/20; a 20px `success` disc with a check; "**12 cards** added to The Mom Test" (count in `foreground` medium); **Open** and **Undo** as ghost buttons. Only a result made in response to the person's action just now has `role="status"`; earlier rows in the thread do not announce.

**Confirm card (slow or paid creation).** Before audio, images or Gemini transcription, a Panel `Card` (`rounded-xl`, `border`, 20px padding) states what, from what, the model, the time and the cost ("About 4 minutes · uses your Google key", 13/20 muted tabular). Actions: **Make it** (tonal) and one alternative (ghost: Paste a transcript, Cancel). While running, the actions become a `role="status"` line ("Gemini is watching the video. About 4 minutes. You can keep using the app.") with Cancel. It never uses the filled style.

**First-open strip.** Once per new document: a Panel `Alert` banner under the header, 44px, `bg-background`, bottom `border`, an info icon in `muted-foreground`, "You can ask about it, practise it, or make cards from it." and **Got it** (ghost). Dismissing it removes it for good.

**Empty states.** One title (14/20 medium) naming the purpose, one 13/20 muted line, **one action**. Ask's empty state names the scope ("Ask about Chapter 7") and offers three example asks as outline rows; without a model, the line says what still works and the prompt band offers the fix. Lists inside panels use one sentence and one ghost action ("Nothing made in this notebook yet. · Ask for one").

**Inline AI errors.** Where it happened, as a Panel `Alert` (`plain`, `tone="destructive"`): `role="alert"`, 12px padding, `border-input`, `rounded-xl`; a 16px `destructive` icon, a `foreground` title ("Ask couldn't answer"), a muted line with the cause and what was kept ("Your question is still in the box below."), then the fix as buttons: **Retry** (tonal) and **Choose a model** or **Add a key** (ghost). Fix buttons deep-link into the right Settings group. Nothing else on the page is blocked.

**Practice session and Results.** The session runs in the Practise tab: a header with "Explain it back · Chapter 7" (12px muted), "3 of 5" (tabular) and **Finish** (ghost, always visible); a 5-segment `role="progressbar"` (4px bars, `rounded-full`, 2px gaps): done `primary`, current `muted-foreground`, upcoming `input`, with `aria-valuetext="3 of 5"`; finished items listed small; the current question; the answer prompt with voice and **Send answer** (filled here, because Practise this has stepped back). At most five controls are visible. **Results** open in the main column in place of the text (`section`, rise animation, reading measure): caption, the serif title "3 of 5 explained", a 14/22 muted summary, "What you missed" (each item: a citation, a title, the quote in serif 16/24), **Add the 2 you missed as cards** (tonal) becoming a result row, and one **Next step** (outline row with time). A close button returns to the text.

**You left off here.** A quiet bookmark in the text where Today's Continue reading lands: 12/16 sans, `muted-foreground`, a 14px bookmark icon, the words, and a `border` hairline filling the rest of the line. It is not a button and takes no focus; Continue reading scrolls to it.

**Video player, synced transcript and the Gemini card.** The player sits under the header (see layout). Under it, a bar with "Transcript" (12px muted `h2`) and a **Follow video** switch (`role="switch"`, Panel `Switch`). Transcript lines use the reading serif in a three-column grid: a 48px timestamp button ("Play from 11:42", 12px tabular, ghost), the 16px rule column, the text. The current line has `aria-current="true"`, `bg-muted` with a 4px spread, and `foreground` text; with Follow on, it scrolls into view. With no captions, the **Gemini card** (the confirm card pattern, on `bg-background`) takes the transcript's place, and Practise this becomes disabled with its reason ("Needs a transcript first").

## 8. Accessibility and keyboard

- **Focus:** every focusable element shows a 2px outline in `muted-foreground` with 2px offset (Panel buttons: `ring-[3px] ring-ring/40`, which stays). Tabs use an inset outline; the text region an inset of 4px. Focus never relies on colour change alone.
- **Roving tabindex:** the companion tabs, the selection toolbar, the scope menu and the Sources/Web segment are each one tab stop. Horizontal arrows follow the direction (in RTL, Left moves forward); vertical lists use Up and Down; Home and End go to the ends.
- **Selection toolbar:** the reading text is a focusable `region` (`tabindex="0"`, `aria-label` "Chapter 7 text", `aria-keyshortcuts="Alt+F10"`, described by an `sr-only` hint). With text selected, **Alt+F10** moves focus into the toolbar; Escape returns to the text with the selection kept.
- **Escape:** closes the innermost layer and returns focus to what opened it: menu or popover → its trigger; toolbar → the text; overlay companion (below 1280) → the companion toggle; drawer → the menu button. At ≥1280 Escape does not close the companion column.
- **Landmarks and headings:** `nav` "App", breadcrumb `nav`, `main`, the header's `h1` (the document), `aside` "Companion", `tabpanel`s, `article` for the text. Inside panels: `h2` for a panel's own title (empty Ask, Results), `h3` for its sections.
- **Live regions:** new result rows and running jobs `role="status"`; streaming "Writing the answer…" `role="status"`; errors `role="alert"`; the cited-line strip and the text-size value `aria-live="polite"`. Earlier results never re-announce. Busy areas set `aria-busy`.
- **Targets:** 32px hit area minimum on desktop, 44px on phones.
- **RTL:** logical properties only; the margin rule, toolbar anchor, indicator and overlay all sit at the inline start or end. Material direction is set per block with `dir`, separate from the interface.

## 9. Voice and glossary

Calm and focused: short sentences, plain verbs, second person, sentence case, no exclamation marks. Give reasons, not pressure ("Explain Chapter 7 back · about 3 minutes"). Praise is factual ("4 of 5 right"). Errors say what happened and offer the fix as a button. Never say "done" before something was done. No streaks, badges or guilt.

| Use | For | Never |
|---|---|---|
| **Ask** | The AI chat (its only label) | Chat, Assistant, AI |
| **Practise** / **Practice** | The verb / the page or a session | |
| **Make** / **Add** | Creating / bringing material in | Generate, Import |
| **Cards**, **Words** | What you keep | Vocabulary |
| **Review** | Going over cards and words | Browse, Collection |
| **Notebook**, **Inbox**, **Document**, **Output** | Where things live and what they are | |

## 10. New patterns to add to the codebase

Each is built from Panel parts and tokens, outside `components/panelui/`.

- [ ] `AppSidebar` (full, rail and drawer from one component) with `VaultSwitcher` (Panel `Menu`)
- [ ] `ReaderHeader` with the 1px reading `progressbar`
- [ ] `PrimaryAction`: Panel `Button` with a reason line, `aria-describedby`, and the `aria-disabled` + visible-reason behaviour (also used for Start, Make cards)
- [ ] `Popover`: a non-modal dialog on Base UI's Popover, styled as Panel Menu's popup; then `ContentsPopover` and `ReadingSettingsPopover` (Aa)
- [ ] `CompanionPanel` (Panel `Tabs`; column, overlay with scrim, or full-screen Panel `Sheet` by breakpoint)
- [ ] `ScopeChip` with `ScopeMenu` (Panel `Menu` radio items) and `ScopeRule` (the margin rule and passage mark)
- [ ] `SelectionToolbar` (roving toolbar, Alt+F10, Escape)
- [ ] `Citation` (pressable, violet when pressed) and `CitedLineStrip`
- [ ] `ResultRow` (Open, Undo, `role="status"` only when new)
- [ ] `ConfirmCard` (what, from what, model, time, cost; Make it; running state) and `GeminiCard` as its instance
- [ ] `InlineAIError` (Panel `Alert`, Retry and fix buttons that deep-link into Settings)
- [ ] `FirstOpenStrip` (Panel `Alert` banner)
- [ ] `EmptyState` (title, line, one action)
- [ ] `PracticeSession` and `PracticeResults`, with `SegmentedProgress`
- [ ] `LeftOffMarker`
- [ ] `VideoPlayer` and `SyncedTranscript` (Follow video switch, timestamp buttons, current line)
- [ ] Token and CSS work: bundle Source Serif 4 and set `--font-serif`; move highlight colours to tokens; live selection to `info`; one shared popover shadow class if `shadow-lg` is too weak in dark; the contrast-boundary pairing (`border-muted-foreground dark:border-ring`), as a utility in the single `@layer components` block if it repeats
- [ ] Vendored edits, each noted in the file: Panel `Prompt` border and focus ring; Panel `Tabs` segmented indicator edge

**Open question for the maintainer:** with the violet accent preset, `primary` is violet too, so the filled button and the scope share a hue. The scope still reads by its words and shape; if that is not enough, the scope could switch to `info` only under `data-accent="violet"`.
