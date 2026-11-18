import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/panelui/dialog";

const imageLabels = {
  question: {
    title: "study.visualCard.questionImage",
    enlarge: "study.visualCard.enlargeQuestion",
    alt: "study.visualCard.questionAttachment",
  },
  answer: {
    title: "study.visualCard.answerImage",
    enlarge: "study.visualCard.enlargeAnswer",
    alt: "study.visualCard.answerAttachment",
  },
  document: {
    title: "study.reader.imageContext",
    enlarge: "study.reader.enlargeImageContext",
    alt: "study.reader.imageContext",
  },
} as const;

export function StudyCardImage({
  side,
  image,
  description,
  onOpenChange,
}: {
  side: keyof typeof imageLabels;
  image: string;
  description?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const labels = imageLabels[side];
  const title = t(labels.title);
  return (
    <Dialog onOpenChange={onOpenChange}>
      <Dialog.Trigger
        render={
          <button
            type="button"
            aria-label={t(labels.enlarge)}
            className="block max-w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <img
          className="max-h-52 max-w-full rounded-lg object-contain"
          src={image}
          alt={description || t(labels.alt)}
        />
      </Dialog.Trigger>
      <Dialog.Content size="lg" closeLabel={common("actions.close")}>
        <Dialog.Header title={title} />
        <Dialog.Body>
          <img
            src={image}
            alt={description || title}
            className="mx-auto max-h-[72dvh] max-w-full object-contain"
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog>
  );
}
