import { z } from "zod";
import { describeError } from "@/lib/ai/errors";
import { htmlToText, pdfToText } from "@/lib/sources/extract";
import { fetchPublic } from "@/lib/sources/network";
import { transcriptDocument, transcriptText } from "@/lib/sources/transcript";
import { fetchYouTubeVideo, youtubeVideoId, youtubeWatchUrl } from "@/lib/sources/youtube";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const urlBody = z.object({ url: z.url() });

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "") || name;

/**
 * A YouTube video: its captions as a timed transcript. Without captions the
 * answer is `{ code: "noCaptions" }` with the video's title and length, so the
 * page can offer to transcribe it with Gemini.
 */
async function youtube(id: string) {
  const video = await fetchYouTubeVideo(id);
  const url = youtubeWatchUrl(id);
  const about = { id, title: video.title, author: video.author, seconds: video.seconds, url };
  if (!video.captions) {
    return Response.json(
      { error: "This video has no captions.", code: "noCaptions", video: about },
      { status: 422 },
    );
  }
  return Response.json({
    title: video.title,
    text: transcriptDocument(transcriptText(video.captions.cues), url),
    kind: "text",
    url,
    video: { ...about, language: video.captions.language, auto: video.captions.auto },
  });
}

/**
 * Turns a PDF upload (multipart, field "file") or a web address (JSON
 * `{ url }`) into plain text; a YouTube address gives the video's captions.
 * Nothing is stored on the server.
 */
export async function POST(request: Request) {
  try {
    const type = request.headers.get("content-type") ?? "";

    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return Response.json({ error: "No file was sent." }, { status: 400 });
      if (file.size > MAX_FILE_BYTES)
        return Response.json({ error: "The file is larger than 20 MB." }, { status: 413 });
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf)
        return Response.json({ error: "Only PDF files are read on the server." }, { status: 415 });
      const text = await pdfToText(new Uint8Array(await file.arrayBuffer()));
      return Response.json({ title: titleFromFile(file.name), text, kind: "pdf" });
    }

    const parsed = urlBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter a valid address." }, { status: 400 });
    const videoId = youtubeVideoId(parsed.data.url);
    if (videoId) return await youtube(videoId);
    const page = await fetchPublic(parsed.data.url);
    const fallbackTitle = page.url.hostname + page.url.pathname.replace(/\/$/, "");

    if (page.contentType.includes("application/pdf")) {
      const text = await pdfToText(page.body);
      return Response.json({ title: fallbackTitle, text, kind: "pdf", url: page.url.toString() });
    }
    const raw = new TextDecoder().decode(page.body);
    if (page.contentType.includes("text/html") || /^\s*<(!doctype|html)/i.test(raw)) {
      const { title, text } = htmlToText(raw, fallbackTitle);
      return Response.json({ title, text, kind: "url", url: page.url.toString() });
    }
    if (page.contentType.startsWith("text/")) {
      return Response.json({
        title: fallbackTitle,
        text: raw,
        kind: "url",
        url: page.url.toString(),
      });
    }
    return Response.json({ error: "That page is not text, HTML or PDF." }, { status: 415 });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 422 });
  }
}
