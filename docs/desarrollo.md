# Desarrollo

Requiere Node 24.11 o superior y pnpm 11.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm app        # compila y abre la aplicación
corepack pnpm dev        # solo el servicio, en 127.0.0.1:7440
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/core` | El servicio: estado, agentes, canales y rutinas |
| `apps/web` | El panel |
| `apps/desktop` | La aplicación de escritorio (Electron) |
| `apps/terminal` | El comando `colonia` |
| `apps/docs` | La web pública |
| `packages/protocol` | El contrato entre el servicio y sus clientes |
| `packages/ui` | Componentes e imágenes compartidos |
| `scripts/penguins` | Generador de los pingüinos |

## Comprobaciones

```bash
corepack pnpm preflight  # tipos, estilo y pruebas
corepack pnpm verify     # lo anterior y las pruebas de extremo a extremo
```

## Generar los instaladores

```bash
corepack pnpm package        # el del sistema actual
corepack pnpm package:win
corepack pnpm package:linux
corepack pnpm package:mac
```

Los archivos quedan en `out/`. Para que macOS y Windows no muestren avisos de seguridad, firma los instaladores con tus propios certificados.

## Personalizar los pingüinos

Edita `scripts/penguins/art.mjs` y regenera:

```bash
node scripts/penguins/generate.mjs
node scripts/penguins/check.mjs
```
