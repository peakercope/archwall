export interface User {
  readonly id: string;
  readonly name: string;
}

/** Stand-in for a real session lookup. */
export function currentUser(): User {
  return { id: "user-1", name: "Ada Lovelace" };
}

// ─── ArchWall demo 4: an entity reaching up into a feature ──────────────────
// Select the two lines below and toggle the comment (Cmd+/ or Ctrl+/).
//
// Fires: layer-dependencies — entities sit below features and must not know they
// exist. An entity that needs a feature is a sign the logic belongs in the feature.
//
// import { createTask } from "@/features/create-task";
// export const createWelcomeTask = () => createTask(`Welcome, ${currentUser().name}`);
