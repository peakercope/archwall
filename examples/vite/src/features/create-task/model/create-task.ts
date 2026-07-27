import { makeTask, taskStore } from "@/entities/task";

/** Adds a task to the board. Returns false when the title is blank. */
export function createTask(title: string, dueInDays = 7): boolean {
  const trimmed = title.trim();
  if (trimmed === "") return false;

  taskStore.add(makeTask(trimmed, dueInDays));
  return true;
}

// ─── ArchWall demo 1: one feature importing another ─────────────────────────
// Select the two lines below and toggle the comment (Cmd+/ or Ctrl+/).
//
// Fires: feature-isolation — sibling slices within a layer are isolated, so no
// feature may import another. Share code by moving it down into `entities` or
// `shared`, or compose both features in a page.
//
// import { toggleTask } from "@/features/toggle-task";
// export const createDone = (title: string) => { createTask(title); toggleTask("task-1"); };
