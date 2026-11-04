import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { useColonia } from "./ColoniaProvider";

export interface SelectOption {
  value: string;
  label: string;
  /** Leading avatar or icon (an agent's blob, a project tile, a priority dot). */
  icon?: ReactNode;
  /** Muted text after the label (a project name, a count). */
  hint?: string;
  /** A line under the label in the list, saying what the choice does (the field shows the label only). */
  description?: string;
  /** Options with the same group are listed under it, in the order they first appear. */
  group?: string;
  /** Marks at the end of the row in the list (a contact's channels); the field shows the label only. */
  trailing?: ReactNode;
  /** More words a searchable list finds it by (its channels' names), not shown. */
  keywords?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  options: readonly SelectOption[];
  /** Shown while nothing is chosen. */
  placeholder?: string;
  /** Accessible name (there is no visible label; wrap it in Field for one). */
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

/** One choice from a list, with icons and groups: agent, project, type, priority, reminder. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  size = "md",
  disabled,
  className,
}: SelectProps) {
  const { portalRef } = useColonia();
  const current = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  const item = (o: SelectOption) => (
    <BaseSelect.Item key={o.value} value={o.value} disabled={o.disabled} className="colonia-menu__item colonia-select__item">
      {o.icon && <span className="colonia-select__icon">{o.icon}</span>}
      {o.description ? (
        <span className="colonia-select__lines">
          <BaseSelect.ItemText className="colonia-menu__text">{o.label}</BaseSelect.ItemText>
          <span className="colonia-select__desc">{o.description}</span>
        </span>
      ) : (
        <BaseSelect.ItemText className="colonia-menu__text">{o.label}</BaseSelect.ItemText>
      )}
      {o.hint && <span className="colonia-select__hint">{o.hint}</span>}
      {o.trailing && <span className="colonia-select__trailing">{o.trailing}</span>}
      <BaseSelect.ItemIndicator className="colonia-select__check">
        <Check size={14} />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => onValueChange(v)}
      disabled={disabled}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cx("colonia-field", `colonia-field--${size}`, "colonia-select", disabled && "is-disabled", className)}
      >
        {current?.icon && <span className="colonia-select__icon">{current.icon}</span>}
        <BaseSelect.Value className={cx("colonia-select__value", !current && "is-placeholder")} placeholder={placeholder}>
          {() => current?.label ?? placeholder}
        </BaseSelect.Value>
        <BaseSelect.Icon className="colonia-select__chevron">
          <ChevronDown size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={portalRef}>
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="colonia-select__positioner">
          <BaseSelect.Popup className="colonia-menu colonia-select__popup">
            {groups.map((g) =>
              g ? (
                <BaseSelect.Group key={g}>
                  <BaseSelect.GroupLabel className="colonia-menu__label">{g}</BaseSelect.GroupLabel>
                  {options.filter((o) => o.group === g).map(item)}
                </BaseSelect.Group>
              ) : (
                options.filter((o) => !o.group).map(item)
              ),
            )}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
