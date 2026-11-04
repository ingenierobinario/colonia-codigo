import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { type ReactNode, useId } from "react";
import { cx } from "../cx";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Text next to the switch. */
  label?: ReactNode;
  /** Muted line under the label. */
  description?: ReactNode;
  size?: "sm" | "md";
  className?: string;
  /** Accessible name when there is no visible label. */
  "aria-label"?: string;
}

/** On/off setting. Track fills with the selection color (ink in minimal, green in classic). */
export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  description,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const id = useId();
  const control = (
    <BaseSwitch.Root
      id={id}
      className={cx("colonia-switch", `colonia-switch--${size}`)}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(v) => onCheckedChange?.(v)}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
    >
      <BaseSwitch.Thumb className="colonia-switch__thumb" />
    </BaseSwitch.Root>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <label htmlFor={id} className={cx("colonia-choice", disabled && "is-disabled", className)}>
      <span className="colonia-choice__text">
        <span className="colonia-choice__label">{label}</span>
        {description && <span className="colonia-choice__desc">{description}</span>}
      </span>
      {control}
    </label>
  );
}
