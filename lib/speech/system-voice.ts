/**
 * Picks the system voice that reads a language best. macOS lists novelty
 * voices ("Albert", "Bad News", "Zarvox") and the robotic Eloquence voices
 * ("Eddy", "Flo") among its English ones, and the first in the list is a
 * novelty voice, so the list order can't be trusted.
 */

const novelty = new Set(
  [
    "albert",
    "bad news",
    "bahh",
    "bells",
    "boing",
    "bubbles",
    "cellos",
    "deranged",
    "good news",
    "hysterical",
    "jester",
    "organ",
    "pipe organ",
    "superstar",
    "trinoids",
    "whisper",
    "wobble",
    "zarvox",
    "princess",
  ],
);
/**
 * Old MacinTalk voices and the Eloquence voices, which sound like a 1990s
 * reading machine: used only when a language has nothing better.
 */
const dated = new Set([
  "fred",
  "junior",
  "kathy",
  "ralph",
  "bruce",
  "agnes",
  "victoria",
  "vicki",
  "eddy",
  "flo",
  "grandma",
  "grandpa",
  "reed",
  "rocko",
  "sandy",
  "shelley",
]);

/** A higher score is a better voice; below zero, never use it. */
export function voiceScore(voice: Pick<SpeechSynthesisVoice, "name" | "localService" | "default">) {
  const name = voice.name.toLowerCase();
  const base = name.replace(/\s*\(.*\)\s*$/, "").trim();
  if (novelty.has(base)) return -1;
  if (dated.has(base)) return 0;
  let score = 1;
  if (/premium/.test(name)) score += 6;
  if (/enhanced|siri|neural|natural/.test(name)) score += 4;
  if (voice.default) score += 1;
  return score;
}

/** The voices list fills in after the page loads; waits for it a moment. */
function voices(synthesis: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = synthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synthesis.removeEventListener("voiceschanged", done);
      window.clearTimeout(timer);
      resolve(synthesis.getVoices());
    };
    const timer = window.setTimeout(done, 1000);
    synthesis.addEventListener("voiceschanged", done);
  });
}

/**
 * The best voice on this device for a language: same region first, then the
 * same language. Only voices that run on the device, so the text stays here.
 */
export async function systemVoice(synthesis: SpeechSynthesis, language: string) {
  const locale = language.toLowerCase().replaceAll("_", "-");
  const base = locale.split("-")[0];
  const candidates = (await voices(synthesis))
    .filter(({ localService }) => localService)
    .map((voice) => {
      const lang = voice.lang.toLowerCase().replaceAll("_", "-");
      const match = lang === locale ? 2 : lang.split("-")[0] === base ? 1 : 0;
      return { voice, match, score: voiceScore(voice) };
    })
    .filter(({ match, score }) => match > 0 && score >= 0)
    .sort((a, b) => b.score - a.score || b.match - a.match);
  return candidates[0]?.voice;
}
