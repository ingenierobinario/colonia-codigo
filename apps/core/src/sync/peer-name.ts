import { cleanAlias } from "../domain/team-computers.ts";

type NamedPeer = { id: string; name: string; alias?: string };

export function peerName(peer: NamedPeer) {
  return {
    id: peer.id,
    name: peer.alias || peer.name,
    hostname: peer.name,
    ...(peer.alias ? { alias: peer.alias } : {}),
  };
}

/** A stale editor must not rename a different computer paired while it was open. */
export function renamePeer(peer: NamedPeer | undefined, id: string, raw: string, save: () => void): void {
  if (!peer || peer.id !== id) throw new Error("The paired computer has changed. Open its name again.");
  const previous = peer.alias;
  const alias = cleanAlias(raw);
  if (alias && alias !== peer.name) peer.alias = alias;
  else delete peer.alias;
  try {
    save();
  } catch (error) {
    if (previous === undefined) delete peer.alias;
    else peer.alias = previous;
    throw error;
  }
}
