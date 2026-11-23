import { describe, expect, it } from "vitest";
import { studioMakeHref, studioMakeRequest } from "./make-link";

const request = (href: string) => studioMakeRequest(new URL(href, "http://app.test").searchParams);

describe("Studio make links", () => {
  it("opens a tool for one source", () => {
    const href = studioMakeHref("nb 1", "mind-map", "src/1");
    expect(href.startsWith("/notebook/nb 1?")).toBe(true);
    expect(request(href)).toEqual({ toolId: "mind-map", sourceIds: ["src/1"] });
  });

  it("opens a tool with the notebook's selection when no source is given", () => {
    expect(request("/notebook/a?make=quiz")).toEqual({ toolId: "quiz" });
  });

  it("ignores unknown tools and tools without a dialog", () => {
    expect(request("/notebook/a?make=nope&from=s")).toBeNull();
    expect(request("/notebook/a?make=whiteboard&from=s")).toBeNull();
    expect(request("/notebook/a")).toBeNull();
  });
});
