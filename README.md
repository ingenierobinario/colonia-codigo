# Colonia

**Tu propio equipo de agentes de IA, con los datos de tu negocio.** Un producto de Ingeniero Binario.

Colonia parte de [APX](https://github.com/agentprojectcontext/apx) (licencia MIT). El aviso original se conserva en `LICENSE` y el origen exacto en `NOTICE`.

## Desarrollo

Requiere Node 24.11 o superior y pnpm 11.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm -r --if-present typecheck
```

## Telemetría

Desactivada por defecto. Solo se envía si `APX_TELEMETRY` indica un destino propio.

## Estado de la adaptación

Hecho: nombre visible en la aplicación, enlaces a este repositorio, fuente de actualizaciones y telemetría.

Pendiente: iconos binarios (PNG, ICO, ICNS), documentación en `apps/docs`, comando `apx`, paquetes `@apx/*` y variables `APX_*`.
