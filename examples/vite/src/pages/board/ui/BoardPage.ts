import { TaskCard, taskStore } from "@/entities/task";
import { currentUser, UserAvatar } from "@/entities/user";
import { CreateTaskForm } from "@/features/create-task";
import { ToggleTaskCheckbox } from "@/features/toggle-task";
import { el } from "@/shared/lib/dom";

/**
 * Pages are the composition root: this is the only place allowed to know that the
 * toggle feature and the task entity exist at the same time. Neither imports the other.
 */
export function BoardPage(): HTMLElement {
  const meta = el("p", { className: "board__meta" });
  const list = el("ul", { className: "board__tasks" });

  const page = el(
    "main",
    { className: "board" },
    el(
      "header",
      { className: "board__header" },
      el("div", {}, el("h1", { textContent: "Task board" }), meta),
      UserAvatar({ user: currentUser() }),
    ),
    CreateTaskForm(),
    list,
  );

  /** Re-rendered wholesale on every store change — the list is three items long. */
  function render(): void {
    const tasks = taskStore.tasks;
    meta.textContent = `${tasks.filter((task) => !task.done).length} remaining`;
    list.replaceChildren(
      ...tasks.map((task) => TaskCard({ task, action: ToggleTaskCheckbox({ task }) })),
    );
  }

  taskStore.subscribe(render);
  render();

  return page;
}

// ─── ArchWall demo 3: deep import past a slice's public API ─────────────────
// Select the two lines below and toggle the comment (Cmd+/ or Ctrl+/).
//
// Fires: public-api. Note that the import below is perfectly valid TypeScript and
// resolves fine — nothing but ArchWall objects to it. The classifier tagged
// model/task.ts `visibility: "internal"`, and this file is in a different slice.
//
// Import "@/entities/task" instead: the index is the slice's contract, and it is
// what lets the slice move its internals around without breaking callers.
//
// import { makeTask } from "@/entities/task/model/task";
// export const draftTask = makeTask("Draft", 1);
