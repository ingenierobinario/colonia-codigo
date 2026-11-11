# Iconos de escritorio

Todos salen de `scripts/penguins/` (`node scripts/penguins/generate.mjs`): SVG propios, sin imágenes incrustadas. El favicon web es el pingüino a color, con fondo transparente; sólo el icono de Dock lleva losa oscura.

- `logo-green.svg`, `logo-white.svg`: figura plana de una tinta, transparente.
- `logo-dock.svg`: pingüino sobre losa; fuente de `icon.png` (1024 × 1024).
- `trayTemplate.svg`: negro y transparente; macOS tiñe sus PNG según la barra de menús.
- `tray-color.svg`: color de marca, transparente, para Windows y Linux.
- `*-attention.svg`: la misma figura con un punto naranja (`#ff9500`) arriba a la derecha, separado por un recorte transparente. macOS usa figura negra en `trayTemplate-attention` para modo claro y blanca en `tray-white-attention` para oscuro; no son plantillas, para que el naranja sobreviva al tinte.

Tray PNGs are rasterized at 22 × 22 and 44 × 44 (`@2x`). Electron uses these native representations; SVGs remain the editable vector sources. Regenerate with `node scripts/tray-icons.ts` (uses the existing Playwright Chromium). On Windows the tray uses `tray-color.ico` and `tray-color-attention.ico` (16, 20, 24, 32, 40 and 48 px PNG entries, from the same script), so each display scale gets a sharp entry. The desktop build copies the PNG and SVG icon assets and those two `.ico` files into `dist`. Notification state selects the normal or attention image. On macOS, the native tray title places the count beside the icon in the system's color, using monospaced digits. The title and Dock badge cap at `99+` and clear at zero; the tooltip keeps the full count.

## File icons

`file-coloniaart.webp`, `file-coloniaapp.webp` and `file-coloniaext.webp` are the document icons for the files Colonia opens: an open box for artifacts (blue-green), a page with an app grid for marketplace apps (violet), a page with a puzzle piece for extensions (green). They are the editable sources (1254 × 1254, transparent). `electron-builder.json` registers the three types with them (`fileAssociations`, plus `UTExportedTypeDeclarations` on macOS). Regenerate the `.png`, `.ico` and `.icns` with `node scripts/file-icons.ts` (the `.icns` needs macOS's `iconutil`).
