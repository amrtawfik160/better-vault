/** A passage the user selected to ask about: from a book's section, or from an answer. */
export type ChatQuote = { text: string; section?: number };

/** How a selected passage is put before the question it was asked with, for the model. */
export function quotedForModel(quote: ChatQuote) {
  const from = quote.section === undefined ? "The text I selected" : `The passage I selected (section ${quote.section})`;
  return `${from}:\n"""\n${quote.text}\n"""`;
}
