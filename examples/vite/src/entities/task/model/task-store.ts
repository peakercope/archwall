import { makeTask, type Task, type TaskId } from "./task";

const listeners = new Set<() => void>();

let tasks: readonly Task[] = [
  { ...makeTask("Write the architecture contract", -1), done: true },
  makeTask("Wire up the Vite plugin", 2),
  makeTask("Break a rule on purpose", 5),
];

function commit(next: readonly Task[]): void {
  tasks = next;
  for (const listener of listeners) listener();
}

/**
 * Task state belongs to the task entity. Features mutate it only through these
 * actions, which is why nothing outside this slice needs its internals.
 */
export const taskStore = {
  get tasks(): readonly Task[] {
    return tasks;
  },
  add(task: Task): void {
    commit([...tasks, task]);
  },
  toggle(id: TaskId): void {
    commit(tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)));
  },
  /** Returns an unsubscribe function. The board page is the only subscriber today. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
