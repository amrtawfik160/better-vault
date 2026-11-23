/** Languages offered for "Translate into", as BCP 47 codes. */
export const translationLanguages = [
  "ar", "bn", "de", "en", "es", "fa", "fr", "he", "hi", "id", "it", "ja", "ko", "ms",
  "nl", "pl", "pt", "ru", "sv", "sw", "th", "tr", "uk", "ur", "vi", "zh",
] as const;

function baseLanguage(code: string) {
  return code.trim().replaceAll("_", "-").split("-")[0]?.toLowerCase() ?? "";
}

/**
 * The language to translate into before the reader picks one: the browser's
 * language, unless it is English, since then the reader is likely reading in
 * it and a choice has to be asked for.
 */
export function defaultTranslationLanguage(browserLanguage: string | undefined) {
  const code = baseLanguage(browserLanguage ?? "");
  return code && code !== "en" ? code : undefined;
}

/** A language's name, in `locale`, falling back to the code itself. */
export function translationLanguageName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The name the model is asked to translate into, and the one saved with a word. */
export function translationLanguageLabel(code: string) {
  return translationLanguageName(code, "en");
}

/** A guess at the language of the passage, for the voice that reads it aloud. */
export function speechLanguage(text: string) {
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  if (/\p{Script=Hebrew}/u.test(text)) return "he";
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru";
  if (/\p{Script=Greek}/u.test(text)) return "el";
  if (/\p{Script=Devanagari}/u.test(text)) return "hi";
  if (/\p{Script=Thai}/u.test(text)) return "th";
  return "en";
}
