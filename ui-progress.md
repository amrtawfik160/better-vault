# better-vault redesign — UI progress (phase 3)

- **Canvas:** https://claude.ai/artifact/Txtty2Et1z6DYdUbNeij9J (private to the owner)
- **Design system:** not yet (round 4). The existing look stays: Panel UI, `src/styles/tokens.css`, Geist for UI, a serif for reading text, dark mode first.
- **Current round:** Round 3 done: all 20 critique fixes applied (`R3-Fixed`, states switchable in its Tweaks: aiState, docType, firstOpen, askEmpty, practice). Next: Round 4 · Lock the system.

## Round 1 · Directions (hero screen: the document reader with the companion panel)

| Option | Idea | Signature |
|---|---|---|
| A · Quiet Desk | Calm three columns: slim sidebar, centred serif column, companion docked as an equal partner | The scope is visible in the text: a faint margin rule shows what Ask is reading (chapter or passage), tinted like the scope chip |
| B · Focus Sheet | The page is a raised sheet; the sidebar collapses to an icon rail; the companion floats on top | "Practise this" pinned at the bottom of the page with its reason ("Explain chapter 7 back · about 3 minutes"); a chapter-progress rail on the sheet's edge |
| C · Margin Study | An annotated textbook: full sidebar, a wide gutter beside the text, a denser companion | Margin cards: highlights, saved words (with the translation), cards and Ask's citations sit beside the lines they belong to |

## Round 2 · Variations of A · Quiet Desk

| Option | What it pushed |
|---|---|
| A · Hierarchy | Practise this is the only filled button, two lines with its reason; Contents and Aa folded into one menu; a quieter sidebar; Ask reads in order (scope, "From Chapter 7 · 3 passages", answer, Make cards first, result row) |
| B · Signature | The margin rule gets a handle and a five-step scope ladder (passage → everything) that drives the chip; a double rule and "and 3 other documents" for wider scopes; citations [1]–[3] light up a strip with the cited line and "Go to it" |
| C · Craft | Serif at 19/32 with optical sizing and hanging quotes, a 4px rhythm, header and panel tabs on one 52px line, one elevation for menus that grow from their trigger, press feedback, a sliding tab indicator, reduced motion respected |

## Picks

| Round | Pick | Why |
|---|---|---|
| 1 · Directions | A · Quiet Desk | The owner's choice: calm, reading-first, the scope visible in the text |
| 2 · Variations | Combined: C's craft + A's hierarchy + B's citations (artboard `R2-Winner`) | C's finish as the base; A's two-line Practise this as the only filled button, one Contents/Aa menu and Ask's reading order; B's citations that show the cited line. B's margin scope ladder left out (too many controls for a calm reader) |
| 3 · Critique | All 20 fixes (artboard `R3-Fixed`; list in the scratchpad `round3-critique.md`, summarised here): breakpoints (three columns ≥1280, icon rail + overlay companion 768–1279, drawer + full-screen sheet on phone); no-AI, streaming, failed, empty and first-open states; keyboard access (selection menu Alt+F10, tabs, dialogs); Contents and Aa split; violet only for Ask's scope; practice session in the companion, Results in the main column, "Resume · 3 of 5", "You left off here"; 44px targets on phone; the YouTube player with a synced transcript and the Gemini card; tokens only; "New question" | The owner approved all of them |
