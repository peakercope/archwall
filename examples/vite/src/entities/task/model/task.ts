export type TaskId = string;

export interface Task {
  readonly id: TaskId;
  readonly title: string;
  readonly done: boolean;
  readonly dueAt: Date;
}

const DAY_MS = 86_400_000;
let sequence = 0;

/** The single place a Task is constructed — features call this instead of building the shape. */
export function makeTask(title: string, dueInDays: number): Task {
  sequence += 1;
  return {
    id: `task-${sequence}`,
    title,
    done: false,
    dueAt: new Date(Date.now() + dueInDays * DAY_MS),
  };
}
