import { el } from "@/shared/lib/dom";
import { Button } from "@/shared/ui/Button";
import { createTask } from "../model/create-task";

export function CreateTaskForm(): HTMLFormElement {
  const input = el("input", {
    ariaLabel: "Task title",
    placeholder: "Add a task…",
  });

  return el(
    "form",
    {
      className: "create-task",
      onsubmit: (event) => {
        event.preventDefault();
        if (createTask(input.value)) input.value = "";
      },
    },
    input,
    Button({ label: "Add", type: "submit" }),
  );
}
