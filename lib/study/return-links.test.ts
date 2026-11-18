import { describe, expect, it } from "vitest";
import { returnToTutor, studyReturnState, tutorReturnState } from "./return-links";

describe("Tutor return links", () => {
  const review = {
    studyReturn: {
      path: "/?view=study&tab=review",
      state: { studyReviewSession: "session", studyReviewIds: ["card"] },
    },
  };

  it("keeps the Review shortcut and returns to the cited turn", () => {
    const path = "/?view=study&tab=tutor&thread=t1&report=1&reportId=r1";
    const expected = { ...review, studyTutorReturn: "/?view=study&tab=tutor&thread=t1&message=0" };
    expect(returnToTutor(path, review, { message: 0 })).toEqual(expected);
    expect(studyReturnState({ ...expected, studySourceSnippet: "already consumed" })).toEqual(
      expected,
    );
  });

  it("reopens a report suggestion in the original reader pane", () => {
    const path = "/?view=study&tab=library&book=b1&page=4&readerTutor=t1&readerView=book&message=2";
    expect(returnToTutor(path, undefined, { report: { id: "r2", suggestion: "word:0" } })).toEqual({
      studyTutorReturn:
        "/?view=study&tab=library&book=b1&page=4&readerTutor=t1&report=1&reportId=r2&suggestion=word%3A0",
    });
  });

  it.each([
    "https://example.test/?view=study&tab=tutor&thread=t1",
    "//example.test/?view=study&tab=tutor&thread=t1",
    "/?view=study&tab=tutor",
    "/?view=study&tab=library&readerTutor=t1",
    "/notebook/n1?view=study&tab=tutor&thread=t1",
  ])("ignores a return that cannot open a Tutor conversation at %s", (studyTutorReturn) => {
    expect(tutorReturnState({ studyTutorReturn })).toBeUndefined();
    expect(studyReturnState({ ...review, studyTutorReturn })).toEqual(review);
  });
});
