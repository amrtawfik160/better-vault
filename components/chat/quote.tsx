import { Cancel01Icon, QuoteDownIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import type { ChatQuote } from "@/lib/chat/quote";

const chip =
  "flex max-w-full items-start gap-2 self-end rounded-xl border px-3 py-2 text-start text-xs text-muted-foreground";

/**
 * The passage a question was asked about, above the question. One from a
 * book's section opens there; `place` names it ("Chapter 7").
 */
export function QuoteChip({
  quote,
  place,
  open,
}: {
  quote: ChatQuote;
  place?: string;
  open?: (section: number) => void;
}) {
  const body = (
    <>
      <Icon icon={QuoteDownIcon} size={14} className="mt-0.5 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <DirectionalText as="span" text={quote.text} className="line-clamp-3" />
        {place ? <span className="tabular-nums">{place}</span> : null}
      </span>
    </>
  );
  const { section } = quote;
  if (section === undefined || !open) return <div className={chip}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => open(section)}
      className={`${chip} cursor-pointer outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {body}
    </button>
  );
}

/** The passage the next question will be about, in the prompt, with a way to drop it. */
export function PromptQuote({ quote, clear }: { quote: ChatQuote; clear: () => void }) {
  const { t } = useTranslation("chat");
  return (
    <div className="flex items-start gap-2 px-3 pt-3">
      <Icon icon={QuoteDownIcon} size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      <DirectionalText
        text={quote.text}
        className="line-clamp-3 min-w-0 flex-1 text-xs text-muted-foreground"
      />
      <button
        type="button"
        aria-label={t("reader.removeQuote")}
        onClick={clear}
        className="shrink-0 cursor-pointer rounded-full p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon icon={Cancel01Icon} size={12} />
      </button>
    </div>
  );
}
