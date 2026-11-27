import type { Agent, Organization, Project } from "@colonia/protocol";
import { AgentAvatar, Button, Icons } from "@colonia/ui";
import { blobOf, DEFAULT_PID } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import type { OfficeActivity } from "./activity.ts";
import { Desk, Lounge, Plant } from "./Furniture.tsx";

export type OfficeRoom = { id: string; project: string; projectName: string; name: string; agents: Agent[] };

export function officeRooms(
  agents: readonly Agent[],
  projects: readonly Project[],
  organizations: Record<string, Organization>,
  general: string,
  base: string,
): OfficeRoom[] {
  const rooms: OfficeRoom[] = [];
  for (const project of [{ id: DEFAULT_PID, name: base }, ...projects.filter((entry) => entry.registered !== false)]) {
    const team = agents.filter((agent) => (agent.project_id ?? DEFAULT_PID) === project.id);
    const areas = organizations[project.id]?.areas ?? [];
    const slugs = [...new Set([...areas.map((area) => area.slug), ...team.map((agent) => agent.area ?? "")])];
    if (!slugs.length) slugs.push("");
    for (const slug of slugs)
      rooms.push({
        id: `${project.id}:${slug}`,
        project: project.id,
        projectName: project.name,
        name: slug ? (areas.find((area) => area.slug === slug)?.name ?? slug) : general,
        agents: team.filter((agent) => (agent.area ?? "") === slug).sort((a, b) => a.id.localeCompare(b.id)),
      });
  }
  return rooms;
}

export function OfficeScene({
  rooms,
  activity,
  query,
  onAgent,
  onTeam,
  list,
}: {
  rooms: OfficeRoom[];
  activity: Map<string, OfficeActivity>;
  query: string;
  list: boolean;
  onAgent: (agent: Agent) => void;
  onTeam: (project: string) => void;
}) {
  const t = useT();
  const matches = (agent: Agent) => !query || agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  if (query && !rooms.some((room) => room.agents.some(matches)))
    return (
      <p className="office-feedback" role="status">
        {t("office.noResults")}
      </p>
    );
  if (list)
    return (
      <div className="office-roster">
        {rooms.map((room) => (
          <section key={room.id}>
            <h2>
              {room.projectName} <span> / {room.name}</span>
            </h2>
            {room.agents.filter(matches).map((agent) => {
              const state = activity.get(agent.id) ?? { presence: "offline", summary: "", active: 0 };
              return (
                <button
                  type="button"
                  key={agent.id}
                  className="office-roster__person"
                  aria-label={t("office.chat", { name: agent.name })}
                  onClick={() => onAgent(agent)}
                >
                  <AgentAvatar name={agent.name} blob={blobOf(agent)} size={44} animated={false} />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{state.summary || t(`office.${state.presence}`)}</small>
                  </span>
                  <span className={`office-presence is-${state.presence}`}>{t(`office.${state.presence}`)}</span>
                  <Icons.MessageCircle size={16} />
                </button>
              );
            })}
          </section>
        ))}
      </div>
    );
  return (
    <div className="office-floor">
      {rooms.map((room) => (
        <section className="office-room" key={room.id} aria-label={`${room.projectName}: ${room.name}`}>
          <header className="office-room__plaque">
            <span>{room.projectName}</span>
            <h2>{room.name}</h2>
            <button type="button" onClick={() => onTeam(room.project)} aria-label={t("office.team")}>
              <Icons.Settings size={14} />
            </button>
          </header>
          <div className="office-room__plant">
            <Plant />
          </div>
          <div className="office-stations">
            {room.agents.map((agent) => {
              const state = activity.get(agent.id) ?? { presence: "offline", summary: "", active: 0 };
              const match = matches(agent);
              return (
                <div className={`office-station is-${state.presence}${match ? "" : " is-muted"}`} key={agent.id}>
                  <button
                    type="button"
                    className="office-bubble"
                    onClick={() => onAgent(agent)}
                    title={state.summary || t(`office.${state.presence}`)}
                    tabIndex={match ? 0 : -1}
                  >
                    <span className={`office-dot is-${state.presence}`} />
                    <span>{state.summary || t(`office.${state.presence}`)}</span>
                    {state.active > 1 && <small>+{state.active - 1}</small>}
                  </button>
                  <Desk working={state.presence === "working"} />
                  <div className="office-chair" aria-hidden="true" />
                  <button
                    type="button"
                    className="office-person"
                    onClick={() => onAgent(agent)}
                    aria-label={t("office.chat", { name: agent.name })}
                    tabIndex={match ? 0 : -1}
                  >
                    <AgentAvatar
                      name={agent.name}
                      blob={blobOf(agent)}
                      size={62}
                      animated={state.presence === "working"}
                    />
                    <strong>{agent.name}</strong>
                    <span className={`office-person__state is-${state.presence}`}>{t(`office.${state.presence}`)}</span>
                  </button>
                </div>
              );
            })}
            {!room.agents.length && (
              <div className="office-room__empty">
                <Desk working={false} />
                <p>{t("office.empty")}</p>
                <Button size="sm" variant="ghost" onClick={() => onTeam(room.project)}>
                  {t("office.team")}
                </Button>
              </div>
            )}
          </div>
        </section>
      ))}
      <section className="office-lounge">
        <div>
          <h2>{t("office.lounge")}</h2>
          <p>{t("office.loungeHint")}</p>
        </div>
        <Lounge />
        <Plant />
      </section>
    </div>
  );
}
