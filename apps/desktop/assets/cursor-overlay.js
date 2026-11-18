const cursor = document.getElementById("c");
const label = document.getElementById("l");
const note = document.getElementById("t");
const ring = document.getElementById("r");
const name = document.getElementById("name");
const face = document.getElementById("face");
const initials = document.getElementById("initial");
let noteTimer;
let cursorTimer;
let point;

// La punta permanece sobre el punto real. Solo la etiqueta cambia de lado junto al borde.
function placeLabel() {
  if (!point || label.hidden) return;
  const { x, y } = point;
  const width = label.offsetWidth;
  const height = label.offsetHeight;
  const left = x + 30 + width <= innerWidth - 3 ? x + 30 : x - 8 - width;
  const top = y + 24 + height <= innerHeight - 3 ? y + 24 : y - 6 - height;
  label.style.left = Math.max(3, Math.min(innerWidth - 3 - width, left)) - x + 5 + "px";
  label.style.top = Math.max(3, Math.min(innerHeight - 3 - height, top)) - y + 4 + "px";
}

window.drawCursor = (x, y, message, actor, blob) => {
  point = { x, y };
  cursor.style.transform = "translate(" + (x - 5) + "px," + (y - 4) + "px)";
  cursor.style.opacity = "1";
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => {
    cursor.style.opacity = "0";
  }, 60_000);

  label.hidden = !message && !actor;
  name.textContent = actor?.name || "";
  note.textContent = message || "";
  face.hidden = Boolean(actor && !blob);
  initials.hidden = !face.hidden;
  if (!face.hidden) face.src = blob ? "cursor-faces/" + blob + ".svg" : "logo-green.svg";
  initials.textContent = "";
  if (!initials.hidden) {
    const parts = actor.name.trim().split(/\s+/u);
    initials.textContent = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)[0] : (parts[0]?.[1] ?? ""));
    initials.textContent = initials.textContent.toUpperCase();
  }
  placeLabel();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    note.textContent = "";
    label.hidden = !actor;
    placeLabel();
  }, 3500);
};

window.pulse = () => {
  ring.classList.remove("on");
  void ring.offsetWidth;
  ring.classList.add("on");
};
window.addEventListener("resize", placeLabel);
