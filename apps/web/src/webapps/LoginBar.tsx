// CONTRASENAS-1: barra «¿Guardar la contraseña?» sobre la web, al estilo de Chrome. Solo muestra sitio y usuario.
import { Button } from "@colonia/ui";
import { useEffect } from "react";
import { escucharOfertas, responderOferta, useLoginOffer } from "../data/logins.ts";
import { usePack, useT } from "../i18n/index.ts";
import "../styles/webapps.css";

export function LoginBar({ app }: { app: string }) {
  const listo = usePack("migrar");
  const offer = useLoginOffer(app);
  useEffect(escucharOfertas, []);
  const t = useT();
  if (!listo || !offer) return null;
  const vars = { user: offer.usuario, site: offer.sitio };
  return (
    <div className="loginbar" role="alert">
      <span className="loginbar__text">{t(offer.cambia ? "login.offerChange" : "login.offer", vars)}</span>
      <span className="loginbar__actions">
        <Button size="sm" onClick={() => void responderOferta(offer, "guardar")}>
          {offer.cambia ? t("login.update") : t("login.save")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void responderOferta(offer, "ahora-no")}>
          {t("login.notNow")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void responderOferta(offer, "nunca")}>
          {t("login.never")}
        </Button>
      </span>
    </div>
  );
}
