import { useEffect } from "react";
import { loadCatalog, loadModelsConfig } from "../data/models.ts";
import { useProviders } from "../data/providers.ts";
import { useT } from "../i18n/index.ts";
import { ModelCatalog } from "./models/ModelCatalog.tsx";
import { ProvidersGrid } from "./ProvidersGrid.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";

/**
 * What agents and the router run on: the ChatGPT plan (as Codex) and the model APIs in Colonia's own loop (add your own),
 * and every model each one offers. The CLIs are in External sessions.
 */
export function EnginesSection() {
  const t = useT();
  useEffect(() => {
    void loadCatalog();
    void loadModelsConfig();
  }, []);

  return (
    <>
      <SectionHead title={t("config.engines")} lead={t("engines.leadModels")} />
      <SubHead>{t("engines.groupAccount")}</SubHead>
      <p className="config__hint">{t("engines.groupAccountLead")}</p>
      <ProvidersGrid part="plans" />
      <KeysGroup />
      <ModelCatalog kind="provider" />
    </>
  );
}

/** MOTORES-LLANO-1: the services paid with a key of your own, folded away until one has a key. */
function KeysGroup() {
  const t = useT();
  const loaded = useProviders((s) => s.list.length > 0);
  const anyKey = useProviders((s) => s.list.some((p) => !p.sign_in && p.needs_key && p.key_set));
  return (
    <details
      className="config__fold"
      open={anyKey}
      key={loaded ? String(anyKey) : "loading"}
      data-testid="engines-keys"
    >
      <summary className="config__fold-summary">
        <SubHead>{t("providers.title")}</SubHead>
      </summary>
      <p className="config__hint">{t("providers.lead")}</p>
      <ProvidersGrid part="keys" />
    </details>
  );
}
