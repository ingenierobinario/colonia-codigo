// Preload de las aplicaciones web (aislado, sin puente a la página): ve el formulario de acceso, avisa al proceso
// principal cuando se envía y rellena la contraseña guardada. La página nunca recibe nada de aquí: la contraseña solo
// viaja por IPC y solo se escribe en el campo.
import { ipcRenderer } from "electron";

const visible = (el: HTMLInputElement) => el.type !== "hidden" && !el.disabled && el.getClientRects().length > 0;
const campos = (raiz: ParentNode) => [...raiz.querySelectorAll<HTMLInputElement>("input")].filter(visible);
const esClave = (el: HTMLInputElement) => el.type === "password";
const esUsuario = (el: HTMLInputElement) => ["text", "email", "tel", ""].includes(el.type) && !esClave(el);

/** El campo de usuario que precede a la contraseña en el mismo formulario (o en la página si no hay formulario). */
function usuarioDe(clave: HTMLInputElement): HTMLInputElement | undefined {
  const lista = campos(clave.form ?? document);
  const antes = lista.slice(0, lista.indexOf(clave)).filter(esUsuario);
  return antes.find((c) => /user|email|mail|login|name/i.test(c.autocomplete + c.name + c.id)) ?? antes.at(-1);
}

function escribir(el: HTMLInputElement, valor: string): void {
  const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  poner?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

let ultimo = "";
function enviar(clave: HTMLInputElement | undefined): void {
  if (!clave?.value) return;
  const usuario = usuarioDe(clave)?.value ?? "";
  const huella = `${usuario}\n${clave.value}`;
  if (!usuario || huella === ultimo) return;
  ultimo = huella;
  ipcRenderer.send("login:capture", usuario, clave.value);
}
const claveRellena = (raiz: ParentNode) => campos(raiz).find((c) => esClave(c) && c.value);

document.addEventListener(
  "submit",
  (e) => enviar(claveRellena(e.target instanceof HTMLFormElement ? e.target : document)),
  true,
);
document.addEventListener(
  "click",
  (e) => {
    const t = e.target instanceof Element ? e.target.closest("button, input[type=submit], [role=button]") : null;
    if (t) enviar(claveRellena(t.closest("form") ?? document));
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) enviar(claveRellena(e.target.form ?? document));
  },
  true,
);

// Relleno: se pregunta una vez por campo de contraseña y solo se escribe si sigue vacío.
const consultados = new WeakSet<HTMLInputElement>();
async function rellenar(): Promise<void> {
  const clave = campos(document).find((c) => esClave(c) && !c.value && !consultados.has(c));
  if (!clave) return;
  consultados.add(clave);
  const cred = (await ipcRenderer.invoke("login:probe")) as { usuario?: unknown; contrasena?: unknown } | undefined;
  if (typeof cred?.usuario !== "string" || typeof cred.contrasena !== "string" || clave.value) return;
  const u = usuarioDe(clave);
  if (u && !u.value) escribir(u, cred.usuario);
  escribir(clave, cred.contrasena);
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
const mirar = () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => void rellenar().catch(() => {}), 400);
};
window.addEventListener("DOMContentLoaded", () => {
  mirar();
  new MutationObserver(mirar).observe(document.documentElement, { childList: true, subtree: true });
});
