export function officeFrameBudget() {
  let next = 0;
  let cost = 0;
  let submitted: number | undefined;
  return {
    ready(now: number, invalidated = false) {
      if (submitted !== undefined) {
        const graphics = now - submitted;
        submitted = undefined;
        // The GPU can stall compositing after render() returned. Account for that delay too.
        if (graphics > 80) {
          cost = Math.max(cost, Math.min(250, graphics));
          next = Math.max(next, now + Math.min(250, cost * 2));
        }
      }
      return invalidated || now >= next;
    },
    rendered(start: number, end: number) {
      cost = Math.max(end - start, cost * 0.8);
      // Reserve input time without letting a slow shader compile delay later edits for seconds.
      next = end + Math.min(250, Math.max(32, cost * 2));
      submitted = end;
    },
  };
}
