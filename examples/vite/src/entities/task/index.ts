/**
 * Public API of the `task` entity. Everything reachable from outside this slice is
 * listed here; the classifier in archwall.config.ts tags this file `visibility: "public"`
 * and every other file in the slice `visibility: "internal"`.
 */
export { makeTask, type Task, type TaskId } from "./model/task";
export { taskStore } from "./model/task-store";
export { TaskCard } from "./ui/TaskCard";
