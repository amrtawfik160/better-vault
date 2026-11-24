# better-vault redesign — UI progress (phase 3)

- **Canvas:** https://claude.ai/artifact/Txtty2Et1z6DYdUbNeij9J (private to the owner)
- **Design system:** locked in round 4, written up in `design-system.md`. The existing look stays: Panel UI, `src/styles/tokens.css`, Geist for UI, Source Serif 4 for reading text, dark mode first.
- **Current round:** Round 5 · Roll out, done. Every screen in the brief's inventory has an approved or single-version board; next is building it in the app, in steps.

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

## Round 5 · Roll out (key screens, batch 1)

Every screen imports the shared `Sidebar.dc.html` component. Instructions for the agents: scratchpad `rollout-guide.md`.

| Screen | A | B | C |
|---|---|---|---|
| Add | Dialog over the page, compact; notebook as a dropdown | A page of its own: thumbnail, length, captions, "Opens as", notebooks as one row of choices | A command sheet from the sidebar's Add: paste, Enter adds, Tab picks the notebook |
| Today | One centred card: next step, reason, Start; Then as quiet rows | Editorial: a serif date, the step as one sentence, Then as a numbered list | Split: the step large on the left; "Your day" column with Then, due by notebook, Continue reading |
| Notebook | List: documents as rows with progress; outputs and notes below | Shelf: documents drawn as what they are; progress, Review, outputs on the right | Where you are: "You left off here" with the line, progress in one sentence, everything grouped by kind |

Batch 1 picks, combined on the canvas: `R5-Add-Win`, `R5-Today-Win`, `R5-Notebook-Win`.

## Round 5 · Roll out (batch 2)

| Screen | A | B | C |
|---|---|---|---|
| Practice | Single column: the suggestion card, "Or choose" (material dropdown, exercise segments, More options), then a history table | Two panes: Start on the left with an inline material list; History in its own column on the right | Exercise first: a one-line suggestion, then the three exercises as rows; the chosen one opens with material chips, More options and Start practice |
| Review | Focused: a summary card ("12 to review", by notebook) over the deck list with a Cards/Words switch; the session in a card with grades in a bottom bar | Deck first: the deck as a filtered table grouped by notebook, Start review in the header; the session takes the whole window | Two-step: a plan ("12 to review", tick the notebooks to include), then the card large in the serif with its source one click away |

All six carry the same states in Tweaks (Practice: returning, no material, no history, no AI; Review: page, question, answer, end, nothing due, empty deck). Batch 2 picks, combined on the canvas: `R5-Practice-C` (as is) and `R5-Review-Win`.

## Round 5 · Supporting screens (one version each)

| Screen | Board | States in Tweaks |
|---|---|---|
| Onboarding: Welcome, Profile, AI, first material | `R6-Onboarding` | welcome, profile, AI (checking, invalid key, local server missing), first material (importing) |
| Notebooks list | `R6-Notebooks` | returning, empty vault, no match |
| Library | `R6-Library` | returning, empty, no match |
| Studio output view | `R6-Output` | tool: audio, quiz, mind map × state: ready, generating, failed, broken |
| Notes | `R6-Notes` | returning, empty, graph |
| Tools: Calendar, Bot, Skills | `R6-Tools` | page × empty |
| Vault switcher | `R6-Vault` | open |
| Settings, seven groups | `R6-Settings` | group, deep link from Ask's "Add a key" |
| Upgrade notice (one time) | `R6-Upgrade` | shown, dismissed |

Consistency check across every Round 5 board: one filled button per view, violet only on Ask's scope chip, no text under 12px, only token colours (chart-2/3/4 for calendar entries and audio hosts), no banned glossary words (Vocabulary, Browse, Collection, Chat).

Open points for the build:
- The web article "How to interview your customers" sits in Inbox in the brief and in Practice and Library, but in The Mom Test on `R5-Notebook-Win`. Inbox is right; fix the notebook board's sample when building.
- The vault counts for "Work" and "Spanish class" on `R6-Vault` are sample data.
- The Notebooks list has no sidebar entry of its own: the sidebar's "Notebooks" heading becomes its link.

## Approved screens, in journey order

Onboarding (`R6-Onboarding`) → Add (`R5-Add-Win`) → Today (`R5-Today-Win`) → Notebooks list (`R6-Notebooks`) → Notebook (`R5-Notebook-Win`) → Document reader with the companion: Ask, Practise, Make, practice session and Results (`R3-Fixed`) → Studio output (`R6-Output`) → Practice (`R5-Practice-C`) → Review (`R5-Review-Win`) → Library (`R6-Library`) → Notes (`R6-Notes`) → Tools (`R6-Tools`) → Vault switcher (`R6-Vault`) → Settings (`R6-Settings`) → Upgrade notice (`R6-Upgrade`).

## Picks

| Round | Pick | Why |
|---|---|---|
| 5 · Practice | C · Exercise first | The owner's choice: the three exercises as rows, the chosen one opens with material chips and Start practice |
| 5 · Review | C · Two-step + A's deck list (Cards/Words switch, notebook filter) under the plan | The owner's choice |
| 5 · Add | A · Dialog + B's row of notebooks (one row of choices instead of a dropdown) | The owner's choice |
| 5 · Today | A · One card + C's "how Today chose this" ranked list inside "Choose something else" | The owner's choice |
| 5 · Notebook | C · Where you are + B's tall book tile | The owner's choice |
| 1 · Directions | A · Quiet Desk | The owner's choice: calm, reading-first, the scope visible in the text |
| 2 · Variations | Combined: C's craft + A's hierarchy + B's citations (artboard `R2-Winner`) | C's finish as the base; A's two-line Practise this as the only filled button, one Contents/Aa menu and Ask's reading order; B's citations that show the cited line. B's margin scope ladder left out (too many controls for a calm reader) |
| 3 · Critique | All 20 fixes (artboard `R3-Fixed`; list in the scratchpad `round3-critique.md`, summarised here): breakpoints (three columns ≥1280, icon rail + overlay companion 768–1279, drawer + full-screen sheet on phone); no-AI, streaming, failed, empty and first-open states; keyboard access (selection menu Alt+F10, tabs, dialogs); Contents and Aa split; violet only for Ask's scope; practice session in the companion, Results in the main column, "Resume · 3 of 5", "You left off here"; 44px targets on phone; the YouTube player with a synced transcript and the Gemini card; tokens only; "New question" | The owner approved all of them |
