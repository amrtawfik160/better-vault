import { describe, expect, it } from "vitest";
import { studyRecordSchema } from "./records";

const thread = {
  id: "thread",
  kind: "thread",
  title: "Raft",
  goal: "book",
  scope: "general",
  updatedAt: 1,
};
const diagram = {
  kind: "diagram",
  data: { title: "Elections", mermaid: "flowchart TD\n  A --> B" },
};

describe("Tutor thread messages", () => {
  it("keeps reading threads saved before messages had visuals", () => {
    const saved = { ...thread, messages: [{ role: "assistant", text: "A quorum votes.", at: 1 }] };
    expect(studyRecordSchema.parse(saved)).toEqual(saved);
  });

  it("keeps a visual that matches its kind's schema", () => {
    const saved = {
      ...thread,
      messages: [{ role: "assistant", text: "Here is a diagram.", visual: diagram }],
    };
    expect(studyRecordSchema.parse(saved)).toEqual(saved);
  });

  it("rejects a visual whose data does not fit its kind", () => {
    const saved = {
      ...thread,
      messages: [
        { role: "assistant", text: "Steps", visual: { kind: "steps", data: diagram.data } },
      ],
    };
    expect(studyRecordSchema.safeParse(saved).success).toBe(false);
  });
});
