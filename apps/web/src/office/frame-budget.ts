export function officeFrameBudget() {
  let next = 0;
  let cost = 0;
  return {
    ready(now: number, invalidated = false) {
      return invalidated || now >= next;
    },
    rendered(start: number, end: number) {
      cost = Math.max(end - start, cost * 0.8);
      // Reserve input time without letting a slow shader compile delay later edits for seconds.
      next = end + Math.min(250, Math.max(32, cost * 2));
    },
  };
}
