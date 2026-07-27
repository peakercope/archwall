import { type TaskId, taskStore } from "@/entities/task";

export function toggleTask(id: TaskId): void {
  taskStore.toggle(id);
}
