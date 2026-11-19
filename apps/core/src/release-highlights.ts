// What each version brings, said for the people who use Colonia: one to four short sentences per language. This is the
// single source of a release's notes: the published release body is generated from it (scripts/release-body.ts), and
// every notice reads it back from there (the update dialog, its card, the desktop notification, the chat after updating).
// Keep this file free of imports: the release job runs that script on plain Node, before anything is installed.

export type Highlights = { en: string[]; es: string[] };

export const HIGHLIGHTS: Record<string, Highlights> = {
  "2.36.56": {
    en: [
      "A \"Without asking\" switch in the chat header lets the project's agents work without stopping for your OK.",
      "Colonia carries about half as many files, so installing and updating write less to disk.",
      "Chats from flows can be deleted, and a project's Chats tab counts the ones waiting for you.",
      "Removing an attachment from a task takes effect right away.",
    ],
    es: [
      "Un interruptor «Sin pedir permiso» en la cabecera del chat deja trabajar a los agentes sin esperar tu OK.",
      "Colonia lleva cerca de la mitad de archivos, así que instalar y actualizar escriben menos en disco.",
      "Los chats de los flujos se pueden borrar y la pestaña Chats cuenta los que te esperan.",
      "Al quitar un adjunto de una tarea, desaparece al instante.",
    ],
  },
  "2.36.54": {
    en: [
      "The AI accounts section folds, has a + to add an account, and ChatGPT shows its own logo.",
      "After Change connection by mistake, one button takes you back to the Colonia you were using.",
      "The first start opens the assistant without a fixed pause and explains what it is waiting for.",
      "On Windows, Restart to update installs silently and reopens Colonia.",
    ],
    es: [
      "La sección Cuentas de IA se pliega, tiene un + para añadir una cuenta y ChatGPT lleva su logo.",
      "Si pulsas Cambiar conexión sin querer, un botón te devuelve a la Colonia que estabas usando.",
      "El primer arranque abre el asistente sin pausa fija y explica a qué está esperando.",
      "En Windows, Reiniciar para actualizar instala en silencio y vuelve a abrir Colonia.",
    ],
  },
  "2.36.53": {
    en: [
      "The sidebar has an AI accounts section: connect ChatGPT or Claude and import your chats from there.",
      "If Codex, Claude Code or Kimi is missing, install it with one button where Colonia runs.",
    ],
    es: [
      "La barra lateral tiene una sección Cuentas de IA: conecta ChatGPT o Claude e importa tus chats desde ahí.",
      "Si falta Codex, Claude Code o Kimi, se instala con un botón donde se ejecuta Colonia.",
    ],
  },
  "2.36.52": {
    en: [
      "The agent's cursor shows the name and avatar of whoever moves it, even when the agent changes.",
      "In New chat, choose the project and which ChatGPT, Claude, Claude Code or Cowork histories to import.",
      "The preview accepts ZIP, JSON, JSONL and selected Cowork notes, keeps branches and avoids duplicates on retry.",
    ],
    es: [
      "El cursor de una acción del agente muestra el nombre y el avatar de quien lo mueve, aunque cambie el agente.",
      "En Nuevo chat, elige el proyecto y qué historiales de ChatGPT, Claude, Claude Code o Cowork importar.",
      "Admite ZIP, JSON, JSONL y notas de Cowork, conserva ramas y no duplica al reintentar.",
    ],
  },
  "2.36.51": {
    en: [
      "A server can run active routines and Flows with your PC off. Results sync when you reconnect.",
      "Choose which folders to sync. If you edit a file on both computers, both versions are kept.",
      "You can move a project in an encrypted copy that includes its documents, chats, attachments, roles and agents.",
      "When you open a browser profile or a pinned app, its data loads along with the screen.",
    ],
    es: [
      "Un servidor ejecuta rutinas y Flows activos con el PC apagado. Al volver, ves los resultados.",
      "Elige qué carpetas sincronizar. Si editas un archivo en ambos equipos, se conservan las dos versiones.",
      "Puedes mover un proyecto en una copia cifrada que incluye documentos, chats, adjuntos, roles y agentes.",
      "Al abrir un perfil de navegador o una app anclada, sus datos se cargan con la pantalla.",
    ],
  },
  "2.36.50": {
    en: [
      "Assign agents to areas and roles and see their responsibilities in the project chart.",
      "Share projects with their skills and agents, including compatible Claude Code and Codex definitions.",
      "Open a backup or sync another Colonia from My computers.",
      "Choose logos for internal apps and find service connectors more easily.",
    ],
    es: [
      "Asigna áreas y roles a los agentes y consulta sus responsabilidades en el organigrama del proyecto.",
      "Comparte proyectos con sus skills y agentes, incluidos los compatibles de Claude Code y Codex.",
      "Abre la copia de seguridad o sincroniza otra Colonia desde Mis equipos.",
      "Elige el logo de las aplicaciones internas y encuentra más fácilmente los conectores de servicios.",
    ],
  },
  "2.36.49": {
    en: [
      "Exporting a project now takes its skills with it, ready to import elsewhere.",
      "Agents and skills from Claude Code, Codex, Cursor or Gemini in the folder show up in the project.",
      "A new agent added to the project folder appears right away, without reopening.",
      "Routines travel switched off, so nothing runs until you turn it on.",
    ],
    es: [
      "Al exportar un proyecto se llevan también sus skills, listas para importarlo en otro sitio.",
      "Los agentes y skills de Claude Code, Codex, Cursor o Gemini de la carpeta salen en el proyecto.",
      "Un agente nuevo en la carpeta del proyecto aparece al momento, sin volver a abrirlo.",
      "Las rutinas viajan apagadas: nada se ejecuta hasta que tú lo enciendas.",
    ],
  },
  "2.36.48": {
    en: [
      "Settings no longer cuts or squeezes names and descriptions, on any screen size.",
      "When a model list can't load, the reason now appears in your language.",
    ],
    es: [
      "Configuración ya no corta ni aplasta nombres ni descripciones, en ningún tamaño de pantalla.",
      "Cuando una lista de modelos no carga, el motivo aparece en tu idioma.",
    ],
  },
  "2.36.47": {
    en: [
      "External apps open faster and show their tab as soon as they are ready.",
      "Search in page and downloads are easy to find in external apps, with full file names.",
      "Switching language no longer leaves texts untranslated.",
    ],
    es: [
      "Las aplicaciones externas abren antes y muestran su pestaña en cuanto están listas.",
      "Buscar en la página y las descargas se encuentran fácil en las aplicaciones externas.",
      "Al cambiar de idioma ya no quedan textos sin traducir.",
    ],
  },
  "2.36.46": {
    en: [
      "The AI quotas bar now shows how much you have left, as a percentage.",
      "Codex no longer shows as disconnected when a check fails for a moment.",
      "AIs without a usage limit, like Kimi, no longer appear in the quotas bar.",
    ],
    es: [
      "La barra de Cuotas de IA ahora enseña cuánto te queda, en porcentaje.",
      "Codex ya no sale como desconectado cuando una comprobación falla un momento.",
      "Las IAs sin límite de uso, como Kimi, ya no aparecen en la barra de cuotas.",
    ],
  },
  "2.36.45": {
    en: [
      "Claude with your Pro or Max account now works in the Router, as the default model and for agents.",
      "If Claude cannot start, the next model in the Router answers instead.",
      "Errors when saving the Router are now clear and translated.",
    ],
    es: [
      "Claude con tu cuenta Pro o Max ya funciona en el Router, como modelo por defecto y en los agentes.",
      "Si Claude no puede arrancar, contesta el siguiente modelo del Router.",
      "Los errores al guardar el Router ahora son claros y en tu idioma.",
    ],
  },
  "2.36.44": {
    en: [
      "External sessions: CLI names are no longer squashed; Show what's left sits on its own line.",
      "CLIs that are not installed no longer show a usage switch.",
    ],
    es: [
      "Sesiones externas: el nombre de cada CLI ya no queda aplastado; Ver cuánto me queda va en su propia línea.",
      "Los CLI que no están instalados ya no muestran el interruptor de uso.",
    ],
  },
  "2.36.43": {
    en: [
      "Claude with your account gets an On switch like ChatGPT; when off, Colonia does not use it.",
      "The usage switch now says Show what's left and no longer sits glued to On.",
      "The account cards no longer cut their button on mid-size screens.",
    ],
    es: [
      "Motores y modelos: Claude con tu cuenta tiene interruptor Activo, como ChatGPT. Apagado, Colonia no lo usa.",
      "El interruptor de uso se llama Ver cuánto me queda y ya no va pegado a Activo.",
      "Las tarjetas de tu cuenta ya no cortan el botón en pantallas medianas.",
    ],
  },
  "2.36.42": {
    en: [
      "AI quotas include Claude: 5-hour session and weekly limit, what's left and when each renews.",
      "The top bar counts Claude too, and its button now says Manage AIs.",
      "Engines and models: With your account (recommended) first, With a key (advanced) folded below.",
    ],
    es: [
      "Las cuotas de IA incluyen a Claude: sesión de 5 horas y límite semanal, lo que queda y cuándo se renueva.",
      "La barra superior también cuenta a Claude, y su botón ahora dice Gestionar IAs.",
      "Motores y modelos: Con tu cuenta (recomendado) arriba y Con clave (avanzado) plegado debajo.",
    ],
  },
  "2.36.41": {
    en: [
      "Claude with your Pro or Max plan: press Connect, sign in on Claude's page and you're done, no keys to paste.",
      "If this computer doesn't have Claude Code yet, Colonia installs it for you.",
      "Every Claude card shows Claude's orange spark, and the custom service is now called Other AI service.",
    ],
    es: [
      "Claude con tu plan Pro o Max: pulsa Conectar, entra en la página de Claude y listo, sin pegar claves.",
      "Si el ordenador aún no tiene Claude Code, Colonia lo instala por ti.",
      "Las tarjetas de Claude llevan su chispa naranja, y el servicio propio se llama Otro servicio de IA.",
    ],
  },
  "2.36.40": {
    en: [
      "Services go by the names you know: Claude and ChatGPT, each saying if it uses your account or a key.",
      "The intelligence step drops the jargon; choosing which model goes first is folded away until you need it.",
      "Share › Publish fits on a phone: the publishing options wrap inside their card.",
    ],
    es: [
      "Los servicios se llaman Claude y ChatGPT, y cada tarjeta dice si va con tu cuenta o con clave.",
      "El paso de inteligencia habla claro; elegir qué modelo va primero queda plegado hasta que lo necesites.",
      "Compartir › Publicar cabe en el móvil: las opciones de publicación bajan de línea dentro de su tarjeta.",
    ],
  },
  "2.36.39": {
    en: [
      "Unpublishing one project keeps the temporary link up for your other published projects.",
      "The link closes only when no published project is left.",
      "Share › Publish advanced options read cleanly, and the IRC setup asks for its data on the right step.",
    ],
    es: [
      "Dejar de publicar un proyecto ya no apaga el enlace temporal de los demás publicados.",
      "El enlace solo se cierra cuando no queda ningún proyecto publicado.",
      "Las opciones avanzadas de Publicar se leen bien y el asistente de IRC pide sus datos en su paso.",
    ],
  },
  "2.36.38": {
    en: [
      "Colonia looks for a newer version every hour instead of every six, so updates arrive the same day.",
      "Each update check is noted in the update log, found or not.",
    ],
    es: [
      "Colonia busca una versión nueva cada hora en vez de cada seis, así que las novedades llegan el mismo día.",
      "Cada comprobación de actualizaciones queda apuntada en el registro, haya novedad o no.",
    ],
  },
  "2.36.37": {
    en: [
      "The first run now asks plain questions: is this your first time, or do you use it elsewhere?",
      "Already using Colonia on another computer? Link both or restore a backup from the start.",
      "The welcome title always reads clearly, and optional steps say: Skip, I'll do it later.",
    ],
    es: [
      "El primer arranque hace preguntas llanas: ¿es tu primera vez o ya la usas en otro sitio?",
      "¿Ya usas Colonia en otro ordenador? Enlaza los dos o recupera una copia desde el principio.",
      "El titular de bienvenida siempre se lee bien y los pasos opcionales dicen: Saltar, lo haré luego.",
    ],
  },
  "2.36.36": {
    en: [
      "Connecting Telegram, Discord, Slack and other bots is now a guide, one step per screen.",
      "Each step opens the right page and copies what you must paste there.",
      "At the end Colonia checks the connection and tells you plainly what to fix.",
    ],
    es: [
      "Conectar Telegram, Discord, Slack y otros bots es ahora una guía, un paso por pantalla.",
      "Cada paso abre la página que toca y copia lo que hay que pegar allí.",
      "Al final Colonia comprueba la conexión y te dice en claro qué corregir.",
    ],
  },
  "2.36.35": {
    en: [
      "Share a project with one click: Colonia creates a free temporary link.",
      "Tailscale, ngrok and your own address are now under Advanced options.",
      "Turning off Tailscale no longer shows an error when it was not publishing.",
    ],
    es: [
      "Comparte un proyecto en un clic: Colonia crea un enlace temporal gratis.",
      "Tailscale, ngrok y tu propia dirección pasan a Opciones avanzadas.",
      "Apagar Tailscale ya no da error cuando no estaba publicando.",
    ],
  },
  "2.36.34": {
    en: [
      'Closing Colonia no longer shows the "Object has been destroyed" error.',
      "On Windows, a downloaded update now goes in when you close Colonia.",
    ],
    es: [
      "Cerrar Colonia ya no muestra el error «Object has been destroyed».",
      "En Windows, la actualización descargada se instala al cerrar Colonia.",
    ],
  },
  "2.36.33": {
    en: [
      "Restoring a copy on Windows saves your passwords in one go and tells you if any was left out.",
      "Colonia now closes properly when the system asks it to.",
    ],
    es: [
      "Restaurar una copia en Windows guarda tus contraseñas de una vez y te avisa si faltó alguna.",
      "Colonia se cierra bien cuando el sistema se lo pide.",
    ],
  },
  "2.36.32": {
    en: ["Closing Colonia no longer shows an error about the menu-bar icon."],
    es: ["Cerrar Colonia ya no muestra un error sobre el icono de la barra de tareas."],
  },
  "2.36.31": {
    en: [
      "When the browser passes from one agent to another, the tabs you allowed stay allowed.",
      "Menus taller than the window now scroll inside, so every option can be reached.",
    ],
    es: [
      "Cuando el navegador pasa de un agente a otro, las pestañas que permitiste siguen permitidas.",
      "Los menús más altos que la ventana se desplazan por dentro y se llega a todas las opciones.",
    ],
  },
  "2.36.30": {
    en: [
      "Pairing computers now takes a short 8-character code, and Colonia finds the other one on your network.",
      "List order, project folders and the assistant's name stay right on each computer.",
      "If a computer changes address, they find each other again on their own.",
      "Saved versions survive unpairing, and large files resume where they left off.",
    ],
    es: [
      "Emparejar equipos pide un código corto de 8 caracteres y Colonia encuentra el otro en tu red.",
      "El orden de las listas, las carpetas de proyecto y el nombre del asistente se respetan en cada equipo.",
      "Si un equipo cambia de dirección, los dos se vuelven a encontrar solos.",
      "Las versiones guardadas sobreviven al desemparejar y los ficheros grandes siguen donde se quedaron.",
    ],
  },
  "2.36.29": {
    en: [
      "The project tree now shows at any window width, and you can't pick a project that would go in a circle.",
      "When importing, you see the projects Colonia can't find and can link them right there.",
      "Flows and their helpers use the knowledge of every project you picked.",
      "Packages with linked projects also open in earlier versions of Colonia.",
    ],
    es: [
      "El árbol de proyectos se ve en cualquier ancho y no deja elegir un proyecto que cerraría un círculo.",
      "Al importar, ves los proyectos que Colonia no encuentra y puedes enlazarlos ahí mismo.",
      "Los Flows y sus ayudantes usan el conocimiento de todos los proyectos elegidos.",
      "Los paquetes con proyectos enlazados también se abren en versiones anteriores de Colonia.",
    ],
  },
  "2.36.28": {
    en: [
      "New: pair two computers running Colonia with a code. Change the same thing on both and nothing is lost.",
      "Projects, agents, Flows, AIs, channels, apps and browsers stay the same on both computers.",
      "WhatsApp and the other single-session channels stay on one computer; the other one sees them.",
      "It is off until you turn it on in Settings › Sync computers.",
    ],
    es: [
      "Nuevo: empareja dos ordenadores con Colonia con un código. Si cambias lo mismo en los dos, nada se pierde.",
      "Proyectos, agentes, Flows, IAs, canales, aplicaciones y navegadores se mantienen iguales en los dos.",
      "WhatsApp y los demás canales de una sola sesión siguen en un equipo; el otro los ve.",
      "Está desactivado hasta que lo actives en Ajustes › Sincronizar equipos.",
    ],
  },
  "2.36.27": {
    en: [
      "New: a project can know other projects and look up what they know, without changing them.",
      "For example, project A can check what projects B and C know.",
      "Projects are now grouped as a tree in the sidebar.",
      "A Flow can use the knowledge of several projects at once.",
    ],
    es: [
      "Nuevo: un proyecto puede conocer a otros y consultar lo que saben, sin modificarlos.",
      "Por ejemplo, el proyecto A puede consultar lo que saben los proyectos B y C.",
      "Los proyectos se agrupan ahora en árbol en la barra lateral.",
      "Un Flow puede usar el conocimiento de varios proyectos a la vez.",
    ],
  },
  "2.36.26": {
    en: [
      "New: make a full, encrypted copy of Colonia to move it to another computer.",
      "When restoring, you see a summary of what the copy holds before anything changes.",
      "You choose: replace what is on this computer or merge the copy with it.",
      "Colonia tells you which accounts you need to link again on the new computer.",
    ],
    es: [
      "Nuevo: crea una copia completa y cifrada de Colonia para pasarla a otro ordenador.",
      "Al restaurar ves un resumen de lo que trae la copia antes de que cambie nada.",
      "Tú eliges: reemplazar lo que hay en este equipo o fusionarlo con la copia.",
      "Colonia te avisa de qué cuentas hay que volver a vincular en el equipo nuevo.",
    ],
  },
  "2.36.25": {
    en: [
      "Settings now works on narrow screens: a dropdown lets you jump between sections.",
      "The Channels tabs scroll sideways when they don't all fit.",
      "Outlook shows its own logo.",
      "Clearer wording: the bot's code, the service address and readable model names.",
    ],
    es: [
      "Ajustes ya se usa bien en pantallas estrechas: un desplegable te lleva de una sección a otra.",
      "Las pestañas de Canales se desplazan cuando no caben todas.",
      "Outlook aparece con su logo.",
      "Textos más claros: el código del bot, la dirección del servicio y nombres de modelo legibles.",
    ],
  },
  "2.36.24": {
    en: [
      "Sharing projects: it now also removes keys written as plain text and tells you how many it removed.",
      "Importing a project again doesn't erase your keys.",
      "On Linux, the update notice shows the exact command to install, with a Copy button.",
      "“Share project” no longer appears on the default project.",
    ],
    es: [
      "Compartir proyectos: ahora quita también claves escritas como texto y te avisa de cuántas quitó.",
      "Reimportar un proyecto no borra tus claves.",
      "En Linux, el aviso de actualización muestra la orden exacta para instalar con un botón Copiar.",
      "«Compartir proyecto» ya no aparece en el proyecto por defecto.",
    ],
  },
  "2.36.23": {
    en: [
      "Share a project with someone else on Colonia: export it to a file they import, or publish it with a link.",
      "Keys and conversations never travel; anything left to connect shows up as “Needs connecting”.",
    ],
    es: [
      "Comparte un proyecto con otra persona de Colonia: expórtalo a un fichero que ella importa, o usa un enlace.",
      "Nunca se llevan claves ni conversaciones; lo que haya que conectar aparece como «Falta conectar».",
    ],
  },
  "2.36.22": {
    en: [
      "When an agent asks for several approvals in a row and you're away, it no longer waits on each one.",
      "All the cards show up and you can approve them when you're back.",
    ],
    es: [
      "Si un agente pide varias aprobaciones seguidas y no estás, ya no se queda parado esperando cada una.",
      "Las tarjetas aparecen todas y puedes aprobarlas al volver.",
    ],
  },
  "2.36.21": {
    en: [
      "The setup assistant now takes four clear steps.",
      "Settings › Channels shows a card with each channel's logo and a single Connect or Fix button.",
      "Error messages tell you what to do next.",
    ],
    es: [
      "El asistente de instalación ahora son cuatro pasos claros.",
      "Ajustes › Canales muestra una tarjeta con el logo de cada canal y un solo botón Conectar o Arreglar.",
      "Los mensajes de error dicen qué hacer a continuación.",
    ],
  },
  "2.36.20": {
    en: [
      "The cursor now moves reliably.",
      "In Settings › Desktop you choose whether it works live or in the background, or have it ask.",
      "Export a chat as a .md recipe; anyone with Colonia imports it with “+ Skill” › Recipe and repeats it.",
    ],
    es: [
      "El cursor se mueve de forma fiable.",
      "En Ajustes › Escritorio eliges si lo hace en vivo o en segundo plano, o que pregunte.",
      "Exporta un chat como receta .md; otra persona con Colonia la importa con «+ Skill» › Receta y la repite.",
    ],
  },
  "2.36.19": {
    en: [
      "Saving a key no longer wipes the others when the secrets file was edited by hand or cut short.",
      "Updates install in user folders with accented or non-Latin names on Windows.",
      "The Windows installer works on ARM computers.",
    ],
    es: [
      "Guardar una clave ya no borra las demás si el fichero de secretos se editó a mano o quedó cortado.",
      "Las actualizaciones se instalan en carpetas de usuario con tildes o letras no latinas en Windows.",
      "El instalador de Windows funciona en equipos ARM.",
    ],
  },
  "2.36.18": {
    en: ["Tabs show the channel's logo (WhatsApp, Telegram, email…)."],
    es: ["Las pestañas muestran el logo del canal (WhatsApp, Telegram, correo…)."],
  },
  "2.36.17": {
    en: [
      "Replies start faster: the conversation's history is read once per turn, not per message.",
      "The app opens lighter: texts for screens you don't see at first load afterwards.",
    ],
    es: [
      "Las respuestas arrancan antes: el historial de la conversación se lee una vez por turno, no por mensaje.",
      "La app abre más ligera: los textos de pantallas que no ves al principio se cargan después.",
    ],
  },
  "2.36.16": {
    en: [
      "The + menu in Channels always lists every channel, so you can add a second or third account of the same one.",
      "Matrix connects with the bot's user and password, and email with its address and password.",
      "Telegram finds the code in whatever you paste, Discord gives the invite link and ntfy picks its topic.",
    ],
    es: [
      "El menú + de Canales muestra siempre todos los canales, para añadir una segunda o tercera cuenta del mismo.",
      "Matrix se conecta con usuario y contraseña del bot, y el correo con su dirección y contraseña.",
      "Telegram encuentra el código en lo que pegues, Discord da el enlace de invitación y ntfy elige su tema.",
    ],
  },
  "2.36.15": {
    en: ["When the computer wakes up, WhatsApp reconnects by itself instead of showing an error."],
    es: ["Al despertar el ordenador, WhatsApp se reconecta solo en vez de mostrar un error."],
  },
  "2.36.14": {
    en: [
      "Connecting Slack takes three steps: one button creates the app already set up, then you paste its two codes.",
      "Every channel's first step now has a button that opens the right page.",
    ],
    es: [
      "Conectar Slack son tres pasos: un botón crea la app ya configurada y luego pegas sus dos códigos.",
      "El primer paso de cada canal tiene un botón que abre la página que toca.",
    ],
  },
  "2.36.13": {
    en: ["Opening an app on a connected Windows computer works again, and so do its screenshots."],
    es: ["Abrir una app en un equipo Windows conectado vuelve a funcionar, y también sus capturas de pantalla."],
  },
  "2.36.12": {
    en: [
      "The + under Browsers now offers to install the ones you lack: Chrome, Edge, Firefox, Brave, Opera, Vivaldi.",
      "On a connected computer, agents open apps on the visible desktop, see its screen and click or type there.",
      "Colonia loads faster, refreshes less in the background and keeps running after an unexpected error.",
    ],
    es: [
      "El + de Navegadores ofrece instalar los que te faltan: Chrome, Edge, Firefox, Brave, Opera y Vivaldi.",
      "En un equipo conectado, los agentes abren apps en su pantalla, la ven y hacen clic o escriben en ella.",
      "Colonia carga más rápido, consulta menos en segundo plano y sigue en pie ante un error inesperado.",
    ],
  },
  "2.36.11": {
    en: [
      "The built-in browser plays videos full screen, downloads files, finds text with Ctrl+F and zooms.",
      "A page that does not load now says why, with a button to try again; a right click offers the usual options.",
      "Each group in a project's chat tree folds away with its arrow, and keeps showing its unread chats.",
      "Picking a computer under My computers takes you to its card and lights it up.",
    ],
    es: [
      "El navegador integrado pone vídeos a pantalla completa, descarga archivos, busca con Ctrl+F y hace zoom.",
      "Si una página no carga, ahora dice por qué y ofrece reintentar; el botón derecho trae las opciones de siempre.",
      "Cada grupo del árbol de chats de un proyecto se pliega con su flecha y sigue mostrando sus chats sin leer.",
      "Al elegir un equipo en Mis equipos, la pantalla va a su tarjeta y la ilumina.",
    ],
  },
  "2.36.10": {
    en: ["Silenced chats in a channel no longer look greyed out, and every chat is listed by its last message."],
    es: ["Los chats silenciados de un canal ya no salen en gris, y todos se ordenan por su último mensaje."],
  },
  "2.36.9": {
    en: [
      "WhatsApp keeps every one-to-one chat, yours and theirs, in order by when each message was written.",
      "Chat tabs are always above the chat, like an editor: a click opens a chat in its own tab.",
      "The browser no longer goes blank: new tabs, bookmarks and searches work, and many bookmarks fit in one row.",
    ],
    es: [
      "WhatsApp guarda todos los chats individuales, tuyos y suyos, ordenados por la hora de cada mensaje.",
      "Las pestañas de chat están siempre arriba, como en un editor: un clic abre el chat en su pestaña.",
      "El navegador ya no se queda en blanco: pestañas nuevas, marcadores y búsquedas funcionan.",
    ],
  },
  "2.36.8": {
    en: [
      "Chats open in tabs: Ctrl-click or middle-click a chat, or use its menu, and move between them above the chat.",
      "Tabs can be reordered by dragging, and come back when you reopen Colonia.",
    ],
    es: [
      "Los chats se abren en pestañas: Ctrl+clic, clic central o desde su menú, y se cambia entre ellas arriba.",
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
      '"My computers" opens Colonia to your network right there when the command was missing.',
      'The external sessions section is now called "AIs" and has a + to add another one.',
    ],
    es: [
      "La lista de chats y cada agente del árbol de la Inbox se pliegan con un clic y se quedan así.",
      "«Mis equipos» abre Colonia a tu red ahí mismo cuando faltaba el comando.",
      "Las sesiones externas ahora se llaman «IAs» y tienen un + para añadir otra.",
    ],
  },
  "2.35.0": {
    en: [
      'New "My computers": use your other laptops from this Colonia, with your approval each time.',
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
