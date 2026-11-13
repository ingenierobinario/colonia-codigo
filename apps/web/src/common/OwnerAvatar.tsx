// FOTO-DUENO-1: the owner as the panel draws them, their picture when they uploaded one, else their initials. While the
// picture loads, or if it cannot be read, the initials stay.

import { useOwnerPhoto } from "../data/owner.ts";
import { initialsOf } from "../data/prefs.ts";
import { usePicture } from "./ProjectAvatar.tsx";

export function OwnerAvatar({ name, className }: { name: string; className: string }) {
  const photo = useOwnerPhoto();
  const url = usePicture(photo);
  return (
    <span className={className} aria-hidden="true">
      {url ? <img className="owner-photo" src={url} alt="" draggable={false} /> : initialsOf(name)}
    </span>
  );
}
