import { el } from "@/shared/lib/dom";
import { formatDueDate } from "@/shared/lib/format-date";
import type { Task } from "../model/task";

/**
 * `action` is a slot: a page can drop a feature's control in here without the task
 * entity ever importing that feature. This is how composition flows downward.
 */
export function TaskCard({ task, action }: { task: Task; action?: Node }): HTMLLIElement {
  return el(
    "li",
    { className: task.done ? "task task--done" : "task" },
    action,
    el("span", { className: "task__title", textContent: task.title }),
    el("time", {
      className: "task__due",
      textContent: formatDueDate(task.dueAt),
    }),
  );
}

// ─── ArchWall demo 5: a slice importing its own barrel ──────────────────────
// Select the two lines below and toggle the comment (Cmd+/ or Ctrl+/).
//
// Fires: no-cycles — index.ts → ui/TaskCard.ts → index.ts.
// Inside a slice, always import relatively ("../model/task"). The "@/entities/task"
// barrel exists for code outside the slice.
//
// import { makeTask } from "@/entities/task";
// export const placeholderTask = makeTask("Placeholder", 1);
