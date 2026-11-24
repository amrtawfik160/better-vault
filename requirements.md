# better-vault redesign — Requirements

## Summary
better-vault is a local-first, bring-your-own-model place to learn anything you bring to it: books, PDFs, notes, web pages and YouTube videos. It already reads, answers, quizzes, coaches and schedules review, but it grew into several apps glued together: the same material lives in several places, four look-alike AI chats keep separate histories, Practice is two overlapping systems, and useful features can't be found. This redesign restructures the app around one obvious path, from material to understanding, practice and memory, for a self-learner who wants to spend their time learning, not navigating.

## Problem framing
### Problem statement
A self-learner needs a way to go from any material (a book, a PDF, notes, a YouTube video) to understanding it, practising it and remembering it, with one obvious path, because today the same material and the same AI live in several places, and choosing between them costs more time than learning.

### Primary user snapshot
Someone learning on their own, often in a second language, from books, papers, courses and videos. They mostly use the desktop app, sometimes a phone. Their jobs, in order: **practise** (explain it back, be quizzed, speak it), **remember** (cards, words, spaced review) and **understand** (read and ask until it makes sense).

What frustrates them:
- not knowing where something lives (a notebook, the Library, or a hidden notebook);
- four look-alike AI chats;
- long setup forms before practising;
- features that exist but can't be found;
- a YouTube link that silently saves nothing.

### Key scenarios
1. **New material.** They find a YouTube lecture and paste the link. Within 30 seconds they are asking about it, with its captions saved as a source in a notebook.
2. **Reading.** In a chapter they select a sentence, translate it, save the word, and ask the one chat about it, scoped to "this chapter".
3. **Practice.** After reading, they press Practise on the chapter, answer by typing or by voice, and finish on a results screen that says what to review next.
4. **Ask and create.** In the chat they say "turn this into flashcards" or "make a mind map". The cards land in their one deck, or the mind map opens in Studio, with Undo, and without hunting for buttons.
5. **Daily return.** They open the app on Today: they continue reading, see the cards that are due and one suggested practice, all within their current vault.

### How might we
- …give every piece of material exactly one visible home, and still let Study work across all of it?
- …make one AI conversation that adapts its scope (passage → notebook → everything) instead of four chats?
- …get someone from "I want to practise this" to the first question in two clicks?
- …let the chat *do* things (cards, quizzes, maps, notes) when asked, without surprising the user or their bill?
- …bring any link (web, YouTube) in through a single box that just works?

## Problem
The app works, but its structure costs time. A read-only audit (three agents, November 2026) found the following:

- **One file, three homes.** Adding a book in Study quietly creates a hidden notebook. The Library shows every notebook source as a "book". Home and Library offer different ways to add the same file.
- **Four AI chats with separate histories:** notebook Chat, the reader's Ask AI, Practice tutor sessions and Bots. About 20 different labels mean "ask the AI".
- **At least eight ways to make flashcards, and two flashcard systems:** Studio decks and Study review cards.
- **Practice is two systems on one page.** Written and speaking practice have overlapping names ("Explain what you learned" vs "Teach it back"). The page shows 6 exercise cards and 3 history lists before anything is chosen. Setup forms have up to 4 groups of options. The conversation screen has about 14 controls and no clear end. Results differ by mode.
- **YouTube.** A link in *Web page* saves an empty-looking source. The *Transcript* tab makes you copy the transcript by hand.
- **The chat can't be found doing what it can do.** It already draws diagrams, tables and flip cards, and "Make flashcards" exists under each answer, but neither is discoverable. It can't create Studio outputs or save cards when asked.
- **Navigation and setup.**
  - The notebook page drops the sidebar and moves the controls around.
  - The reader stacks three navigation bars.
  - Today says "You're done for today ✓" to brand-new users.
  - Settings is 13 ungrouped rows.
  - Onboarding never says what the app is for.
  - Vault scope is invisible.
  - The reader panel's **Make** tab doesn't open (a bug).

## Goals and success metrics
- **Primary signal: start fast.** From opening the app to the first question, answer or card in under 30 seconds, without hunting.
- You can start practising any material in two clicks or fewer.
- Every item has exactly one home; nothing is hidden.
- One AI chat history and one flashcard deck.
- No dead ends: every empty screen offers its next step.
- Business model unchanged: the app is free and open source, with optional Better Vault AI and Cloud plans.

## Users
### Primary user
The self-learner described above.

### Secondary users
None. It's a single-person local app; the optional account exists only for the subscription.

### Roles and permissions
None. There is one user per device. Vaults separate spaces, not people.

### Context of use
Desktop first (the desktop app and wide browsers); every screen must still work well on a phone. Sessions are short and often daily: reading a chapter, a review round, a practice exercise. Material is often in a second language; the interface is in English for now and must be ready for right-to-left languages (Arabic next).

## Core jobs (ranked)
1. **Practise:** prove you know it by explaining it back, being quizzed, role-playing, speaking or typing.
2. **Remember:** keep it, with one deck of cards and words on spaced review.
3. **Understand:** read the material and ask about it until it makes sense.
4. *(After these)* **Produce:** turn material into notes, reports, mind maps, decks and audio (Studio).

## Scope
### Must have
- **One home for material: the notebook.** Every document lives in one visible notebook. Today, Library and Review are views across all notebooks in the current vault. Adding a book asks which notebook it goes in, with Inbox as the default; existing hidden notebooks become visible.
- **One AI conversation with a scope** (passage, chapter, document, notebook, everything) and one history. It replaces notebook Chat, the reader's Ask AI and Practice tutor conversations. Bots stay a separate tool.
- **The chat can create anything the app can make:**
  - visuals in the answer;
  - Studio outputs (quiz, mind map, report, deck…);
  - cards in the one deck;
  - notes.

  Cheap creations happen at once with Undo. Slow or paid ones (audio overviews, images) show a confirm card first. With local models, which can't call tools, "/" commands in the prompt offer the same creations.
- **One flashcard deck.** Every card, whoever makes it, goes into review, grouped by notebook. Studio's flashcard tool generates cards into it.
- **One Practice model.** You pick the material and the exercise (questions, explain it back, role-play); typing or voice are only ways to answer. One history, sensible defaults so the first question comes in two clicks, and one shared results screen with a score and what to review next.
- **YouTube links:** read the video's captions; when it has none or YouTube blocks the request, offer to have Gemini watch it with the user's Google key. One "paste any link" box sends each link to the right importer. A YouTube page is never saved as an empty web page.
- **Navigation.**
  - The notebook page uses the app's normal sidebar layout (which can collapse).
  - The sidebar reads Study / Notebooks / Tools; Calendar, Bot and Skills go under Tools, which can be hidden.
  - A visible vault switcher scopes everything, Calendar and Bots included.
- **Home.** The app opens on Today; new users with nothing to study land on their notebooks.
- **Onboarding** ends on one box where the user adds their first material (link, file or text), then shows what they can do with it.
- **Progress** is shown quietly per notebook (cards known, practice results); Today shows the day. No streaks.
- **Errors and empty states.** AI errors explain the fix inline (Add a key, Choose a model), and everything that doesn't need AI keeps working. Every empty screen offers its next step.
- **Quick fixes found in the audit:**
  - Today's false "done" on day one.
  - The reader's Make tab.
  - The triple navigation in the reader.
  - Naming drift (Words/Vocabulary, Browse/Collection, the many "Ask AI" labels).
  - Settings grouping.
  - Silent disabled buttons.
  - Hard-coded English strings in the tutor.

### Should have
- A per-notebook mastery line.
- Answer actions visible on touch screens and on earlier answers, not only on hover.
- Error boundaries around single items so one bad record can't break a page.

### Won't have (this version)
- A new visual style. The current look stays (Panel UI, palette, type); this redesign is structure, layout and flows.
- System notifications, streaks or daily goals.
- A full Arabic interface (it should be ready for one, not translated).
- Multi-user features.
- Downloading YouTube audio.
- Merging Bots into the chat.

## Content and data
- **Material:**
  - files (TXT, MD, PDF, EPUB);
  - web pages;
  - pasted text;
  - transcripts (pasted, subtitles, recordings);
  - new: YouTube captions, or a Gemini transcript of the video.
- **Made by the user or the AI:**
  - highlights, words, cards, notes;
  - Studio outputs;
  - chat conversations and practice sessions and results.
- Everything stays on the device (IndexedDB on the web, SQLite in the desktop app). Keys stay in the browser or desktop app and travel only with each request.
- **Migration.** Existing data moves over automatically and nothing is lost:
  - hidden book notebooks become visible notebooks;
  - Studio flashcard decks become review cards;
  - the separate chat histories merge into the one history;
  - old backups still import.
- **Sensitive data:** API keys, ChatGPT and storage sign-ins (kept as AGENTS.md describes), and personal notes.

## Platform and integrations
- The web app (Vite + React + Hono) and the desktop app (Electron) stay in step: every change works in both, in the same change.
- **AI** goes through the Vercel AI SDK with the user's providers. Web search uses only the provider's built-in tool.
- **YouTube** captions are fetched server-side (the app's API, or the desktop main process). The Gemini fallback uses the AI SDK's video input.
- **Offline:** everything that doesn't need AI works offline.

## Constraints
- The AGENTS.md decisions stay (local-first, bring your own key, the providers' built-in web search, the AI SDK, Panel UI first, semantic tokens, Hugeicons, i18next strings, logical CSS properties).
- Every schema change needs a new Dexie version and a new SQLite migration. Backups stay importable.
- Ship in steps, each leaving the app fully working.
- The look stays as it is: no new visual direction.

## Brand and tone
- **Personality:** calm and focused. Quiet screens, one thing at a time, nothing shouting.
- **Must never feel:** busy, pushy or game-like, or like a control panel.
- **References liked:** NotebookLM (sources-first notebook with an AI that cites them), Readwise Reader (reading, highlighting and review in one calm app).
- **References disliked:** none named.
- **Competitors:** NotebookLM, Readwise Reader, Anki, LingQ-style readers.

## Lifecycle
- **First run:** a short setup (profile, AI), then one box to add the first material, then what you can do with it.
- **Returning:** the app opens on Today (continue reading, due cards, one suggested practice); with nothing to study, it opens on the notebooks.
- **Reminders:** in-app only; Today shows what's due.
- **Data:** export and backup as today; deleting a notebook deletes its material, chats and cards after confirmation.

## Edge cases and states
- **No AI set up:** inline "Add a key" or "Choose a model", and non-AI features keep working.
- **Local models without tool calls:** "/" commands instead of creation on request.
- **YouTube without captions, or blocked:** offer Gemini (needs a Google key), or say clearly why it failed. Never save an empty source.
- **Empty states:** a new vault, a new notebook, nothing due, no practice yet. Each says what to do next, with one action.
- **Day one vs day 100:** Today must not claim "done" before anything was studied.
- **Long material:** large books and long videos (token cost and time shown before Gemini runs).
- **Slow or failed AI calls:** visible progress, a stop button and a retry.
- **Bad records:** one broken item must not break a whole page.
- **Phone widths:** every flow works at 390px.
- **Right-to-left text:** in material now, in the interface later.

## Assumptions (signed off)
1. Success looks like: start practising any material in two clicks or fewer; every item has one home; nothing hidden; one chat history and one deck.
2. No secondary users; the account is only for the subscription.
3. The AGENTS.md constraints stay, and the web and desktop apps stay in step.
4. It must never feel busy, pushy or game-like, or like a control panel.
5. No new notifications in this version.
6. Data moves over automatically; nothing is lost; old backups import.
7. Studio stays, reached from the notebook and the chat.
8. Bots stay a separate tool; the one chat replaces notebook Chat, Ask AI and tutor conversations.
9. Every exercise ends on one shared results screen with a score and what to review next.
10. Every empty screen offers its next step; AI errors explain the fix inline.

## Open questions
None at the end of phase 1.

## Decision log
| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| Home for material | Notebook · Library · both as peers | Notebook, with Today, Library and Review as cross-notebook views | One place where things live removes most of the confusion |
| AI conversations | One chat with a scope · Ask + Practice · keep four | One chat with a scope | Removes four look-alike chats and histories |
| Size of this version | Pain points then structure · full restructure · pain points only | Full restructure now | The owner wants the whole platform to stop wasting time |
| Primary user | Self-learner · student · professional · language learner | Self-learner | Matches the owner and the app's direction |
| Core jobs | Understand · remember · practise · produce | Practise, remember, understand | Produce comes after the learning loop |
| Practice | One exercise model · split by activity · keep both simplified | One exercise model; voice and typing are ways to answer | One history and one results screen |
| Home screen | Today else notebooks · notebooks · where you left off | Today, else notebooks | The daily loop for returning learners |
| YouTube | Captions with Gemini fallback · captions only · Gemini only | Captions with Gemini fallback | Free when it works, still works without captions |
| What chat may create | Anything · Studio and visuals · visuals only | Anything the app can make | Asking should be enough |
| Confirmation | Only when it costs · always · never | Only for slow or paid creations; Undo for the rest | Cheap things feel instant; no surprise bills |
| Flashcards | One deck · two, choose on save · keep | One deck | One place to review |
| Vaults | Visible switcher · group of notebooks · remove | Visible workspace switcher that scopes everything | Scope should be visible and consistent |
| Calendar, Bot, Skills | Group under Tools · top level · hidden | Grouped under Tools, can be hidden | Keeps the learning loop in front |
| Notebook page layout | App layout · separate | The app's normal layout | Navigation stays the same everywhere |
| Platform | Desktop first · desktop only · equal | Desktop first, phone works | Matches how the app is used |
| Personality | Calm · fast · warm · smart | Calm and focused | — |
| Look | Keep · refresh | Keep the look, fix the flows | Faster, consistent with Panel UI |
| References | NotebookLM · Readwise Reader · Duolingo/Anki · Linear/Notion | NotebookLM, Readwise Reader | — |
| Rollout | In steps · all at once | In steps, each usable | Lower risk; data migrates automatically |
| First run | Add material · sample notebook · tour | Add material right away | Fastest path to value |
| Where books go | Choose with Inbox default · own notebook · one Library notebook | Choose, Inbox by default | One step, and no hidden notebooks |
| Local models | "/" commands · explain · hide | "/" commands | Works with every model and is discoverable |
| Languages | English, Arabic-ready · English + Arabic · English only | English now, Arabic-ready | Arabic interface next |
| Success signal | Start fast · daily return · remember more · less confusion | Start fast (under 30 seconds to first question or card) | — |
| Reminders | In-app · optional daily · none | In-app only | Calm, not pushy |
| Progress | Per notebook · stats page · streaks · none | Quietly, per notebook | Calm; no game mechanics |
| AI errors | Inline fix · setup screen first | Inline fix, keep working | Non-AI work never blocks |
