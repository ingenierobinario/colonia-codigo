// What each version brings, said for the people who use Colonia: one to four short sentences per language. This is the
// single source of a release's notes: the published release body is generated from it (scripts/release-body.ts), and
// every notice reads it back from there (the update dialog, its card, the desktop notification, the chat after updating).
// Keep this file free of imports: the release job runs that script on plain Node, before anything is installed.

export type Highlights = { en: string[]; es: string[] };

export const HIGHLIGHTS: Record<string, Highlights> = {
  "2.36.8": {
    en: [
      "Chats open in tabs: Ctrl-click or middle-click a chat, or use its menu, and move between them above the chat.",
      "Tabs can be reordered by dragging, and come back when you reopen Colonia.",
    ],
    es: [
      "Los chats se abren en pestañas: Ctrl+clic o clic central en un chat, o desde su menú, y se cambia entre ellas encima del chat.",
      "Las pestañas se reordenan arrastrando y vuelven al abrir Colonia de nuevo.",
    ],
  },
  "2.36.7": {
    en: [
      "Stop halts what the agent was doing on screen, and the live window closes; it also has a close button.",
      "Agents can use the computers you connected by remote terminal when you let them.",
      "Rename each computer in «My computers», and this computer appears there as «This computer».",
    ],
    es: [
      "Detener corta lo que el agente hacía en pantalla y la ventana en vivo se cierra; además tiene botón de cerrar.",
      "Los agentes pueden usar los equipos conectados por terminal remota cuando se lo permites.",
      "Cada equipo se puede renombrar en «Mis equipos», y este ordenador aparece ahí como «Este equipo».",
    ],
  },
  "2.36.6": {
    en: [
      "Tree, Activity and By chat fold their groups the same way, aligned with the chats.",
      "Group counts are never cut off, and Colonia remembers what you folded.",
    ],
    es: [
      "Árbol, Actividad y Por chat pliegan sus grupos igual, alineados con los chats.",
      "Los recuentos de los grupos ya no se cortan y Colonia recuerda lo que plegaste.",
    ],
  },
  "2.36.5": {
    en: [
      "WhatsApp keeps both sides of each chat together, also for contacts that write from a private id.",
      "The bookmarks bar shows the bookmarks of profiles signed in to Google.",
      "Your profile can have a photo, and «My computers» shows each device's name and type.",
      "Internal, External and Browsers fold in the sidebar like the other sections.",
    ],
    es: [
      "WhatsApp junta los dos lados de cada chat, también con contactos que escriben con id privado.",
      "La barra de marcadores muestra los de perfiles con la sesión de Google iniciada.",
      "Tu perfil puede tener foto, y «Mis equipos» muestra el nombre y el tipo de cada aparato.",
      "Internas, Externas y Navegadores se pliegan en la barra como las demás secciones.",
    ],
  },
  "2.36.4": {
    en: [
      "«My computers» scans your whole network and finds computers you had not talked to yet.",
      "Computers without remote access show up too, with the steps to enable it right there.",
    ],
    es: [
      "«Mis equipos» recorre toda tu red y encuentra equipos con los que aún no habías hablado.",
      "Los equipos sin acceso remoto también salen, con los pasos para activarlo ahí mismo.",
    ],
  },
  "2.36.3": {
    en: [
      "WhatsApp brings back earlier messages from your phone into the chats Colonia already has.",
      "Browsers show their real logo and the profile's bookmarks bar under the address.",
      "Your agents know which sites each browser profile is signed in to and use that session.",
      "Closing Colonia no longer shows a JavaScript error.",
    ],
    es: [
      "WhatsApp trae los mensajes anteriores del móvil a los chats que Colonia ya tiene.",
      "Los navegadores muestran su logo real y la barra de marcadores del perfil bajo la dirección.",
      "Tus agentes saben en qué webs tiene sesión cada perfil del navegador y la usan.",
      "Cerrar Colonia ya no muestra un error de JavaScript.",
    ],
  },
  "2.36.2": {
    en: [
      "Web apps no longer open blank inside Colonia.",
      "You can now write files on a computer you added, and its card shows its address.",
      "Clearing a chat keeps the dialog open when the window narrows and shows a 24-hour time.",
      "Browsers: back/forward in the right order, a clear path at the top and plain error messages.",
    ],
    es: [
      "Las aplicaciones web ya no se abren en blanco dentro de Colonia.",
      "Ya puedes escribir archivos en un equipo añadido, y su tarjeta muestra la dirección.",
      "Limpiar la conversación no se cierra al estrechar la ventana y muestra la hora en 24 h.",
      "Navegadores: atrás y adelante en su orden, ruta clara arriba y avisos sin jerga.",
    ],
  },
  "2.36.1": {
    en: [
      "«Add a computer» finds computers on your network or VPN and connects without installing Colonia there.",
      "Your agents can browse the files of a connected computer.",
    ],
    es: [
      "«Añadir un equipo» encuentra los ordenadores de tu red o VPN y se conecta sin instalar Colonia en ellos.",
      "Tus agentes pueden ver los archivos de un equipo conectado.",
    ],
  },
  "2.36.0": {
    en: [
      "New Browsers section: profiles and a built-in browser with tabs, also usable by your agents.",
      "The Externals «+» no longer offers Gmail, Outlook, Slack or Teams presets.",
      "WhatsApp messages you write on your phone while Colonia is offline are no longer lost.",
      "You can clear a conversation so the agent starts from scratch.",
    ],
    es: [
      "Sección Navegadores nueva: perfiles y navegador integrado con pestañas, también para tus agentes.",
      "El «+» de Externas ya no ofrece los presets de Gmail, Outlook, Slack ni Teams.",
      "Lo que escribes en WhatsApp desde el móvil con Colonia desconectada ya no se pierde.",
      "Puedes limpiar la conversación para que el agente empiece de cero.",
    ],
  },
  "2.35.2": {
    en: [
      "What you write to a WhatsApp contact from your phone shows up in their chat again.",
      "Claude's usage limits show up again in the AI quotas, without spending tokens.",
      "Browser import shows each profile by its name and no longer fills the sidebar.",
      "A new icon: the penguin bigger and without the black background.",
    ],
    es: [
      "Lo que escribes a un contacto de WhatsApp desde el móvil vuelve a salir en su chat.",
      "Los límites de Claude vuelven a salir en las cuotas de IA, sin gastar tokens.",
      "La importación del navegador muestra cada perfil con su nombre y ya no llena la barra.",
      "Icono nuevo: el pingüino más grande y sin el fondo negro.",
    ],
  },
  "2.35.1": {
    en: [
      "The chat list and each agent in the Inbox tree fold away with one click, and stay as you left them.",
      "\"My computers\" opens Colonia to your network right there when the command was missing.",
      "The external sessions section is now called \"AIs\" and has a + to add another one.",
    ],
    es: [
      "La lista de chats y cada agente del árbol de la Inbox se pliegan con un clic y se quedan así.",
      "«Mis equipos» abre Colonia a tu red ahí mismo cuando faltaba el comando.",
      "Las sesiones externas ahora se llaman «IAs» y tienen un + para añadir otra.",
    ],
  },
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
