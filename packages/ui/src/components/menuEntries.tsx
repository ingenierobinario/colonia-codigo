import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { cx } from "../cx";
import { keyed } from "../keys";

export type MenuEntry =
  | {
      type?: "item";
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Shows a check at the end: the current choice in a list of options. */
      checked?: boolean;
      /** The menu stays open after it is picked: one of several options turned on and off in a row. */
      keepOpen?: boolean;
      onSelect?: () => void;
    }
  | { type: "separator" }
  | { type: "label"; label: ReactNode }
  | { type: "submenu"; label: ReactNode; icon?: ReactNode; disabled?: boolean; items: MenuEntry[] };

/** The items of a Menu or a ContextMenu (both are Base UI menus), submenus included. */
export function MenuEntries({
  items,
  portal,
}: {
  items: MenuEntry[];
  portal: RefObject<HTMLDivElement | null>;
}): ReactNode {
  return keyed(items, (it) => (it.type === "separator" ? "" : it.label)).map(({ item: it, key }) => {
    if (it.type === "separator") return <BaseMenu.Separator key={key} className="colonia-menu__sep" />;
    if (it.type === "label")
      return (
        <div key={key} className="colonia-menu__label">
          {it.label}
        </div>
      );
    if (it.type === "submenu")
      return (
        <BaseMenu.SubmenuRoot key={key}>
          <BaseMenu.SubmenuTrigger className="colonia-menu__item" disabled={it.disabled}>
            <span className="colonia-menu__icon">{it.icon}</span>
            <span className="colonia-menu__text">{it.label}</span>
            <ChevronRight className="colonia-menu__chevron" size={14} />
          </BaseMenu.SubmenuTrigger>
          <BaseMenu.Portal container={portal}>
            <BaseMenu.Positioner side="right" align="start" sideOffset={4} alignOffset={-5}>
              <BaseMenu.Popup className="colonia-menu">
                <MenuEntries items={it.items} portal={portal} />
              </BaseMenu.Popup>
            </BaseMenu.Positioner>
          </BaseMenu.Portal>
        </BaseMenu.SubmenuRoot>
      );
    return (
      <BaseMenu.Item
        key={key}
        className={cx("colonia-menu__item", it.danger && "is-danger")}
        disabled={it.disabled}
        closeOnClick={!it.keepOpen}
        onClick={it.onSelect}
      >
        <span className="colonia-menu__icon">{it.icon}</span>
        <span className="colonia-menu__text">{it.label}</span>
        {it.shortcut && <span className="colonia-menu__shortcut">{it.shortcut}</span>}
        {it.checked && <Check className="colonia-menu__check" size={14} />}
      </BaseMenu.Item>
    );
  });
}
