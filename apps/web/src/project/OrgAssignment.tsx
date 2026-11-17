import type { Agent, Organization } from "@colonia/protocol";
import { Button, Dialog, Field, Icons, Select } from "@colonia/ui";
import { useState } from "react";
import { assignAgent } from "../data/org.ts";
import { useT } from "../i18n/index.ts";
import "./org-assignment.css";

const NONE = "~none";
const KEEP = "~keep";
export interface AssignmentTarget {
  area: string;
  agent?: Agent;
}

export function AreaMembers({
  area,
  members,
  canAssign,
  onAssign,
}: {
  area: string;
  members: Agent[];
  canAssign: boolean;
  onAssign(target: AssignmentTarget): void;
}) {
  const t = useT();
  return (
    <div className="org-members">
      {members.length > 0 && (
        <ul aria-label={t("overview.agents")} className="org-members__list">
          {members.map((agent) => (
            <li key={agent.id}>
              <button type="button" className="org-members__agent" onClick={() => onAssign({ area, agent })}>
                <strong>{agent.name}</strong>
                <span>{agent.role || t("agentedit.noRole")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canAssign && (
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Users size={14} />}
          onClick={() => onAssign({ area })}
        >
          {t("org.assign")}
        </Button>
      )}
    </div>
  );
}

export function OrgAssignment({
  pid,
  team,
  org,
  target,
  onClose,
}: {
  pid: string;
  team: Agent[];
  org: Organization;
  target: AssignmentTarget;
  onClose(): void;
}) {
  const t = useT();
  const [agentId, setAgentId] = useState(target.agent?.id ?? (team.length === 1 ? team[0]?.id : undefined));
  const [area, setArea] = useState(target.area);
  const [selectedRole, setSelectedRole] = useState<string>();
  const [busy, setBusy] = useState(false);
  const agent = team.find((a) => a.id === agentId);
  const roles = org.roles.filter((r) => !r.area || r.area === area);
  const current = roles.find((r) => r.name === agent?.role);
  const custom = Boolean(agent?.role && !org.roles.some((r) => r.name === agent.role));
  const validChoice =
    selectedRole === NONE || (selectedRole === KEEP && custom) || roles.some((r) => r.slug === selectedRole);
  const role = validChoice && selectedRole ? selectedRole : (current?.slug ?? (custom ? KEEP : NONE));
  const save = async () => {
    if (!agent || busy) return;
    setBusy(true);
    const ok = await assignAgent(pid, agent.id, area || null, role === KEEP ? undefined : role === NONE ? null : role);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      className="org-assignment"
      title={t("org.assign")}
      description={t("org.assignHint")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!agent} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="taskform">
        <Field label={t("common.agent")}>
          <Select
            label={t("common.agent")}
            value={agent?.id ?? null}
            disabled={busy}
            placeholder={t("org.chooseAgent")}
            options={team.map((a) => ({ value: a.id, label: a.name }))}
            onValueChange={(id) => {
              setAgentId(id ?? undefined);
              setSelectedRole(undefined);
            }}
          />
        </Field>
        <Field label={t("team.area")}>
          <Select
            label={t("team.area")}
            value={area || NONE}
            disabled={busy}
            options={[
              { value: NONE, label: t("agentedit.noArea") },
              ...org.areas.map((a) => ({ value: a.slug, label: a.name })),
            ]}
            onValueChange={(v) => {
              setArea(v === NONE || !v ? "" : v);
            }}
          />
        </Field>
        <Field label={t("org.role")}>
          <Select
            label={t("org.role")}
            value={role}
            disabled={busy || !agent}
            options={[
              { value: NONE, label: t("agentedit.noRole") },
              ...(custom && agent ? [{ value: KEEP, label: agent.role }] : []),
              ...roles.map((r) => ({ value: r.slug, label: r.name })),
            ]}
            onValueChange={(v) => setSelectedRole(v ?? NONE)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
