// CONTRASENAS-1 / IMPORTAR-1: en Ajustes, importar del navegador de siempre y las contraseñas guardadas de las
// aplicaciones web (paginadas, con filtro). Ver una contraseña pide confirmar al sistema; nada se guarda en claro.
import { Button, EmptyState, Icons, SearchField } from "@colonia/ui";
import { useEffect, useMemo, useState } from "react";
import type { SavedLogin } from "../colonia-desktop.d.ts";
import { abrirAsistente } from "../data/migrar.ts";
import { notify } from "../data/notices.ts";
import { usePack, useT } from "../i18n/index.ts";
import "../styles/webapps.css";

const POR_PAGINA = 8;

export function MigrarSection() {
  const listo = usePack("migrar");
  const desktop = window.coloniaDesktop;
  const t = useT();
  if (!listo || !desktop?.importSources) return null;
  return (
    <div className="config__section">
      <h3 className="config__subhead">{t("migrar.cfg.title")}</h3>
      <p className="config__hint">{t("migrar.cfg.body")}</p>
      <div className="config__actions">
        <Button variant="secondary" onClick={abrirAsistente}>
          {t("migrar.cfg.open")}
        </Button>
      </div>
    </div>
  );
}

export function LoginsSection() {
  const listo = usePack("migrar");
  const desktop = window.coloniaDesktop;
  const t = useT();
  const [disponible, setDisponible] = useState<boolean>();
  const [lista, setLista] = useState<SavedLogin[]>([]);
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(0);
  const [visibles, setVisibles] = useState<Record<string, string>>({});

  useEffect(() => {
    const d = window.coloniaDesktop;
    if (!d?.loginsList) return;
    void d.loginsAvailable?.().then(setDisponible);
    void d.loginsList().then(setLista);
  }, []);

  const filtradas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return lista.filter((l) => !f || `${l.origen} ${l.usuario}`.toLowerCase().includes(f));
  }, [lista, filtro]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas - 1);
  const trozo = filtradas.slice(actual * POR_PAGINA, (actual + 1) * POR_PAGINA);

  if (!listo || !desktop?.loginsList) return null;
  const mostrar = async (l: SavedLogin) => {
    const r = await desktop.loginsReveal?.(l.id);
    if (r?.ok && r.contrasena !== undefined) setVisibles((v) => ({ ...v, [l.id]: r.contrasena ?? "" }));
    else notify(t("login.revealFailed"));
  };
  const ocultar = (id: string) =>
    setVisibles((v) => {
      const { [id]: _quitada, ...resto } = v;
      return resto;
    });
  const borrar = async (l: SavedLogin) => {
    if (!(await desktop.loginsRemove?.(l.id))) return;
    ocultar(l.id);
    setLista((p) => p.filter((x) => x.id !== l.id));
    notify(t("login.removed"), "info");
  };
  return (
    <div className="config__section logins">
      <h3 className="config__subhead">{t("login.section")}</h3>
      <p className="config__hint">{t("login.sectionLead")}</p>
      {disponible === false && <p className="config__hint">{t("login.unavailable")}</p>}
      {lista.length === 0 ? (
        <EmptyState variant="dashed" icon={<Icons.Lock />} title={t("login.emptyTitle")}>
          {t("login.emptyBody")}
        </EmptyState>
      ) : (
        <>
          <SearchField
            placeholder={t("login.filter")}
            value={filtro}
            onChange={(e) => {
              setFiltro(e.currentTarget.value);
              setPagina(0);
            }}
          />
          {trozo.map((l) => (
            <div key={l.id} className="logins__row">
              <span className="logins__who">
                <span>{l.origen.replace(/^https?:\/\//, "")}</span>
                <span className="logins__user">{l.usuario}</span>
                {visibles[l.id] !== undefined && <span className="logins__secret">{visibles[l.id]}</span>}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => (visibles[l.id] !== undefined ? ocultar(l.id) : void mostrar(l))}
              >
                {visibles[l.id] !== undefined ? t("login.hide") : t("login.show")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void borrar(l)}>
                {t("login.remove")}
              </Button>
            </div>
          ))}
          <div className="logins__pager">
            <Button size="sm" variant="ghost" disabled={actual === 0} onClick={() => setPagina(actual - 1)}>
              {t("login.prev")}
            </Button>
            <span>{t("login.page", { page: actual + 1, pages: paginas })}</span>
            <Button size="sm" variant="ghost" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)}>
              {t("login.next")}
            </Button>
          </div>
          <p className="config__hint">{t("login.confirmNote")}</p>
        </>
      )}
    </div>
  );
}
