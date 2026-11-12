// IMPORTAR-1: asistente de tres pasos (navegador, aplicaciones, listo). Solo lee marcadores y webs más visitadas, y solo
// cuando se pulsa «Importar»; nunca contraseñas ni sesiones.
import { Button, Checkbox, Dialog, EmptyState, Icons } from "@colonia/ui";
import { useEffect, useState } from "react";
import type { ImportSource } from "../colonia-desktop.d.ts";
import { cerrarAsistente, marcarOfrecido, useMigrar } from "../data/migrar.ts";
import { loadWebApps, saveWebApp, useWebApps, webAppId } from "../data/webapps.ts";
import { usePack, useT } from "../i18n/index.ts";
import { reconocerWebs, type WebReconocida } from "./presets.ts";
import "../styles/webapps.css";

const NAVEGADORES = { chrome: "Chrome", edge: "Edge", brave: "Brave", firefox: "Firefox" } as const;

export function ImportWizard() {
  const abierto = useMigrar((s) => s.open);
  const listo = usePack("migrar");
  return abierto && listo ? <Cuerpo /> : null;
}

function Cuerpo() {
  const t = useT();
  const apps = useWebApps((s) => s.apps);
  const [fuentes, setFuentes] = useState<ImportSource[]>();
  const [fuente, setFuente] = useState<string>();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState(false);
  const [webs, setWebs] = useState<WebReconocida[]>([]);
  const [sinVisitas, setSinVisitas] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [anadidas, setAnadidas] = useState(0);

  useEffect(() => {
    marcarOfrecido();
    void (window.coloniaDesktop?.importSources?.() ?? Promise.resolve([])).then((s) => {
      setFuentes(s);
      setFuente(s[0]?.id);
    });
  }, []);

  const importar = async () => {
    if (!fuente) return;
    setLeyendo(true);
    setError(false);
    const r = await window.coloniaDesktop?.importRead?.(fuente).catch(() => undefined);
    setLeyendo(false);
    if (!r) return setError(true);
    const encontradas = reconocerWebs(r.marcadores, r.visitadas);
    setWebs(encontradas);
    setSinVisitas(r.visitadasNoDisponibles);
    setMarcadas(new Set(encontradas.filter((w) => !apps.some((a) => a.name === w.name)).map((w) => w.name)));
    setPaso(2);
  };

  const anadir = async () => {
    const ids = apps.map((a) => a.id);
    let n = 0;
    for (const w of webs) {
      if (!marcadas.has(w.name)) continue;
      const id = webAppId(w.name, ids);
      if (await saveWebApp(id, { name: w.name, url: w.url })) {
        ids.push(id);
        n++;
      }
    }
    await loadWebApps();
    setAnadidas(n);
    setPaso(3);
  };

  const alternar = (nombre: string) =>
    setMarcadas((p) => {
      const n = new Set(p);
      n.has(nombre) ? n.delete(nombre) : n.add(nombre);
      return n;
    });
  const pasos = [t("migrar.step1"), t("migrar.step2"), t("migrar.step3")];
  const titulo = (s: ImportSource) => t("migrar.profileName", { browser: NAVEGADORES[s.navegador], profile: s.perfil });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && cerrarAsistente()}
      title={paso === 3 ? t("migrar.doneTitle") : t("migrar.title")}
      description={paso === 1 ? t("migrar.lead") : undefined}
      footer={
        paso === 1 ? (
          <>
            <Button variant="secondary" onClick={cerrarAsistente}>
              {t("migrar.skip")}
            </Button>
            <Button disabled={!fuente} loading={leyendo} onClick={() => void importar()}>
              {leyendo ? t("migrar.reading") : t("migrar.import")}
            </Button>
          </>
        ) : paso === 2 ? (
          <>
            <Button variant="secondary" onClick={() => setPaso(1)}>
              {t("migrar.back")}
            </Button>
            <Button disabled={!marcadas.size} onClick={() => void anadir()}>
              {marcadas.size === 1 ? t("migrar.pinOne") : t("migrar.pin", { n: marcadas.size })}
            </Button>
          </>
        ) : (
          <Button onClick={cerrarAsistente}>{t("migrar.close")}</Button>
        )
      }
    >
      <div className="import">
        <ol className="import__steps" aria-label={t("migrar.title")}>
          {pasos.map((p, i) => (
            <li key={p} className="import__step" aria-current={paso === i + 1 ? "step" : undefined}>
              <span className="import__num">{i + 1}</span>
              {p}
            </li>
          ))}
        </ol>
        {paso === 1 &&
          (fuentes && !fuentes.length ? (
            <EmptyState variant="dashed" icon={<Icons.Globe />} title={t("migrar.none")}>
              {t("migrar.noneBody")}
            </EmptyState>
          ) : (
            <fieldset className="import__list">
              <legend className="import__legend">{t("migrar.pickBrowser")}</legend>
              {(fuentes ?? []).map((s) => (
                <label key={s.id} className="import__card" data-on={fuente === s.id || undefined}>
                  <input type="radio" name="fuente" checked={fuente === s.id} onChange={() => setFuente(s.id)} />
                  <span>{titulo(s)}</span>
                </label>
              ))}
              {error && <p className="import__error">{t("migrar.readFailed")}</p>}
            </fieldset>
          ))}
        {paso === 2 &&
          (webs.length ? (
            <>
              <p className="import__hint">{t("migrar.foundBody")}</p>
              {sinVisitas && <p className="import__hint">{t("migrar.visitsUnavailable")}</p>}
              <ul className="import__list">
                {webs.map((w) => (
                  <li key={w.name} className="import__card" data-on={marcadas.has(w.name) || undefined}>
                    <Checkbox
                      checked={marcadas.has(w.name)}
                      onCheckedChange={() => alternar(w.name)}
                      label={w.name}
                      description={w.origen === "marcador" ? t("migrar.fromMarks") : t("migrar.fromVisits")}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState variant="dashed" icon={<Icons.Globe />} title={t("migrar.foundNone")}>
              {t("migrar.foundNoneBody")}
            </EmptyState>
          ))}
        {paso === 3 && <p className="import__hint">{anadidas ? t("migrar.doneBody") : t("migrar.doneNone")}</p>}
      </div>
    </Dialog>
  );
}
