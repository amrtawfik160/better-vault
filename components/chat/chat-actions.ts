import {
  ADD_CARDS,
  confirmedMakeTools,
  type AddCardsInput,
  type AddCardsOutput,
  type ChatActionName,
  type ChatActionOutput,
  type MakeInput,
  type MakeOutput,
} from "@/lib/chat/actions";
import type { ModelRef } from "@/lib/ai/catalog";
import type { PassageRef } from "@/lib/chat/types";
import { deleteOutput } from "@/lib/db/outputs";
import {
  availableImageModels,
  type AppSettings,
  contextCharsFor,
  getSettings,
  modelFor,
} from "@/lib/db/settings";
import { getChunks, listSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import {
  newStudyCard,
  removeStudyCards,
  saveStudyDraftCards,
  studioCardCitations,
} from "@/lib/db/study";
import type { StudyOrigin } from "@/lib/study/records";
import { selectPassages, toPassageRefs } from "@/lib/grounding/passages";
import { askStudyModel } from "@/lib/study/client";
import { toolDefinitions } from "@/studio/definitions";
import type { StudioToolId } from "@/studio/tools";
import type { SavedOptions } from "@/studio/types";

/**
 * Runs the chat's actions on the user's device: saves cards to the notebook's
 * deck, or starts a Studio output, and undoes them. Used both for the model's
 * tool calls and for the prompt's "/" commands.
 */

export interface ActionContext {
  notebookId: string;
  notebookTitle: string;
  vaultId: string;
  /** Where the cards came from: the answer that made them. */
  origin: Extract<StudyOrigin, { kind: "notebook-answer" }>;
  /** Starts a Studio output (the notebook's Studio runner) and returns its id. */
  createOutput: (toolId: StudioToolId, options: SavedOptions) => Promise<string>;
  /** Shown when nothing is selected to make it from. */
  messages: { noSources: string; noCards: string; noImageModel: string };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function selectedSourceIds(notebookId: string) {
  return (await listSources(notebookId)).filter(selectedTextSource).map(({ id }) => id);
}

/** Saves cards the model wrote, with citations to the passages they name. */
export async function saveChatCards(
  context: ActionContext,
  input: AddCardsInput,
  passages: readonly PassageRef[],
): Promise<AddCardsOutput> {
  const seen = new Set<string>();
  const cards = input.cards.flatMap(({ front, back, sources }) => {
    const key = front.trim().toLocaleLowerCase();
    if (!front.trim() || !back.trim() || seen.has(key)) return [];
    seen.add(key);
    const cited = passages.filter((passage) => sources?.includes(passage.n));
    return [
      newStudyCard({
        front: front.trim(),
        back: back.trim(),
        notebookId: context.notebookId,
        vaultId: context.vaultId,
        origin: context.origin,
        citations: studioCardCitations(context.notebookId, cited),
        tags: [context.notebookTitle],
      }),
    ];
  });
  if (cards.length === 0) return { error: context.messages.noCards };
  await saveStudyDraftCards(cards);
  return { added: cards.length, cardIds: cards.map(({ id }) => id) };
}

/**
 * "/cards": the study model writes the cards from the selected sources, then
 * they are saved like the model's own. Returns the cards too, so the thread
 * keeps what was made.
 */
export async function generateChatCards(
  context: ActionContext,
  focus: string,
  signal?: AbortSignal,
): Promise<{ input: AddCardsInput; passages: PassageRef[]; output: AddCardsOutput }> {
  const settings = await getSettings();
  const model = modelFor(settings, "cards")?.model;
  const sources = (await listSources(context.notebookId)).filter(selectedTextSource);
  if (sources.length === 0)
    return { input: { cards: [] }, passages: [], output: { error: context.messages.noSources } };
  const chunks = await getChunks(sources.map(({ id }) => id));
  const passages = selectPassages({
    sources,
    chunks,
    budget: Math.min(48_000, model ? contextCharsFor(settings, model.provider) : 48_000),
    query: focus,
  }).slice(0, 8);
  const refs = toPassageRefs(passages);
  try {
    const answer = await askStudyModel({
      use: "cards",
      action: "cards",
      input: focus || "Make flashcards that cover the key ideas of this material.",
      passages: passages.map(({ title, text }) => ({ title, text })),
      cardCount: 10,
      signal,
    });
    const input: AddCardsInput = {
      cards: (answer.cards ?? []).map(({ front, back, citations }) => ({
        front,
        back,
        sources: citations
          ?.map((at) => passages[at - 1]?.n)
          .filter((n): n is number => n !== undefined)
          .slice(0, 3),
      })),
    };
    return { input, passages: refs, output: await saveChatCards(context, input, refs) };
  } catch (error) {
    return { input: { cards: [] }, passages: refs, output: { error: message(error) } };
  }
}

/** As in the infographic's dialog: the Studio model's provider first, so one key is enough. */
export function pickImageModel(settings: AppSettings): ModelRef | undefined {
  const models = availableImageModels(settings);
  const studio = modelFor(settings, "studio")?.model;
  return models.find((model) => model.provider === studio?.provider) ?? models[0];
}

/** Starts a Studio output from the notebook's selected sources, with the tool's defaults. */
export async function startChatOutput(
  context: ActionContext,
  input: MakeInput,
): Promise<MakeOutput> {
  try {
    const sourceIds = await selectedSourceIds(context.notebookId);
    if (sourceIds.length === 0) return { error: context.messages.noSources };
    const definition = toolDefinitions[input.tool];
    if (!definition) return { error: `Unknown tool: ${input.tool}` };
    let options = definition.defaults as Record<string, unknown>;
    if (input.tool === "infographic") {
      const imageModel = pickImageModel(await getSettings());
      if (!imageModel) return { error: context.messages.noImageModel };
      options = { ...options, imageModel };
    }
    const outputId = await context.createOutput(input.tool, {
      common: { language: "auto", focus: input.focus?.trim() ?? "", sourceIds },
      tool: options,
    });
    return { outputId, tool: input.tool };
  } catch (error) {
    return { error: message(error) };
  }
}

/** Whether a call waits for the user's OK before it runs. */
export function needsConfirmation(name: ChatActionName, input: unknown): boolean {
  if (name === ADD_CARDS) return false;
  const tool = (input as Partial<MakeInput> | undefined)?.tool;
  return tool !== undefined && confirmedMakeTools.has(tool);
}

/** Removes what an action made. Returns the output marked as undone. */
export async function undoChatAction(output: ChatActionOutput): Promise<ChatActionOutput> {
  if ("cardIds" in output) await removeStudyCards(output.cardIds);
  else if ("outputId" in output) await deleteOutput(output.outputId);
  else return output;
  return { ...output, undone: true };
}
