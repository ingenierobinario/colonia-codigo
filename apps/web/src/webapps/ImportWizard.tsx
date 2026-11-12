// IMPORTAR-1: asistente de dos pasos (perfil, listo). Solo lee marcadores y webs más visitadas, y solo cuando se pulsa
// «Importar»; nunca contraseñas ni sesiones. PERFIL-AGENTE-1: no ancla nada en la barra lateral: lo leído queda como
// una nota global de Memoria para los agentes. PERFIL-NOMBRE-1: cada perfil se muestra con su nombre real y su cuenta.
import { Button, Dialog, EmptyState, Icons } from "@colonia/ui";
import { useEffect, useState } from "react";
import type { ImportSource } from "../colonia-desktop.d.ts";
import { client } from "../data/client.ts";
import { cerrarAsistente, marcarOfrecido, notaDelPerfil, useMigrar } from "../data/migrar.ts";
import { usePack, useT } from "../i18n/index.ts";
import { reconocerWebs } from "./presets.ts";
import "../styles/webapps.css";

const NAVEGADORES = { chrome: "Chrome", edge: "Edge", brave: "Brave", firefox: "Firefox" } as const;

export function ImportWizard() {
  const abierto = useMigrar((s) => s.open);
  const listo = usePack("migrar");
  return abierto && listo ? <Cuerpo /> : null;
}

function Cuerpo() {
  const t = useT();
  const [fuentes, setFuentes] = useState<ImportSource[]>();
  const [fuente, setFuente] = useState<string>();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<"read" | "save">();
  const [sinVisitas, setSinVisitas] = useState<string | undefined>();
  const [guardada, setGuardada] = useState(false);

  useEffect(() => {
    marcarOfrecido();
    void (window.coloniaDesktop?.importSources?.() ?? Promise.resolve([])).then((s) => {
      setFuentes(s);
      setFuente(s[0]?.id);
    });
  }, []);

  const titulo = (s: ImportSource) =>
    t("migrar.profileName", { browser: NAVEGADORES[s.navegador], profile: s.nombre ?? s.perfil });

  const importar = async () => {
    const f = fuentes?.find((x) => x.id === fuente);
    if (!f) return;
    setLeyendo(true);
    setError(undefined);
    try {
      const r = await window.coloniaDesktop?.importRead?.(f.id).catch(() => undefined);
      if (!r) return setError("read");
      const cabecera = t("migrar.note", { profile: titulo(f) });
      const texto = notaDelPerfil(
        cabecera,
        { apps: t("migrar.noteApps"), sitios: t("migrar.noteSites") },
        reconocerWebs(r.marcadores, r.visitadas),
        r.marcadores,
        r.visitadas,
      );
      if (texto) {
        // Reimportar el mismo perfil actualiza su nota en vez de apilar otra.
        const { memories } = await client.call("memory.list", { scope: "global", query: cabecera, limit: 50 });
        const previa = memories.find((m) => m.text.startsWith(cabecera));
        await client.call("memory.add", {
          text: texto,
          scope: "global",
          kind: "reference",
          ...(previa ? { id: previa.id } : {}),
        });
      }
      setGuardada(Boolean(texto));
      setSinVisitas(r.visitadasNoDisponibles ? NAVEGADORES[f.navegador] : undefined);
      setPaso(2);
    } catch {
      setError("save");
    } finally {
      setLeyendo(false);
    }
  };

  const pasos = [t("migrar.step1"), t("migrar.step2")];
  const elegida = fuentes?.find((x) => x.id === fuente);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && cerrarAsistente()}
      title={paso === 2 ? t("migrar.doneTitle") : t("migrar.title")}
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
                  <span className="import__profile">
                    <span>{titulo(s)}</span>
                    {s.email && <span className="import__email">{s.email}</span>}
                  </span>
                </label>
              ))}
              {error && (
                <p className="import__error">{error === "read" ? t("migrar.readFailed") : t("migrar.saveFailed")}</p>
              )}
            </fieldset>
          ))}
        {paso === 2 && (
          <>
            <p className="import__hint">
              {guardada ? t("migrar.doneBody", { profile: elegida ? titulo(elegida) : "" }) : t("migrar.doneNone")}
            </p>
            {sinVisitas && <p className="import__hint">{t("migrar.visitsUnavailable", { browser: sinVisitas })}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
