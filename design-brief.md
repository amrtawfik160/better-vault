# better-vault redesign: design brief (handoff to the UI phase)

This brief stands on its own. The full reasoning is in `requirements.md` (phase 1) and `ux-brief.md` (phase 2).

## The product

better-vault is a local-first, bring-your-own-model place to learn anything you bring to it: books, PDFs, notes, web pages and YouTube videos. You read your material, ask about it, practise explaining it or answering questions, and keep what you learned with spaced review. It runs as a web app and as a desktop app (Electron) with the same interface. All data stays on the device, and AI runs on the user's own providers.

**Problem statement:** A self-learner needs a way to go from any material to understanding it, practising it and remembering it, with one obvious path, because today the same material and the same AI live in several places, and choosing between them costs more time than learning.

## Primary user and context

A self-learner, often reading in a second language, using books, papers, courses and videos.

- **Jobs, ranked:**
  1. **Practise:** explain it back, be quizzed, role-play, by typing or voice.
  2. **Remember:** one deck of cards and words on spaced review.
  3. **Understand:** read and ask until it makes sense.
  4. After these, **produce:** Studio outputs.
- **Where and when:** mostly the desktop app and wide browsers, sometimes a phone. Sessions are short and daily.
- **Success signal:** from opening the app to the first question, answer or card in under 30 seconds, without hunting.

## Chosen concept: The Open Desk, with a guided start and a chat that acts

Every document lives in one visible notebook (Inbox by default). Inside a notebook, the main column shows the notebook's overview, one document or one Studio output. A **companion panel** beside it has exactly three tabs:

- **Ask:** the one AI chat, with a scope chip (passage · chapter · document · notebook · everything) and one history.
- **Practise:** an exercise with the material already chosen.
- **Make:** Studio tools, outputs and cards.

**Today** names one next step and its reason. **Practise this** sits on every piece of material. The chat accepts links and files, lists every action under "/", and creates things on request with Undo, asking first only for slow or paid work.

**Mental model:** "My material sits on one desk. Beside whatever I'm reading, I can ask, practise or make. Today tells me where to start; Review keeps what I learned."

## Core flows (condensed)

1. **Add material.**
   1. Open Add from the sidebar, the chat prompt, an empty state or a notebook.
   2. Paste a link, drop a file or type text. The app detects the type and says it in plain words.
   3. The notebook field shows its default: the current notebook, else Inbox.
   4. A YouTube video brings in its captions as a timestamped transcript, with an embedded player above it. If there are no captions or the request is blocked, an inline card offers **Have Gemini watch it** with the time and token cost, or **Add a Google key**.
   5. Nothing empty is ever saved.
   6. When it's added, the document opens with Ask ready.
2. **Understand.**
   1. Read, then select text. The selection menu offers Highlight, Translate, Listen, Save word, Make card, Note and **Ask**.
   2. Ask sets the scope to Passage and quotes the selection.
   3. Answers cite passages; the learner can widen the scope at any time.
3. **Practise.**
   1. Press **Practise this**. The default exercise is Explain it back the first time, then Questions.
   2. Press **Start** to get the first question.
   3. Answer by typing or voice. The session shows "3 of 5" and **Finish** is always visible.
   4. **Results** show the score, what you missed (each linked to its passage), **Add the N you missed as cards**, and one next step.
   5. Today's **Start** begins the exercise in one click. The **Practice** page offers free choice across notebooks and holds the one history.
4. **Remember.**
   1. Press **Start review** (N due). It shows one card at a time with Again, Hard, Good and Easy (keys 1–4).
   2. Cards and words come in one queue, grouped by notebook.
   3. The end screen shows the hard items and one next step.
5. **Ask the chat to create.**
   - With a tool-capable model, "turn this into flashcards" creates the cards at once and shows a result row ("12 cards added to Biology · Open · Undo"). Studio outputs open in the main column.
   - With a local model, "/" lists every action.
   - Audio and images show a confirm card first (what, from what, model, time, cost; **Make it**).
6. **Daily return.**
   1. Open Today and see the **next step** with its reason.
   2. The step is chosen in this order:
      1. resume an unfinished session;
      2. practise something read in the last 48 hours;
      3. due cards;
      4. continue reading;
      5. new material.
   3. Then come **Start**, **Not today** and **Choose something else**, and a "Then" list of at most three.
   4. Today never says "done" before something was done. One quiet line appears when another vault has cards due.
7. **First run.**
   1. **Welcome:** the promise in one sentence.
   2. **Profile.**
   3. **AI:** provider and key, ChatGPT sign-in, a local model, or Better Vault AI (choosing it signs you in). This step can be skipped.
   4. **Add your first material.**
   5. The document opens with a one-time strip: "You can ask about it, practise it, or make cards from it."
8. **No AI, or an AI error.** The fix appears inline where it happened (Add a key, Choose a model). Everything else keeps working. Disabled controls always say why.

## Navigation model

- **Global sidebar** (collapsible; a drawer on phones):
  - the vault switcher (the current vault is always named; switching re-scopes everything);
  - **Add**;
  - **Study:** Today, Practice, Review, Library;
  - **Notebooks:** Notes (vault-wide), Inbox, the notebook tree;
  - **Tools:** Calendar, Bot, Skills (can be hidden);
  - Settings and account at the foot.
- **Contextual (in a notebook):** one header (notebook › document, **Practise this**, Contents, Aa, companion toggle), the main column, and the companion panel (Ask · Practise · Make). On phones the panel is a full-screen sheet.
- **Settings** is a sheet over any page, in seven groups: AI · Reading and voice · Account and plan · Storage and data · Appearance and language · Tools · About and updates.
- **Routes:**

  | Route | Shows |
  |---|---|
  | `/` | Today |
  | `/practice` | Practice |
  | `/review` | Review |
  | `/library` | Library |
  | `/notebooks` | Notebooks list |
  | `/notebook/:id` | Notebook overview |
  | `/notebook/:id/doc/:sourceId` | Document reader |
  | `/notebook/:id/output/:outputId` | Studio output |
  | `/notes` | Notes |
  | `/calendar` | Calendar |
  | `/bots` | Bots |
  | `/skills` | Skills |

  Old URLs redirect.

## Screen inventory (journey order)

| Screen | K/S | Primary action | Content priority |
|---|---|---|---|
| Onboarding: Welcome, Profile, AI | S | Continue / Use this AI | Promise → name → AI choices with cost and privacy line → Skip for now |
| Onboarding: Add your first material | K | Add | Add box → examples → Inbox preset → Skip |
| Add | K | Add | One input → detected type → notebook field → progress / Gemini card / error |
| Today | K | **Start** (next step) | Next step with reason → Then (≤3) → other-vault line |
| Notebooks list | S | New notebook | Inbox → notebooks with counts and quiet progress |
| Notebook overview | K | **Practise this** | Documents with reading progress → quiet progress → outputs → linked notes |
| **Document reader** (hero) | K | **Practise this** | One header → text, page, chapter, or player + transcript → position; selection menu |
| Companion: Ask | K | Send | Scope chip → thread with citations and result rows → prompt with "/" |
| Companion: Practise | K | **Start** | Material (prefilled) → exercise with default and reason → recent results |
| Companion: Make | S | Make cards | Make cards → Studio tools → outputs → cards |
| Chat creation confirm card | S | Make it | What, from what, model, time, cost |
| Studio output view | S | Tool's own (Play, Start quiz…) | The output → Ask about this, export |
| Practice page | K | Start practice | Suggestion → material + exercise → history |
| Practice session | K | Send answer / Next | Item "3 of 5" → answer (type or voice) → feedback → Finish. At most five controls visible |
| Results | K | Add the N you missed as cards | Score → what you missed, linked → next step |
| Review | K | **Start review** | Due count → session → end screen |
| Library | S | Add | Documents, each naming its notebook, with progress |
| Vault switcher | S | Choose a vault | Vaults → New vault → Manage |
| Settings | S | Per group | Seven groups; inline fixes deep-link into them |
| Notes | S | New note | Notes list, search, graph, backlinks |
| Tools pages | S | Each page's own | Calendar, Bot, Skills as today, scoped to the vault |
| Upgrade notice (one-time) | S | Got it | "Your books now live in notebooks; chats are in one history; all flashcards are in Review." |

Every screen has empty, loading, error and success states. Every empty state names the screen's purpose and offers one action. A broken record breaks only itself, never the page.

## Hero screen to design first

**The document reader with the companion panel open.** All three jobs meet there:
- practising, through Practise this;
- remembering, through the selection menu's Words and cards;
- understanding, through reading with a scoped Ask;

and producing happens there too, through Make.

It also carries the hardest structural problems:
- one header instead of today's three navigation bars;
- two columns that become a full-screen sheet on phones;
- the scope chip and the selection menu;
- right-to-left material;
- the YouTube player above a synced transcript.

The other screens reuse its patterns.

## UX principles

1. **One home, many views.** Every item lives in exactly one notebook; other pages show it and link back to it.
2. **The next step is one click away.** Every piece of material has Practise this. Every empty screen, result and review end offers exactly one next step.
3. **Asking is enough.** Anything the app can make can be asked for in the chat or found under "/". Nothing exists only behind a hover.
4. **Quiet, and honest about cost.** Cheap things happen at once with Undo; slow or paid ones say time and cost first. No streaks, no badges, no guilt.
5. **Works without AI.** Reading, words, cards, review and notes never wait on a model.

**Voice and tone:**
- Write calm and focused: short sentences, plain verbs, second person, sentence case, no exclamation marks.
- Give reasons, not pressure.
- Praise is factual ("4 of 5 right").
- Errors say what happened and offer the fix as a button.
- Never say "done" before something was done.

**Glossary:**

| Use | For | Never |
|---|---|---|
| **Ask** | the AI chat (the only label) | |
| **Practise** / **Practice** | the verb / the page or a session | |
| **Make** / **Add** | creating / bringing material in | |
| **Cards**, **Words** | what you keep | Vocabulary |
| **Review** | going over cards and words | Browse, Collection |
| **Notebook**, **Inbox**, **Document**, **Output** | where things live and what they are | |

## Brand and tone

- **Personality:** calm and focused.
- **Must never feel:** busy, pushy, game-like, or like a control panel.
- **References liked:** NotebookLM (sources-first, cited answers) and Readwise Reader (calm reading, highlighting and review in one place).
- **Competitors:** NotebookLM, Readwise Reader, Anki, LingQ-style readers.
- **Existing look stays, with no new visual direction:**
  - Panel UI components (shadcn only where Panel has none);
  - the semantic colour tokens in `src/styles/tokens.css` (no raw colours);
  - Hugeicons only;
  - the existing type and density;
  - light and dark themes.

## Platform, breakpoints and accessibility

- Web and desktop (Electron) must stay identical in every change. Desktop first.
- **Breakpoints:**
  - **Phone (390px):** the sidebar is a drawer and the companion is a full-screen sheet.
  - **Tablet and narrow desktop:** the companion overlays the main column.
  - **Wide (≥1280px):** sidebar, main column and companion side by side.
- **Accessibility:**
  - Everything works by keyboard, with a visible focus.
  - Icon-only buttons have translated labels.
  - Keyboard actions have no animation.
  - Reduced motion is respected.
  - Disabled controls state why.
- **Languages:** every string goes through i18next, in English now. Layouts use logical properties, so an Arabic (right-to-left) interface can follow. Material in right-to-left scripts reads right to left today.

## Must have vs won't have

**Must have:**
- One home: the notebook, with Inbox and visible notebooks.
- One scoped chat with one history.
- The chat creates anything, with Undo, a confirm card for paid work, and "/" for local models.
- One flashcard deck.
- One Practice model with defaults, a two-click start and one results screen.
- YouTube captions with the Gemini fallback, the embedded synced player, and one link box.
- The same sidebar layout everywhere, with Study / Notebooks / Tools and a visible vault switcher.
- Today as home: the next step with its reason, and no false "done".
- Onboarding that ends on Add.
- Quiet per-notebook progress.
- Inline AI fixes.
- A next step in every empty state.
- The quick fixes: reader header, naming, Settings groups, silent disabled buttons, tutor strings through i18next.

**Won't have (this version):**
- A new visual style.
- System notifications, streaks or goals.
- A full Arabic interface.
- Multi-user features.
- Downloading YouTube audio.
- Merging Bots into the chat.
- "Review all vaults" (replaced by Today's hint).
