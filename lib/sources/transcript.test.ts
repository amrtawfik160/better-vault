import { describe, expect, it } from "vitest";
import {
  cleanPastedTranscript,
  formatTimestamp,
  joinPieces,
  parseTimestamp,
  timedParagraphs,
  transcriptDocument,
  type TimedText,
} from "./transcript";

describe("timestamps", () => {
  it("formats minutes and hours", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(75.9)).toBe("01:15");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("parses times and rejects other text", () => {
    expect(parseTimestamp("0:07")).toBe(7);
    expect(parseTimestamp("12:34")).toBe(754);
    expect(parseTimestamp("1:02:05")).toBe(3725);
    expect(parseTimestamp("12:75")).toBeUndefined();
    expect(parseTimestamp("at 12:34")).toBeUndefined();
  });
});

describe("joinPieces", () => {
  it("joins phrases with spaces and keeps word-level spacing", () => {
    expect(joinPieces(["Hello there", "friend."])).toBe("Hello there friend.");
    expect(joinPieces(["Hello", " ", "there", ",", " ", "friend"])).toBe("Hello there, friend");
  });
});

describe("timedParagraphs", () => {
  const every = (seconds: number, count: number, text = (i: number) => `Part ${i}`) =>
    Array.from({ length: count }, (_, i): TimedText => ({
      start: i * seconds,
      end: (i + 1) * seconds,
      text: text(i),
    }));

  it("ends a paragraph at the first sentence end after a minute", () => {
    const cues = every(10, 12, (i) => (i === 6 ? "end of thought." : `words ${i}`));
    const paragraphs = timedParagraphs(cues);
    expect(paragraphs.map(({ start }) => start)).toEqual([0, 70]);
    expect(paragraphs[0].text.endsWith("end of thought.")).toBe(true);
  });

  it("never lets a paragraph run past a minute and a half", () => {
    const paragraphs = timedParagraphs(every(10, 30, (i) => `no punctuation ${i}`));
    expect(paragraphs.map(({ start }) => start)).toEqual([0, 90, 180, 270]);
  });

  it("breaks at a long silence", () => {
    const cues: TimedText[] = [
      { start: 0, end: 25, text: "First topic." },
      { start: 40, end: 50, text: "Second topic." },
    ];
    expect(timedParagraphs(cues).map(({ start }) => start)).toEqual([0, 40]);
  });
});

describe("cleanPastedTranscript", () => {
  it("turns YouTube's transcript panel into paragraphs with markers", () => {
    const pasted = [
      "0:00",
      "hi everyone, welcome back",
      "0:03",
      "3 seconds",
      "today we're looking at",
      "the heart",
      "1:05",
      "1 minute, 5 seconds",
      "it has four chambers.",
      "1:12",
      "the left ventricle",
    ].join("\n");
    expect(cleanPastedTranscript(pasted)).toBe(
      [
        "[00:00] hi everyone, welcome back today we're looking at the heart it has four chambers.",
        "[01:12] the left ventricle",
      ].join("\n\n"),
    );
  });

  it("reads times at the start of lines too", () => {
    const pasted = "0:00 one\n0:30 two.\n1:01 three\n1:40 four";
    expect(cleanPastedTranscript(pasted)).toBe("[00:00] one two.\n\n[01:01] three four");
  });

  it("leaves ordinary text alone", () => {
    const text = "  Notes from the lecture.\nMeet at 10:30 tomorrow.\n";
    expect(cleanPastedTranscript(text)).toBe("Notes from the lecture.\nMeet at 10:30 tomorrow.");
  });
});

describe("transcriptDocument", () => {
  it("puts the link first", () => {
    expect(transcriptDocument("[00:00] Hi", " https://example.com/v ")).toBe(
      "Source: https://example.com/v\n\n[00:00] Hi",
    );
    expect(transcriptDocument(" text ")).toBe("text");
  });
});
