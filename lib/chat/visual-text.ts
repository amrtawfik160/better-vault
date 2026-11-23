import type { VisualInput, VisualKind } from "./visuals";

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export function visualCsv(kind: VisualKind, data: unknown): string {
  if (kind === "table") {
    const table = data as VisualInput<"table">;
    return [table.columns, ...table.rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }
  const chart = data as VisualInput<"chart">;
  return [
    ["", ...chart.series.map((each) => each.name)],
    ...chart.labels.map((label, at) => [
      label,
      ...chart.series.map((each) => each.values[at] ?? ""),
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

/** A visual as plain text, for copying into notes or documents. */
export function visualText(kind: VisualKind, data: unknown): string {
  const { title } = data as { title: string };
  switch (kind) {
    case "diagram":
      return `\`\`\`mermaid\n${(data as VisualInput<"diagram">).mermaid}\n\`\`\``;
    case "table": {
      const table = data as VisualInput<"table">;
      return [
        `| ${table.columns.join(" | ")} |`,
        `| ${table.columns.map(() => "---").join(" | ")} |`,
        ...table.rows.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
    }
    case "chart":
      return visualCsv(kind, data);
    case "timeline":
      return [
        `## ${title}`,
        ...(data as VisualInput<"timeline">).items.map(
          (item) => `- **${item.when}**: ${item.title}${item.detail ? ` — ${item.detail}` : ""}`,
        ),
      ].join("\n");
    case "steps":
      return [
        `## ${title}`,
        ...(data as VisualInput<"steps">).steps.map(
          (step, at) => `${at + 1}. **${step.title}**${step.detail ? ` — ${step.detail}` : ""}`,
        ),
      ].join("\n");
    case "comparison":
      return (data as VisualInput<"comparison">).columns
        .map((column) =>
          [`### ${column.name}`, ...column.points.map((point) => `- ${point}`)].join("\n"),
        )
        .join("\n\n");
    case "facts":
      return (data as VisualInput<"facts">).facts
        .map(
          (fact) => `- ${fact.label}: **${fact.value}**${fact.detail ? ` (${fact.detail})` : ""}`,
        )
        .join("\n");
    case "flashcards":
      return (data as VisualInput<"flashcards">).cards
        .map((card) => `Q: ${card.front}\nA: ${card.back}`)
        .join("\n\n");
  }
}
