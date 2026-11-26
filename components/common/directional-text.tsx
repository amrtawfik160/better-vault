import { Fragment, type HTMLAttributes } from "react";
import {
  leftToRightRuns,
  textDirection,
  textLines,
  type TextDirection,
} from "@/lib/text/direction";

export function directionalInline(text: string, dir: TextDirection) {
  if (dir !== "rtl") return text;
  return leftToRightRuns(text).map((run, index) =>
    run.ltr ? (
      <bdi key={index} dir="ltr">
        {run.text}
      </bdi>
    ) : (
      <Fragment key={index}>{run.text}</Fragment>
    ),
  );
}

type DirectionalTextProps = Omit<HTMLAttributes<HTMLElement>, "children" | "dir"> & {
  as?: "p" | "span" | "blockquote";
  text: string;
  multiline?: boolean;
};

export function DirectionalText({
  as: Tag = "p",
  text,
  multiline = false,
  ...props
}: DirectionalTextProps) {
  const dir = textDirection(text);
  return (
    <Tag dir={dir} {...props}>
      {multiline && text.includes("\n")
        ? textLines(text).map((line, index) => {
            const lineDir = textDirection(line);
            return (
              <span key={index} dir={lineDir} className="block whitespace-pre-wrap">
                {directionalInline(line, lineDir)}
              </span>
            );
          })
        : directionalInline(text, dir)}
    </Tag>
  );
}
