// COPIA-COMPLETA-1 · Piezas compartidas de Ajustes › Copia y traslado.
import type { BackupStatus, BackupSummary } from "@colonia/protocol";
import { IconButton, Icons, Input, Spinner } from "@colonia/ui";
import { type ReactNode, useState } from "react";
import { formatNumber } from "../common/format.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

export type Why = NonNullable<BackupStatus["why"]>;
export const whyKey = (why: Why | undefined): MessageKey => `backup.why.${why ?? "failed"}`;

/** Una tarjeta de la sección: icono, título, una línea y el contenido. */
export function BackupCard({
  icon,
  title,
  hint,
  name,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <section className="bk-card" data-bk={name}>
      <header className="bk-card__head">
        <span className="bk-card__icon" aria-hidden="true">
          {icon}
        </span>
        <div className="bk-card__titles">
          <h3 className="bk-card__title">{title}</h3>
          <p className="bk-card__hint">{hint}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Un campo de contraseña con el ojo para verla. */
export function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  name,
  onEnter,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  name: string;
  onEnter?: () => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <Input
      id={id}
      name={name}
      type={shown ? "text" : "password"}
      autoComplete="new-password"
      value={value}
      invalid={invalid}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      trailing={
        <IconButton
          size="sm"
          variant="ghost"
          label={t(shown ? "backup.hide" : "backup.show")}
          onClick={() => setShown((s) => !s)}
          icon={shown ? <Icons.EyeOff /> : <Icons.Eye />}
        />
      }
    />
  );
}

const COUNTS = [
  "projects",
  "chats",
  "messages",
  "flows",
  "agents",
  "channels",
  "memories",
  "browsers",
  "apps",
  "providers",
  "people",
  "routines",
] as const satisfies readonly (keyof BackupSummary)[];

/** Cuánto hay de cada cosa: doce casillas, que cuadran a 4, 3 y 2 columnas (640 y 480 px). */
export function Counts({ summary, project = false }: { summary: BackupSummary; project?: boolean }) {
  const t = useT();
  const counts = project ? (["chats", "messages", "agents", "flows", "routines", "memories"] as const) : COUNTS;
  return (
    <dl className="bk-counts">
      {counts.map((k) => (
        <div key={k} className="bk-count" data-count={k}>
          <dd className="bk-count__n">{formatNumber(summary[k])}</dd>
          <dt className="bk-count__label">{t(`backup.n.${k}`)}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Cómo va una copia o una restauración en marcha. */
export function Progress({ status }: { status: BackupStatus }) {
  const t = useT();
  const share = status.total > 0 ? Math.min(1, status.done / status.total) : undefined;
  return (
    <div className="bk-progress" role="status">
      <div className="bk-progress__line">
        <Spinner size={14} />
        <span className="bk-progress__text">{t(`backup.phase.${status.phase ?? "snapshot"}`)}</span>
        {share !== undefined && (
          <span className="bk-progress__n">
            {t("backup.progress", { done: formatNumber(status.done), total: formatNumber(status.total) })}
          </span>
        )}
      </div>
      <div className="bk-progress__track" aria-hidden="true">
        <div
          className={share === undefined ? "bk-progress__fill is-unknown" : "bk-progress__fill"}
          style={share === undefined ? undefined : { width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Un aviso dentro de una tarjeta: algo que la persona tendrá que hacer, o lo que salió mal. */
export function Note({ tone, children }: { tone: "warn" | "error" | "ok"; children: ReactNode }) {
  return (
    <p className={`bk-note bk-note--${tone}`} role={tone === "error" ? "alert" : undefined}>
      {tone === "ok" ? <Icons.Check /> : <Icons.ShieldAlert />}
      <span>{children}</span>
    </p>
  );
}
