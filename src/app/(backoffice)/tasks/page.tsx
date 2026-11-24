import type { Metadata } from "next";

export const metadata: Metadata = { title: "Taken" };

/** Start page of the backoffice (B1). The task overview itself is built in BT-09. */
export default function TasksPage() {
  return <h1 className="text-2xl font-semibold tracking-tight">Taken</h1>;
}
