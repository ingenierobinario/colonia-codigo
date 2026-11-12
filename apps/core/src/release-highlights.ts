// What each version brings, said for the people who use Colonia: one to four short sentences per language. This is the
// single source of a release's notes: the published release body is generated from it (scripts/release-body.ts), and
// every notice reads it back from there (the update dialog, its card, the desktop notification, the chat after updating).
// Keep this file free of imports: the release job runs that script on plain Node, before anything is installed.

export type Highlights = { en: string[]; es: string[] };

export const HIGHLIGHTS: Record<string, Highlights> = {
  "2.35.0": {
    en: [
      "New \"My computers\": use your other laptops from this Colonia, with your approval each time.",
      "Web apps like Gmail, Outlook, Slack and Teams open ready to use, and can save your passwords.",
      "Bring your favourite sites and bookmarks from your browser with a guided import.",
    ],
    es: [
      "Nuevo «Mis equipos»: usa tus otros portátiles desde este Colonia, con tu permiso cada vez.",
      "Webs como Gmail, Outlook, Slack y Teams se abren listas y pueden guardar tus contraseñas.",
      "Trae tus webs favoritas y marcadores de tu navegador con una importación guiada.",
    ],
  },
  "2.34.0": {
    en: [
      "If another program holds Colonia's port, the app says which one and how to fix it instead of waiting.",
      "The app and the background service no longer fight at startup, and connecting no longer freezes the window.",
      "On Linux, updates for a .deb or .rpm install bring that same package, with the command to install it.",
      "Windows: one service per folder whatever its spelling, and reinstalling keeps your service as it was.",
    ],
    es: [
      "Si otro programa ocupa el puerto de Colonia, la app dice cuál y cómo arreglarlo en vez de esperar.",
      "La app y el servicio ya no se pelean al arrancar, y conectar ya no congela la ventana.",
      "En Linux, si instalaste el .deb o el .rpm, la actualización trae ese paquete y la orden para instalarlo.",
      "Windows: un solo servicio por carpeta se escriba como se escriba, y reinstalar respeta tu servicio.",
    ],
  },
  "2.33.0": {
    en: [
      "On Linux you can now install Colonia with a .deb or .rpm package, as well as the AppImage.",
      "TikTok joins your connectors: your agents help you create your own app and upload videos as drafts.",
      "Clearer messages when connecting, and accents no longer get garbled when piping text to the terminal.",
    ],
    es: [
      "En Linux ya puedes instalar Colonia con un paquete .deb o .rpm, además del AppImage.",
      "TikTok se suma a tus conectores: tus agentes te ayudan a crear tu app y subir vídeos como borrador.",
      "Mensajes más claros al conectar, y las tildes ya no se rompen al pasar texto al terminal.",
    ],
  },
  "2.32.0": {
    en: [
      "The terminal is a real one on Windows and on Macs or Linux without Python: prompts, colours, full screen.",
      "On Windows, Colonia keeps the computer awake properly, starts hidden and updates when you quit.",
      "On Mac and Linux as a service, your tools, the keychain and the AppImage work as they do in your session.",
    ],
    es: [
      "El terminal es uno de verdad en Windows y en Mac o Linux sin Python: contraseñas, colores, pantalla completa.",
      "En Windows, Colonia mantiene el ordenador despierto como toca, arranca oculta y se actualiza al salir.",
      "En Mac y Linux como servicio, tus herramientas, el llavero y la AppImage funcionan como en tu sesión.",
    ],
  },
  "2.31.0": {
    en: ["In the Inbox By chat view, the Super-agent tag no longer gets cut off: it shows whole or steps aside."],
    es: ["En la vista Por chat de la Bandeja, la etiqueta Super-agente ya no sale cortada: se ve entera o se aparta."],
  },
  "2.30.0": {
    en: [
      "The Inbox groups each channel's contacts on their own, and By chat is one list, newest first.",
      "Chat titles are short and clear: no raw links, and names made only of emoji show the number.",
      "What you write to a contact from your own WhatsApp now shows in their chat in Colonia.",
      "On Windows, no console windows flash, and files with symbols in the name open and go to the bin.",
    ],
    es: [
      "La Bandeja agrupa los contactos de cada canal aparte, y Por chat es una sola lista, lo último primero.",
      "Títulos de chat cortos y claros: sin enlaces crudos, y un nombre solo de emojis muestra el número.",
      "Lo que escribes a un contacto desde tu propio WhatsApp ya aparece en su chat de Colonia.",
      "En Windows no parpadean consolas, y los archivos con símbolos en el nombre se abren y van a la papelera.",
    ],
  },
  "2.29.0": {
    en: [
      "YouTube, X, Facebook, Instagram and LinkedIn join the connectors: your agents can post and reply.",
      "On Mac and Linux, agents see the same tools and paths as your terminal.",
      "On Windows, the installer handles folders with spaces or accents, and Colonia closes cleanly.",
      "On Linux, the AppImage, tray icon, background service and keyring work out of the box.",
    ],
    es: [
      "YouTube, X, Facebook, Instagram y LinkedIn se suman a los conectores: tus agentes publican y responden.",
      "En Mac y Linux, los agentes ven las mismas herramientas y rutas que tu terminal.",
      "En Windows, el instalador admite carpetas con espacios o tildes, y Colonia se cierra limpiamente.",
      "En Linux, la AppImage, el icono de la bandeja, el servicio y el llavero funcionan desde el principio.",
    ],
  },
  "2.28.0": {
    en: [
      "Meta Ads, WhatsApp Business and TikTok Ads join the connectors: sign in and your agents use them.",
      "On a Mac, Colonia finds Claude and Codex installed with nvm, Volta, Bun, asdf, mise or MacPorts.",
      "On Windows, agents find the colonia command in Git Bash, and closing a terminal ends what it started.",
      "On a Linux server run as root, the built-in browser starts.",
    ],
    es: [
      "Meta Ads, WhatsApp Business y TikTok Ads se suman a los conectores: inicia sesión y tus agentes los usan.",
      "En Mac, Colonia encuentra Claude y Codex instalados con nvm, Volta, Bun, asdf, mise o MacPorts.",
      "En Windows, los agentes encuentran el comando colonia en Git Bash, y cerrar un terminal cierra lo que abrió.",
      "En un servidor Linux como root, el navegador integrado arranca.",
    ],
  },
  "2.27.0": {
    en: [
      "Each project can have its own picture: upload a photo, or pick an emoji or an icon and its colour.",
      "Closed tasks can be searched and reopened: they return to Pending with their conversation intact.",
      "A project's overview shows its open tasks at a glance.",
      "Update notices now say, in your language, what each version brings.",
    ],
    es: [
      "Cada proyecto puede llevar su propia imagen: sube una foto o elige un emoji o un icono con su color.",
      "Las tareas cerradas se pueden buscar y reabrir: vuelven a Pendiente con su conversación intacta.",
      "El resumen del proyecto enseña sus tareas abiertas de un vistazo.",
      "Los avisos de actualización cuentan en tu idioma qué trae cada versión.",
    ],
  },
  "2.26.0": {
    en: ["Agents keep working through long conversations: they open a fresh context window without losing progress."],
    es: [
      "Los agentes siguen trabajando en conversaciones largas: abren otra ventana de contexto sin perder el avance.",
    ],
  },
  "2.25.0": {
    en: ["Your agents can use Claude through your Claude Code subscription."],
    es: ["Tus agentes pueden usar Claude con tu suscripción de Claude Code."],
  },
};

/** The most a notice shows per language, and the longest a line may be: the rules every entry is held to. */
export const HIGHLIGHT_LIMITS = { lines: 4, chars: 110 } as const;

/** A version's highlights (a tag, a dev build and a plain x.y.z all name the same release). */
export function highlightsOf(version: string): Highlights | undefined {
  const plain = /^v?(\d+\.\d+\.\d+)/.exec(version)?.[1];
  return plain && Object.hasOwn(HIGHLIGHTS, plain) ? HIGHLIGHTS[plain] : undefined;
}

/** What is wrong with an entry, in words (nothing when it is fine): the release gate and its test share this. */
export function highlightProblems(version: string): string[] {
  const h = highlightsOf(version);
  if (!h) return [`Colonia ${version.replace(/^v/, "")} has no highlights in apps/core/src/release-highlights.ts`];
  const out: string[] = [];
  if (h.en.length !== h.es.length) out.push(`${h.en.length} lines in English, ${h.es.length} in Spanish`);
  for (const [language, lines] of [
    ["en", h.en],
    ["es", h.es],
  ] as const) {
    if (lines.length < 1 || lines.length > HIGHLIGHT_LIMITS.lines)
      out.push(`${language}: ${lines.length} lines (1 to ${HIGHLIGHT_LIMITS.lines})`);
    for (const line of lines) {
      if (line.length > HIGHLIGHT_LIMITS.chars)
        out.push(`${language}: over ${HIGHLIGHT_LIMITS.chars} characters: ${line}`);
      if (!line.trim() || /\n/.test(line)) out.push(`${language}: an empty or multi-line entry`);
    }
  }
  return out;
}
