import type { Task } from "@/entities/task";
import { el } from "@/shared/lib/dom";
import { toggleTask } from "../model/toggle-task";

export function ToggleTaskCheckbox({ task }: { task: Task }): HTMLInputElement {
  return el("input", {
    type: "checkbox",
    checked: task.done,
    ariaLabel: `Mark "${task.title}" as ${task.done ? "not done" : "done"}`,
    onchange: () => toggleTask(task.id),
  });
}
