import { Hono } from "hono";
import { setDesktopRuntime, setLoopbackRuntime } from "@/lib/ai/server-config";
import { POST as bot } from "./routes/bot";
import { POST as calendarFetch } from "./routes/calendar-fetch";
import { POST as chat } from "./routes/chat";
import { POST as chatgpt } from "./routes/chatgpt";
import { POST as cliproxyapi } from "./routes/cliproxyapi";
import { POST as models } from "./routes/models";
import { POST as opencode } from "./routes/opencode";
import { POST as sourcesParse } from "./routes/sources-parse";
import { POST as sourcesTranscribe } from "./routes/sources-transcribe";
import { POST as study } from "./routes/study";
import { POST as studyPractice } from "./routes/study-practice";
import { recognize as studyOcr, status as studyOcrStatus } from "./routes/study-ocr";
import { status as studyVoiceStatus, transcribe as studyVoice } from "./routes/study-voice";
import { POST as studio } from "./routes/studio";
import { POST as studioSuggest } from "./routes/studio-suggest";
import { POST as storageOAuth } from "./routes/storage-oauth";
import { POST as storageS3 } from "./routes/storage-s3";
import { POST as voices } from "./routes/voices";

/**
 * The app's API: stateless routes that take the user's keys in each request
 * and talk to the providers. The web server (`server/node.ts`), the Vite dev
 * server (`vite.config.ts`) and the desktop app's main process all serve it;
 * the desktop app passes `desktop: true`, which allows Sign in with ChatGPT.
 */
export function createApi({
  desktop = false,
  loopback = false,
  openSignIn,
}: {
  desktop?: boolean;
  loopback?: boolean;
  openSignIn?: (url: string) => Promise<void>;
} = {}) {
  setDesktopRuntime(desktop);
  setLoopbackRuntime(loopback);
  const api = new Hono().basePath("/api");
  api.post("/bot", (c) => bot(c.req.raw));
  api.post("/calendar/fetch", (c) => calendarFetch(c.req.raw));
  api.post("/chat", (c) => chat(c.req.raw));
  api.post("/chatgpt", (c) => chatgpt(c.req.raw));
  api.post("/cliproxyapi/oauth", (c) => cliproxyapi(c.req.raw, desktop ? openSignIn : undefined));
  api.post("/models", (c) => models(c.req.raw));
  api.post("/opencode/detect", () => opencode());
  api.post("/sources/parse", (c) => sourcesParse(c.req.raw));
  api.post("/sources/transcribe", (c) => sourcesTranscribe(c.req.raw));
  api.post("/study", (c) => study(c.req.raw));
  api.post("/study/practice", (c) => studyPractice(c.req.raw));
  api.get("/study/ocr", (c) => studyOcrStatus(c.req.raw));
  api.post("/study/ocr", (c) => studyOcr(c.req.raw));
  api.get("/study/voice", (c) => studyVoiceStatus(c.req.raw));
  api.post("/study/voice", (c) => studyVoice(c.req.raw));
  api.post("/studio", (c) => studio(c.req.raw));
  api.post("/studio/suggest", (c) => studioSuggest(c.req.raw));
  api.post("/voices", (c) => voices(c.req.raw));
  api.post("/storage/s3", (c) => storageS3(c.req.raw));
  api.post("/storage/oauth", (c) => storageOAuth(c.req.raw));
  api.notFound((c) => c.json({ error: "Not found." }, 404));
  return api;
}
