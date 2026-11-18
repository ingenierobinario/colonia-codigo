import { createLiveFeed, type LiveActivity } from "./screenLiveState.ts";

// El chat ya escucha al escritorio mientras Vite carga el componente que presenta la primera acción.
const desktop = window.coloniaDesktop;
export const hasComputerActivity = Boolean(desktop?.onComputerActivity);
export const activity = createLiveFeed((dispatch) => {
  desktop?.onComputerActivity?.((a) =>
    dispatch(a ? { type: "activity", activity: a as LiveActivity, at: Date.now() } : { type: "handoff" }),
  );
  desktop?.onComputerStopped?.((stopped) => dispatch({ type: "stopped", stopped }));
});
