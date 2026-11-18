import { z } from "zod";
import { sourceKinds } from "@/lib/db/types";

/** A passage an output may cite as [n], saved with the output. */
export const passageRefSchema = z.object({
  n: z.number(),
  chunkId: z.string(),
  sourceId: z.string(),
  title: z.string(),
  kind: z.enum(sourceKinds),
  snippet: z.string(),
});

export const passageSchema = passageRefSchema.omit({ snippet: true }).extend({
  n: z.number().int().positive(),
  text: z.string(),
});
