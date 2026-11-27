import type { Agent } from "@colonia/protocol";
import { AgentAvatar } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import type { OfficeActivity } from "./activity.ts";
import { officeFrameBudget } from "./frame-budget.ts";
import type { OfficeRoom } from "./OfficeScene.tsx";
import { disposeOfficeModels, updateOfficeAvatars } from "./scene-avatars.ts";
import { officeLabels } from "./scene-labels.ts";
import { pickOfficeAgent } from "./scene-picking.ts";
import { createOfficeWorld } from "./scene-world.ts";

type Props = {
  rooms: OfficeRoom[];
  activity: Map<string, OfficeActivity>;
  query: string;
  zoom: number;
  suspended: boolean;
  onAgent: (agent: Agent) => void;
  onTeam: (project: string) => void;
  onUnavailable: () => void;
};

function createOfficeRenderer() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: true, alpha: true });
  if (!context) throw new Error("WebGL2 is unavailable");
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.setClearColor(0xe4e9e4, 1);
  return renderer;
}

function useOfficeScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const motion = useRef(true);
  const invalidated = useRef(true);
  const sceneKey = JSON.stringify(
    props.rooms.map((room) => ({
      id: room.id,
      agents: room.agents.map((agent) => agent.id),
    })),
  );
  useEffect(() => {
    latest.current = props;
    invalidated.current = true;
  }, [props]);
  useEffect(() => {
    motion.current = !paused;
    invalidated.current = true;
  }, [paused]);
  useEffect(() => {
    const element = host.current;
    let roster = latest.current.rooms;
    const shapes: { id: string; agents: string[] }[] = JSON.parse(sceneKey);
    const avatars = new Map(roster.flatMap((room) => room.agents.map((a) => [a.id, blobOf(a) ?? "menta"])));
    const rooms = shapes.map((room) => ({
      id: room.id,
      agents: room.agents.map((id) => ({ id, blob: avatars.get(id) ?? "menta" })),
    }));
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createOfficeRenderer();
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    element.prepend(renderer.domElement);
    const { scene, camera, controls, characters, roomLabels } = createOfficeWorld(rooms, renderer.domElement);
    const initialOffset = camera.position.clone().sub(controls.target);
    const stopPicking = pickOfficeAgent(renderer.domElement, camera, characters, (id) => {
      const agent = latest.current.rooms.flatMap((room) => room.agents).find((person) => person.id === id);
      if (
        agent &&
        (!latest.current.query || agent.name.toLocaleLowerCase().includes(latest.current.query.toLocaleLowerCase()))
      )
        latest.current.onAgent(agent);
    });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const labelLayer = officeLabels(camera, element);
    let width = element.clientWidth;
    let height = element.clientHeight;
    const budget = officeFrameBudget();
    let contextLost = false;
    const draw = (time: number) => {
      if (!budget.ready(time, invalidated.current)) return;
      const animate = motion.current && !reduced.matches && !latest.current.suspended;
      const changed = controls.update();
      if (!animate && !changed && !invalidated.current) return;
      const started = performance.now();
      invalidated.current = false;
      if (roster !== latest.current.rooms) {
        roster = latest.current.rooms;
        if (
          updateOfficeAvatars(
            characters,
            new Map(roster.flatMap((room) => room.agents.map((a) => [a.id, blobOf(a) ?? "menta"]))),
          )
        )
          renderer.shadowMap.needsUpdate = true;
      }
      camera.zoom = latest.current.zoom;
      camera.updateProjectionMatrix();
      labelLayer.begin(width, height);
      for (const person of characters) {
        const state = latest.current.activity.get(person.id)?.presence ?? "offline";
        const idle = state === "idle";
        const moving = animate && state !== "offline";
        const phase = time / 1000 + person.phase;
        person.model.group.position.set(
          person.x + (moving && idle ? Math.sin(phase * 0.3) * 0.38 : 0),
          0.25 + (moving ? Math.sin(phase * 3) * 0.035 : 0),
          person.z + (moving && idle ? (1 + Math.cos(phase * 0.3)) * 0.25 : 0),
        );
        person.model.group.rotation.y = state === "working" ? Math.PI : moving ? Math.sin(phase * 0.5) * 0.35 : 0;
        person.model.arms.forEach((arm, i) => {
          arm.rotation.x = moving ? Math.sin(phase * (idle ? 2 : 7) + i) * 0.3 : 0;
        });
        const node = labels.current?.querySelector<HTMLElement>(`[data-person="${CSS.escape(person.id)}"]`) ?? null;
        labelLayer.place(node, person.model.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)));
      }
      for (const room of roomLabels)
        labelLayer.place(
          labels.current?.querySelector<HTMLElement>(`[data-room="${CSS.escape(room.id)}"]`) ?? null,
          room.point,
        );
      labelLayer.paint();
      renderer.render(scene, camera);
      budget.rendered(started, performance.now());
    };
    const resize = new ResizeObserver(() => {
      width = element.clientWidth;
      height = element.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.position
        .copy(controls.target)
        .add(initialOffset.clone().multiplyScalar(Math.max(1, 1.35 / camera.aspect)));
      camera.updateProjectionMatrix();
      invalidated.current = true;
    });
    resize.observe(element);
    const invalidate = () => {
      invalidated.current = true;
    };
    for (const event of ["pointerover", "pointerout", "focusin", "focusout"])
      element.addEventListener(event, invalidate);
    const visibility = () => renderer.setAnimationLoop(document.hidden || contextLost ? null : draw);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    const lost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      setFailed(true);
      renderer.setAnimationLoop(null);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      resize.disconnect();
      for (const event of ["pointerover", "pointerout", "focusin", "focusout"])
        element.removeEventListener(event, invalidate);
      controls.dispose();
      stopPicking();
      disposeOfficeModels(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [sceneKey]);
  return { host, labels, failed, paused, setPaused };
}

export function Office3D(props: Props) {
  const t = useT();
  const { host, labels, failed, paused, setPaused } = useOfficeScene(props);
  useEffect(() => {
    if (failed) props.onUnavailable();
  }, [failed, props.onUnavailable]);
  const compact = !props.query && props.rooms.reduce((count, room) => count + room.agents.length, 0) > 12;
  return (
    <div className={`office-3d${compact ? " is-compact" : ""}`} ref={host}>
      {failed ? (
        <p role="status" className="office-feedback">
          {t("office.no3d")}
        </p>
      ) : (
        <>
          <div className="office-3d__hint">{t("office.cameraHint")}</div>
          <button
            type="button"
            className="office-motion"
            aria-pressed={!paused}
            onClick={() => setPaused((value) => !value)}
          >
            {t(paused ? "office.resumeMotion" : "office.pauseMotion")}
          </button>
          <div className="office-3d__labels" ref={labels}>
            {props.rooms.map((room) => (
              <section className="office-room-labels" key={room.id} aria-label={`${room.projectName}: ${room.name}`}>
                <button
                  type="button"
                  className="office-3d__room"
                  data-room={room.id}
                  onClick={() => props.onTeam(room.project)}
                >
                  <small>{room.projectName}</small>
                  <strong>{room.name}</strong>
                </button>
                {room.agents
                  .filter(
                    (agent) => !props.query || agent.name.toLocaleLowerCase().includes(props.query.toLocaleLowerCase()),
                  )
                  .map((agent) => {
                    const state = props.activity.get(agent.id);
                    return (
                      <button
                        type="button"
                        className={`office-person office-3d__person is-${state?.presence ?? "offline"}`}
                        data-person={agent.id}
                        key={agent.id}
                        aria-label={t("office.chat", { name: agent.name })}
                        title={state?.summary || t(`office.${state?.presence ?? "offline"}`)}
                        onClick={() => props.onAgent(agent)}
                      >
                        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={22} animated={false} />
                        <strong>{agent.name}</strong>
                        <span>{state?.summary || t(`office.${state?.presence ?? "offline"}`)}</span>
                      </button>
                    );
                  })}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
