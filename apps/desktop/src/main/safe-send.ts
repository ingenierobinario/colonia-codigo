// ERR-5: a message for a panel that is already gone (the window closing, the app quitting, its renderer crashed) is
// dropped. Sending to a destroyed WebContents throws "Object has been destroyed" inside whatever timer or event sent it.

type Target = { isDestroyed(): boolean; send(channel: string, ...args: unknown[]): void };

/** Sends to the panel if it is still there; says whether it went. */
export function sendTo(target: Target | null | undefined, channel: string, ...args: unknown[]): boolean {
  if (!target || target.isDestroyed()) return false;
  try {
    target.send(channel, ...args);
    return true;
  } catch {
    // Destroyed between the check and the send (its frame was being disposed).
    return false;
  }
}
