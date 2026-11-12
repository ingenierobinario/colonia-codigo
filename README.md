# Colonia

**Tu propio equipo de agentes de IA, en tu ordenador.** Un producto de [Ingeniero Binario](https://colonia.ingenierobinario.com).

Colonia reúne en una sola aplicación a una secretaria que te contesta donde estés y un equipo de agentes por proyecto, cada uno con su papel, su memoria y sus herramientas. Funciona en Windows, Linux y macOS, y tus datos se quedan en tu máquina. La IA la pones tú: conectas tu suscripción o tu clave y el coste lo pagas directamente a tu proveedor.

## Documentación

| Guía | Para qué sirve |
|---|---|
| [Primeros pasos](docs/primeros-pasos.md) | Instalar la aplicación y crear tu primer equipo |
| [Conceptos](docs/conceptos.md) | Qué es cada pieza: agentes, proyectos, canales, rutinas |
| [Canales](docs/canales.md) | Hablar con tus agentes desde WhatsApp, Telegram y otras aplicaciones |
| [Terminal](docs/terminal.md) | Los comandos de `colonia` |
| [Desarrollo](docs/desarrollo.md) | Compilar, modificar y empaquetar el código |

## Empezar desde el código

Necesitas Node 24.11 o superior y pnpm 11.

Con Node 25 o posterior, corepack ya no viene incluido: instálalo una vez con `npm i -g corepack` o usa Node 24 LTS.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm app
```

Ese comando compila el panel y la aplicación de escritorio, arranca el servicio y abre la aplicación.

## Tu código, a tu medida

Tienes el código completo para modificarlo o integrarlo en tu negocio. Empieza por [Desarrollo](docs/desarrollo.md).

## Licencia

MIT. Consulta [`LICENSE`](LICENSE), que debe conservarse en las copias del software.
