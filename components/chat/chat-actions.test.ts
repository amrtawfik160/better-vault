import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: unknown[][] = [];
const removed: string[][] = [];
const deleted: string[] = [];
let sources: { id: string; selected: boolean }[] = [];
let imageModels: { provider: string; modelId: string }[] = [];

vi.mock("@/lib/db/study", () => ({
  newStudyCard: (content: object) => ({ ...content, id: `card-${saved.flat().length}` }),
  saveStudyDraftCards: async (cards: unknown[]) => void saved.push(cards),
  removeStudyCards: async (ids: string[]) => void removed.push(ids),
  studioCardCitations: (_notebook: string, refs: { n: number }[]) => refs.map(({ n }) => ({ index: n })),
}));
vi.mock("@/lib/db/outputs", () => ({ deleteOutput: async (id: string) => void deleted.push(id) }));
vi.mock("@/lib/db/sources", () => ({
  listSources: async () => sources,
  getChunks: async () => [],
}));
vi.mock("@/lib/db/source-text", () => ({
  selectedTextSource: (source: { selected: boolean }) => source.selected,
}));
vi.mock("@/lib/db/settings", () => ({
  getSettings: async () => ({}),
  availableImageModels: () => imageModels,
  contextCharsFor: () => 48_000,
  modelFor: () => ({ model: { provider: "google", modelId: "gemini" } }),
}));
vi.mock("@/lib/study/client", () => ({ askStudyModel: vi.fn() }));

const { saveChatCards, startChatOutput, undoChatAction, needsConfirmation } = await import(
  "./chat-actions"
);

const createOutput = vi.fn(async () => "output-1");
const context = {
  notebookId: "nb",
  notebookTitle: "The Mom Test",
  vaultId: "default",
  origin: { kind: "notebook-answer" as const, notebookId: "nb", conversationId: "c", messageId: "m" },
  createOutput,
  messages: { noSources: "No sources", noCards: "No cards", noImageModel: "No image model" },
};
const passage = (n: number) => ({
  n,
  chunkId: `chunk-${n}`,
  sourceId: "s1",
  title: "Chapter 1",
  kind: "text" as const,
  snippet: "…",
});

beforeEach(() => {
  saved.length = 0;
  removed.length = 0;
  deleted.length = 0;
  sources = [
    { id: "s1", selected: true },
    { id: "s2", selected: false },
  ];
  imageModels = [];
  createOutput.mockClear();
});

describe("saveChatCards", () => {
  it("saves each new card once, citing the passages it names", async () => {
    const output = await saveChatCards(
      context,
      {
        cards: [
          { front: "What do people lie about?", back: "The future.", sources: [2] },
          { front: "what do people lie about? ", back: "Again." },
          { front: "  ", back: "Empty front." },
        ],
      },
      [passage(1), passage(2)],
    );
    expect(output).toEqual({ added: 1, cardIds: ["card-0"] });
    expect(saved[0]).toEqual([
      expect.objectContaining({
        front: "What do people lie about?",
        notebookId: "nb",
        tags: ["The Mom Test"],
        citations: [{ index: 2 }],
      }),
    ]);
  });

  it("says so when nothing could be saved", async () => {
    expect(await saveChatCards(context, { cards: [] }, [])).toEqual({ error: "No cards" });
    expect(saved).toHaveLength(0);
  });
});

describe("startChatOutput", () => {
  it("starts the tool on the selected sources with the focus asked for", async () => {
    expect(await startChatOutput(context, { tool: "quiz", focus: " chapter 2 " })).toEqual({
      outputId: "output-1",
      tool: "quiz",
    });
    expect(createOutput).toHaveBeenCalledWith(
      "quiz",
      expect.objectContaining({
        common: { language: "auto", focus: "chapter 2", sourceIds: ["s1"] },
      }),
    );
  });

  it("needs a selected source, and an image model for an infographic", async () => {
    sources = [];
    expect(await startChatOutput(context, { tool: "report" })).toEqual({ error: "No sources" });
    sources = [{ id: "s1", selected: true }];
    expect(await startChatOutput(context, { tool: "infographic" })).toEqual({
      error: "No image model",
    });
    imageModels = [{ provider: "google", modelId: "imagen" }];
    await startChatOutput(context, { tool: "infographic" });
    expect(createOutput).toHaveBeenCalledWith(
      "infographic",
      expect.objectContaining({ tool: expect.objectContaining({ imageModel: imageModels[0] }) }),
    );
  });
});

describe("undoChatAction and confirmation", () => {
  it("removes what was made and marks it undone", async () => {
    expect(await undoChatAction({ added: 2, cardIds: ["a", "b"] })).toMatchObject({ undone: true });
    expect(removed).toEqual([["a", "b"]]);
    expect(await undoChatAction({ outputId: "o", tool: "quiz" })).toMatchObject({ undone: true });
    expect(deleted).toEqual(["o"]);
  });

  it("asks first only for slow or paid outputs", () => {
    expect(needsConfirmation("add_cards", { cards: [] })).toBe(false);
    expect(needsConfirmation("make", { tool: "quiz" })).toBe(false);
    expect(needsConfirmation("make", { tool: "audio-overview" })).toBe(true);
    expect(needsConfirmation("make", { tool: "infographic" })).toBe(true);
  });
});
