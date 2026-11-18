import {
  Book02Icon,
  File02Icon,
  Globe02Icon,
  Pdf01Icon,
  TextIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { SourceKind } from "@/lib/db/database";

export const sourceKindIcons: Record<SourceKind, IconSvgElement> = {
  text: TextIcon,
  markdown: File02Icon,
  pdf: Pdf01Icon,
  epub: Book02Icon,
  url: Globe02Icon,
};
