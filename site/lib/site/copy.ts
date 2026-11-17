import { Notebook01Icon, PencilEdit02Icon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { IsoFigureKind } from "@/components/site/iso-figures";

/*
 * The landing page's words. The website is English only, so they live here.
 * The FAQ also feeds the page's FAQPage JSON-LD and llms-full.txt, so the
 * answers an assistant reads are the ones a visitor reads.
 */

/** A feature card: an isometric figure, a short title and one line. */
export interface Feature {
  figure: IsoFigureKind;
  title: string;
  body: string;
}

export const features: Feature[] = [
  { figure: "citations", title: "Cited answers", body: "Every claim points to its passage." },
  { figure: "web", title: "Web mode", body: "Your provider's own search, when you want it." },
  { figure: "studio", title: "Nine Studio tools", body: "From reports to slide decks." },
  { figure: "providers", title: "Your key, your model", body: "OpenAI, Claude, Gemini or local." },
  { figure: "vault", title: "Local-first", body: "Notebooks stay on your device." },
  { figure: "exports", title: "Real exports", body: "Word, PowerPoint, Anki, Excel, SVG." },
];

/** `true` and `false` draw a mark; a string is shown as written. */
export type Cell = boolean | string;

export const comparison: { label: string; vault: Cell; notebooklm: Cell }[] = [
  { label: "Open source", vault: "MIT", notebooklm: false },
  {
    label: "Choose your AI model",
    vault: "OpenAI, Claude, Gemini, local",
    notebooklm: "Gemini only",
  },
  { label: "Local, offline models", vault: true, notebooklm: false },
  { label: "No account needed", vault: true, notebooklm: false },
  { label: "Data stays on your device", vault: true, notebooklm: false },
  { label: "Self-host it", vault: true, notebooklm: false },
  { label: "Cited answers", vault: true, notebooklm: true },
  { label: "Reports, flashcards, quizzes, mind maps", vault: true, notebooklm: true },
  { label: "Slide decks and infographics", vault: true, notebooklm: true },
  { label: "Anatomy figures and whiteboard", vault: true, notebooklm: false },
  { label: "Audio and video overviews", vault: false, notebooklm: true },
];

export const roadmapTeaser: { icon: IconSvgElement; title: string; body: string }[] = [
  {
    icon: Notebook01Icon,
    title: "Notes and a notebook guide",
    body: "Save answers as notes, get a summary and suggested questions, and set the chat's goal and style.",
  },
  {
    icon: SourceCodeIcon,
    title: "More sources and deep research",
    body: "DOCX, EPUB, YouTube, images and audio, plus web research that adds sources for you.",
  },
  {
    icon: PencilEdit02Icon,
    title: "Edit outputs with a prompt",
    body: "Change one slide, one section of a report or one branch of a mind map, and review a deck's outline first.",
  },
];

/** The landing page's notes section. */
export const notesFeatures: { title: string; body: string }[] = [
  {
    title: "Links that go both ways",
    body: "Type [[ to link a note, a notebook or a source. Every note shows what links to it, and renaming a note updates every link.",
  },
  {
    title: "A graph across your vaults",
    body: "See every note and link at once, with each vault in its own colour, or only what is near the note you're on.",
  },
  {
    title: "Canvas and shortcuts",
    body: "Lay ideas out as cards joined by arrows, saved as an open .canvas file. ⌘O, ⌘E, ⌘G and the other shortcuts keep your hands on the keyboard.",
  },
  {
    title: "Skills your agents share",
    body: "Keep SKILL.md instructions in a vault, use them in chat, and let Claude Code, Cursor or Codex read and edit them through MCP.",
  },
];

export const faq: { question: string; answer: string }[] = [
  {
    question: "What is deepLe?",
    answer:
      "deepLe is a free, open-source alternative to Google NotebookLM. You add PDFs, web pages, notes and text files to a notebook, chat with them with cited answers, and turn them into reports, flashcards, quizzes, mind maps, slide decks and infographics, using the AI model you choose.",
  },
  {
    question: "Is deepLe free?",
    answer:
      "Yes. It is MIT-licensed and free to use and host. You pay your AI provider for what you use with your own API key, or nothing at all with a local model through Ollama or LM Studio.",
  },
  {
    question: "Can I use it with Claude, ChatGPT or Gemini models?",
    answer:
      "Yes. Connect an AI subscription such as ChatGPT or Claude, use an API key for OpenAI, Anthropic or Gemini, or choose a local model. You can switch models for each question.",
  },
  {
    question: "Does it work with local models?",
    answer:
      "Yes. Run deepLe on your computer and connect Ollama or LM Studio. Your sources then never leave your machine.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "On your device: in your browser's IndexedDB on the web, or in a SQLite file on your computer in the desktop app. There is no account and no server database. Requests are forwarded to the provider you pick, and keys and content are never stored or logged.",
  },
  {
    question: "Can I self-host it?",
    answer:
      "Yes. Build the app with bun run build and serve it with bun run start. Each browser keeps its own notebooks and study data.",
  },
  {
    question: "Does it make audio overviews like NotebookLM?",
    answer:
      "Studio can generate Audio Overviews with a supported speech provider. It also creates reports, flashcards, quizzes, slides and visual outputs.",
  },
  {
    question: "Is there a desktop app?",
    answer:
      "Yes. deepLe runs as a desktop app on macOS, Windows and Linux, with the same interface as the web app. It keeps notebooks in a file on your computer on the same device.",
  },
];
