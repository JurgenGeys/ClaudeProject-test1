import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mijn taken" };

/** Start page of the technician (T1). The task list itself is built in BT-11. */
export default function MyTasksPage() {
  return <h1 className="text-2xl font-semibold tracking-tight">Mijn taken</h1>;
}
