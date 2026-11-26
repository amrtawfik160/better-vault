import { tool, type ToolSet } from "ai";
import { ADD_CARDS, chatActionDescriptions, chatActionSchemas, MAKE } from "@/lib/chat/actions";

/**
 * The chat's actions, declared without `execute`: the user's data lives on
 * their device, so the page makes the cards or the Studio output and adds the
 * result to the thread (`components/chat/chat-actions.ts`).
 */
export function createChatActionTools(): ToolSet {
  return {
    [ADD_CARDS]: tool({
      description: chatActionDescriptions[ADD_CARDS],
      inputSchema: chatActionSchemas[ADD_CARDS],
    }),
    [MAKE]: tool({
      description: chatActionDescriptions[MAKE],
      inputSchema: chatActionSchemas[MAKE],
    }),
  };
}
