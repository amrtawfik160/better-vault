import { routes } from "@/lib/routes";
import { toolDefinitions } from "./definitions";
import { studioToolIds, type StudioToolId } from "./tools";

/**
 * A link that opens a notebook with one Studio tool's dialog, starting with
 * the given source chosen. Study uses it to make a mind map, flashcards or a
 * quiz from one book. Only tools with a dialog qualify (not local tools).
 */
export function studioMakeHref(notebookId: string, toolId: StudioToolId, sourceId: string) {
  const params = new URLSearchParams({ make: toolId, from: sourceId });
  return `${routes.notebook(notebookId)}?${params}`;
}

/** The tool and sources a notebook link asks to make, or null when it asks for none or an unknown one. */
export function studioMakeRequest(params: URLSearchParams): { toolId: StudioToolId; sourceIds?: string[] } | null {
  const toolId = studioToolIds.find((id) => id === params.get("make"));
  const definition = toolId && toolDefinitions[toolId];
  if (!toolId || !definition || definition.local) return null;
  const from = params.get("from")?.trim();
  return from ? { toolId, sourceIds: [from] } : { toolId };
}
