const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DAY_MS = 86_400_000;

/** "yesterday", "in 3 days" — how a due date is rendered on a task card. */
export function formatDueDate(dueAt: Date, now: Date = new Date()): string {
  return RELATIVE.format(Math.round((dueAt.getTime() - now.getTime()) / DAY_MS), "day");
}
