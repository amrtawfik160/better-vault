import { describe, expect, it } from "vitest";
import { cueText, cueTime, parseSubtitles } from "./subtitles";
import { transcriptText } from "./transcript";

describe("cueTime", () => {
  it("reads SRT and VTT times, with or without hours", () => {
    expect(cueTime("01:02:03,450")).toBeCloseTo(3723.45);
    expect(cueTime("00:00:01.5")).toBeCloseTo(1.5);
    expect(cueTime("02:03.000")).toBe(123);
  });
});

describe("cueText", () => {
  it("removes HTML, VTT voice and timing tags, SSA codes and entities", () => {
    expect(cueText("<v Roger>Hi <i>there</i>&nbsp;&amp; welcome</v>")).toBe("Hi there & welcome");
    expect(cueText("so<00:00:01.200><c> we</c><00:00:01.400><c> start</c>")).toBe("so we start");
    expect(cueText("{\\an8}Top line &#39;quoted&#39;")).toBe("Top line 'quoted'");
  });
});

describe("parseSubtitles", () => {
  it("reads SRT cues with their timing and joins multi-line cues", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:03,500",
      "Hello and welcome",
      "to the course.",
      "",
      "2",
      "00:00:04,000 --> 00:00:06,000",
      "<b>Today</b> we look at cells.",
      "",
    ].join("\r\n");
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 3.5, text: "Hello and welcome to the course." },
      { start: 4, end: 6, text: "Today we look at cells." },
    ]);
  });

  it("skips the WebVTT header, notes and styles and reads cue settings", () => {
    const vtt = [
      "﻿WEBVTT",
      "Kind: captions",
      "",
      "NOTE written by hand --> not a cue",
      "",
      "STYLE",
      "::cue { color: white }",
      "",
      "intro",
      "00:01.000 --> 00:02.000 align:start position:0%",
      "First words",
    ].join("\n");
    expect(parseSubtitles(vtt)).toEqual([{ start: 1, end: 2, text: "First words" }]);
  });

  it("keeps the lines of rolling captions once", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "so<00:00:00.500><c> today</c>",
      "",
      "00:00:02.000 --> 00:00:02.010",
      "so today",
      "",
      "00:00:02.010 --> 00:00:04.000",
      "so today",
      "we<00:00:02.500><c> talk</c><00:00:03.000><c> about</c>",
      "",
      "00:00:04.000 --> 00:00:04.010",
      "we talk about",
      "",
      "00:00:04.010 --> 00:00:06.000",
      "we talk about",
      "photosynthesis",
    ].join("\n");
    expect(parseSubtitles(vtt).map(({ text }) => text)).toEqual([
      "so today",
      "we talk about",
      "photosynthesis",
    ]);
  });

  it("keeps only the new words of a line that grows", () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "Energy",
      "",
      "2",
      "00:00:01,000 --> 00:00:02,000",
      "Energy is",
      "",
      "3",
      "00:00:02,000 --> 00:00:03,000",
      "Energy is conserved.",
    ].join("\n");
    expect(transcriptText(parseSubtitles(srt))).toBe("[00:00] Energy is conserved.");
  });
});
