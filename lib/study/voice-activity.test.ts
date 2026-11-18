import { expect, it } from "vitest";
import { studyVoiceActivity } from "./voice-activity";

function meter() {
  const next = studyVoiceActivity();
  let time = 0;
  return (level: number, frames: number, muted = false) =>
    Array.from({ length: frames }, () => next(level, (time += 40), muted)).filter(Boolean);
}

it("sends a spoken turn after a pause and tolerates shorter gaps between words", () => {
  const samples = meter();
  expect(samples(0.005, 20)).toEqual([]);
  expect(samples(0.08, 5)).toEqual(["speech"]);
  expect(samples(0, 18)).toEqual([]);
  expect(samples(0.045, 4)).toEqual([]);
  expect(samples(0, 29)).toEqual([]);
  expect(samples(0, 1)).toEqual(["pause"]);
});

it("ignores clicks and ambient noise before speech", () => {
  const samples = meter();
  expect(samples(0.009, 30)).toEqual([]);
  expect(samples(0.6, 1)).toEqual([]);
  expect(samples(0.009, 30)).toEqual([]);
  expect(samples(0, 200)).toEqual([]);
});

it("does not accumulate speech or a pause while the microphone is muted", () => {
  const samples = meter();
  expect(samples(0.2, 80, true)).toEqual([]);
  expect(samples(0.08, 5)).toEqual(["speech"]);
  expect(samples(0, 80, true)).toEqual([]);
  expect(samples(0, 29)).toEqual([]);
  expect(samples(0, 1)).toEqual(["pause"]);
});
