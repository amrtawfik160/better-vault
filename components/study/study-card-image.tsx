import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/panelui/dialog";

export function StudyCardImage({
  side,
  image,
  onOpenChange,
}: {
  side: "question" | "answer";
  image: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const question = side === "question";
  const title = t(question ? "study.visualCard.questionImage" : "study.visualCard.answerImage");
  return (
    <Dialog onOpenChange={onOpenChange}>
      <Dialog.Trigger
        render={
          <button
            type="button"
            aria-label={t(
              question ? "study.visualCard.enlargeQuestion" : "study.visualCard.enlargeAnswer",
            )}
            className="block max-w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <img
          className="max-h-52 max-w-full rounded-lg object-contain"
          src={image}
          alt={t(
            question ? "study.visualCard.questionAttachment" : "study.visualCard.answerAttachment",
          )}
        />
      </Dialog.Trigger>
      <Dialog.Content size="lg" closeLabel={common("actions.close")}>
        <Dialog.Header title={title} />
        <Dialog.Body>
          <img
            src={image}
            alt={title}
            className="mx-auto max-h-[72dvh] max-w-full object-contain"
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog>
  );
}
