<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark-transparent.png">
  <img src="public/brand/logo-light-transparent.png" alt="better-vault logo" width="112">
</picture>

# better-vault

**An open-source, bring-your-own-model alternative to NotebookLM.**
Chat with your sources, and turn them into reports, flashcards, quizzes, tables and diagrams, using the AI model you choose.

[Website](https://better-vault.dev) · [Get started](https://better-vault.dev/docs/quickstart) · [Docs](https://better-vault.dev/docs) · [Roadmap](ROADMAP.md)

[![Version](https://img.shields.io/github/package-json/v/better-vault/better-vault?style=flat-square&color=262626&label=version)](https://github.com/better-vault/better-vault/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/better-vault/better-vault/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/better-vault/better-vault/actions/workflows/ci.yml)
[![Issues](https://img.shields.io/github/issues/better-vault/better-vault?style=flat-square&color=f59e0b)](https://github.com/better-vault/better-vault/issues)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-10b981?style=flat-square)](CONTRIBUTING.md)

[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![AI SDK](https://img.shields.io/badge/AI%20SDK-7-000000?style=flat-square&logo=vercel&logoColor=white)](https://ai-sdk.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![i18next](https://img.shields.io/badge/i18n-i18next-26A69A?style=flat-square&logo=i18next&logoColor=white)](#-translating)
[![Translations welcome](https://img.shields.io/badge/translations-welcome-8b5cf6?style=flat-square)](#-translating)

</div>

---

## ✨ What it does

better-vault is a free, open-source alternative to Google NotebookLM (now Gemini Notebook). It is a research and study notebook: you add **sources** such as PDFs, web pages, notes and text files to a **notebook**, and work with them using the AI model you choose.

**Chat with your sources** and get answers that cite the passages they came from. Switch to **Web** mode to let the model search the internet with its provider's built-in search.

**Create study material** in the **Studio**: reports, flashcards, quizzes, data tables, mind maps, slide decks, infographics and Anatomy figures, each with a dialog of options much like NotebookLM's. A **whiteboard** in the style of Excalidraw is there for your own diagrams, or for drawing over a figure or an infographic.

**Choose your model** from OpenAI, Anthropic and Google with your own key, or run a local model through Ollama or LM Studio. Nothing is locked to one vendor.

**Keep your data on your device.** The web app stores everything in your browser's IndexedDB, and the **desktop app** for macOS, Windows and Linux keeps it in a SQLite file on your computer. There is no account and no server database, and your keys only leave your device to reach the model you picked.

| Studio tool     | What you get                                                                                                                                                                                                                           | Download as         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Reports**     | Briefing doc, study guide, blog post, your own format, or a format suggested for your sources; read as a document with a table of contents and citations                                                                               | Word, Markdown      |
| **Flashcards**  | Flip cards with keyboard shortcuts, shuffle and "knew it / still learning" tallies                                                                                                                                                     | Word, CSV (Anki)    |
| **Quiz**        | Multiple-choice questions with hints, explanations and a score                                                                                                                                                                         | Word, Markdown      |
| **Data table**  | Facts from your sources in rows and columns                                                                                                                                                                                            | Excel, CSV          |
| **Mind map**    | An interactive tree like NotebookLM's: open branches, click a topic to ask about it in the chat. Plus 11 more diagram kinds (flowchart, timeline, cause and effect, …) drawn with [Pele](https://pele.run)                             | PNG, SVG, Mermaid   |
| **Slide deck**  | A presentation from your sources: a detailed deck to read, or a presenter deck with speaker notes. Present it full screen                                                                                                              | PowerPoint, PDF     |
| **Infographic** | A one-page picture drawn by your provider's image model (OpenAI GPT Image or Google Gemini), from a cited brief written from your sources                                                                                              | PNG, original image |
| **Anatomy**     | An interactive isometric figure of a real object whose working explains your sources, drawn with [Anatomy](https://skills.wheresryan.sh/anatomy)'s kit: point at a part to read what it does, step through how it works, take it apart | PNG, SVG            |
| **Whiteboard**  | A blank board with Excalidraw's tools and shortcuts: shapes, arrows, pen, text and pictures, in a hand-drawn style. **Annotate** opens a mind map, Anatomy figure or infographic on a board to draw over it. No model needed           | PNG, SVG, JSON      |

Audio and video overviews are out of scope.

## 🚀 Getting started

### Desktop app

Download the installer for macOS, Windows or Linux from [better-vault.dev/download](https://better-vault.dev/download) or the [latest release](https://github.com/better-vault/better-vault/releases/latest), install it and open it. It updates itself when a new version comes out. The [desktop docs](https://better-vault.dev/docs/desktop) cover installing and moving your notebooks over.

### Run from source

**Requirements:** [Node.js](https://nodejs.org) 22.12 or newer, with npm 10 (included with Node.js).

```bash
git clone https://github.com/better-vault/better-vault.git
cd better-vault
npm install
npm run dev
```

Open <http://localhost:3000> and choose **Use without an account**. The welcome screens ask you to connect your AI: sign in with ChatGPT, Claude or another plan you already pay for. You can do this later in **Settings → AI → AI subscriptions**, or add an API key or a local model in **Settings → AI → AI providers**.

### Production build

```bash
npm run build
npm start
```

### Local models (Ollama, LM Studio)

1. Install [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) and download a model (for example `ollama pull llama3.2`).
2. In better-vault, open **Settings → AI → AI providers**, enable Ollama or LM Studio and check the address (`http://localhost:11434` for Ollama, `http://localhost:1234` for LM Studio).
3. Pick the model in the prompt bar.

Local models work when better-vault runs on the same machine as the model server. Web search is only available with providers that have it built in (OpenAI, Anthropic, Google).

### Study

Open **Study** in the vault sidebar to import PDF, EPUB, Markdown, and text documents. From a notebook, use **Notebook options → Study documents** to see its reading material. Study documents have a linked notebook for Chat and Studio. Study saves your place, bookmarks, highlights, vocabulary, flashcards, review schedule, and activity locally. To ask about a passage, a chapter, or the whole book, open **Ask AI** in the reader. Its panel keeps your earlier conversations about that document, and **Open in notebook chat** asks the document's notebook instead. The **Practice** tab holds spoken exercises (teach it back, a meeting simulation, a technical interview, and language practice) together with your past sessions and conversations.

Select a passage to highlight it, ask for an explanation, practice explaining it yourself, or make a flashcard. **More passage actions** includes editable AI card drafts, Notes, translation, and vocabulary. Saved cards link back to their source. Upload a PDF, EPUB, or Markdown file in **Add sources** to use it in notebook Chat and Studio. Open the source and choose **Read in Study** to read it with its original layout or formatting.

Filter or select flashcards or highlights to review a subset. Choose **Practice now** to rehearse the selection ahead of schedule. During a session, write an answer or pick a quiz choice, then reveal the saved answer to compare. **Get AI feedback** opens an editable message with your response and the original study material in scope. Use **Back to review** to pick up where you left off, or **Continue AI feedback** to reopen your draft or conversation. If you choose Again or Hard, your response is saved locally so you can ask about it later from **Today → Needs more practice**. After a Studio quiz, you can add the questions you missed to review.

For scanned PDFs, choose **Recognize page text** in the reader and review the result before saving. Use **Recognize multiple pages** to process a range. You can close the dialog and pick up your corrections and approvals under **Continue scan review**. The pages you save become searchable in Study and join the notebook source. Recognition runs on your computer in the desktop app or on localhost. Install [Tesseract](https://tesseract-ocr.github.io/tessdoc/Installation) and its language data, then make the executable available on `PATH` or set `DEEPLE_TESSERACT_BIN` to its absolute path.

Choose **Discuss in Study** on a note to get answers that cite it. Session reports can save corrections as flashcards and suggested terms to Vocabulary. Reading, reviewing, and speaking time appear in Today. The local library and review work without an account. AI requests use the model you choose in the model picker: a connected AI subscription, an API key, or a local provider when you want to work without one.

When you choose **Draft cards from this answer** during flashcard practice, the draft can use the original card and the available source passages behind it. Links the model cites appear on the draft for you to check before you save. Open **View flashcards** to see the cards from that answer, or choose **Save and review** to review the cards you just saved. **Back to conversation** reopens the answer.

For voice practice in the desktop app or on localhost, install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and place its [multilingual tiny model](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny.bin) at `~/.cache/deeple/whisper/ggml-tiny.bin`. better-vault looks for `whisper-cli` on your system path, including the standard Homebrew locations on macOS. You can also set `DEEPLE_WHISPER_BIN` and `DEEPLE_WHISPER_MODEL` to absolute paths before launching. **Dictate** adds a transcript to your draft. **Speak your answer** sends the transcript to your selected model and uses an installed system voice to read its reply. Use a local AI model as well to keep the entire conversation on your computer.

Temporary voice turns clear after a report or when you leave the conversation. Enable transcript retention or select a default correction mode under **Study → Practice → Practice preferences**.

The study workflows were adapted from [MemoFlash](https://github.com/amrtawfik160/memoflash).

### Connect an AI subscription

Open **Settings → AI → AI subscriptions**, choose a provider, and approve the sign-in in your browser. ChatGPT, Claude, Antigravity, Grok, both Kimi portals, Devin, and Muse Code are available. When a provider shows a one-time code, enter it in the provider's sign-in page. Connected models appear in the Chat, Bots, and Studio model pickers.

The desktop installer includes CLIProxyAPI. A web app started on loopback with `npm run dev` or `npm start` installs the pinned, checksum-verified proxy on first use. The app starts and restarts it automatically. The proxy keeps credentials under `~/.better-vault/cliproxyapi` by default. The app sends relevant notebook context through the proxy to the provider you select.

Use **Reconnect** or **Disconnect** beside an account to manage it.

## 🔐 Where your data lives

Notebooks, sources, chats, Studio outputs and API keys stay on your device: in your browser's IndexedDB in the web app, or in `better-vault.sqlite` in the app's data folder in the desktop app. **Settings → Storage and data** exports and imports notebooks as a JSON file, which also moves them between the two.

Each request sends your key to the app's own API route, which passes it to the provider and never stores or logs it. If you host better-vault for other people, they use their own keys in their own browsers.

### Hosting for others

These environment variables control how a self-hosted app reaches other services.

| Variable                             | Default                 | Effect                                                                                                                  |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `BETTER_VAULT_ALLOW_LOCAL_PROVIDERS` | `true`                  | Set to `false` to turn off Ollama, LM Studio and CLIProxyAPI on a public server.                                        |
| `BETTER_VAULT_CLIPROXYAPI_URL`       | `http://127.0.0.1:8317` | Address of the trusted CLIProxyAPI instance used by the better-vault server.                                            |
| `BETTER_VAULT_ALLOW_PRIVATE_URLS`    | `false`                 | Set to `true` to let web-page sources point at private or local network addresses (only for trusted, private installs). |

## 🧱 Tech stack

[Vite 8](https://vite.dev) · [React Router](https://reactrouter.com) · [Hono](https://hono.dev) · [Vercel AI SDK 7](https://ai-sdk.dev) · [Panel UI](https://panelui.dev) · [shadcn/ui](https://ui.shadcn.com) · [Pele](https://pele.run) · [Hugeicons](https://hugeicons.com) · [i18next](https://www.i18next.com) · [Dexie](https://dexie.org) · [Electron](https://www.electronjs.org) and [electron-vite](https://electron-vite.org) · [Tailwind CSS 4](https://tailwindcss.com)

## 🤝 Contributing

Contributions are welcome, from typo fixes to new Studio tools. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short:

1. Fork the repo and create a branch (`feat/…`, `fix/…`, `docs/…`).
2. Make your change. Use [Conventional Commits](https://www.conventionalcommits.org) for messages.
3. Run the checks:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run i18n:check && npm run build
   ```
   If your change touches the server, storage or anything else the desktop app depends on, run the checks in `desktop/` too (see [CONTRIBUTING.md](CONTRIBUTING.md#the-desktop-app)).
4. Open a pull request and fill in the template.

Contributors and AI coding agents should also read [AGENTS.md](AGENTS.md), which explains the project's concepts and rules.

### 🌍 Translating

The UI is fully translatable with [i18next](https://www.i18next.com). English is the source language. To add a language:

1. Copy `locales/en/` to `locales/<code>/` (for example `locales/fr/`) and translate the values, not the keys.
2. Import the new files in `lib/i18n/resources.ts`.
3. Add the language to `lib/i18n/config.ts`, with `dir: "rtl"` for right-to-left scripts.
4. Run `npm run i18n:check` to find missing or extra keys, then open a pull request.

## 🐛 Reporting issues

Found a bug or have an idea? [Open an issue](https://github.com/better-vault/better-vault/issues/new/choose) and pick a template:

A **bug report** asks what happened, the steps to reproduce it, your browser or desktop system, and the provider and model you used. A **feature request** asks for the problem you want solved and how you imagine it working. The **translation** template is for offering or requesting a new language.

Please search existing issues first, and **never paste API keys** into an issue. Security problems should be reported privately, as described in [SECURITY.md](SECURITY.md).

## 🙏 Credits

- [Panel UI](https://panelui.dev) for the sheets, dialogs, prompt and the rest of the interface.
- [Pele](https://pele.run) for rendering Mermaid diagrams.
- [Anatomy](https://skills.wheresryan.sh/anatomy) by Ryan, whose MIT drawing kit draws the anatomy figures.
- [Hugeicons](https://hugeicons.com) for icons.
- [Excalidraw](https://excalidraw.com), whose whiteboard inspired ours, for Excalifont (SIL Open Font License 1.1); [Rough.js](https://roughjs.com) and [perfect-freehand](https://github.com/steveruizok/perfect-freehand) draw the sketchy shapes and pen strokes.
- [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0), run in the app with [kokoro-js](https://github.com/hexgrad/kokoro) and [Transformers.js](https://huggingface.co/docs/transformers.js), reads English aloud; its pronunciation comes from [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (GPL-3.0), through [phonemizer](https://github.com/xenova/phonemizer.js).
- Inspired by Google's NotebookLM.

## 📄 License

[MIT](LICENSE) © 2026 the better-vault contributors. Third-party code keeps its own license (see [LICENSE](LICENSE)).
