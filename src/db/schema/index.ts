// Drizzle schema entry point: the single place where tables are exported, one file per domain.
// drizzle-kit reads exactly what is exported here. Every table migration must enable
// Row Level Security (ADR-0002, rule 2), which `.enableRLS()` on the table does.
export * from "./profiles";
export * from "./customers";
export * from "./tasks";
export * from "./recovery-sessions";
