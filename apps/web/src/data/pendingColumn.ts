// Where a task waits before anyone starts it. Pure, so the list's grouping and the reopen both read it.

/** "To do" when the board has it, else the first column that is neither in progress nor in review. */
export function pendingColumn(columns: readonly { id: string }[]): string {
  const todo = columns.some((c) => c.id === "todo");
  return todo ? "todo" : (columns.find((c) => c.id !== "doing" && c.id !== "review")?.id ?? columns[0]?.id ?? "todo");
}
