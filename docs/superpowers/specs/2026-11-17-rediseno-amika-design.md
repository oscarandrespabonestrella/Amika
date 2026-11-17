# Rediseño Amika (artefacto "Amika redesign") — diseño corto

Fecha: 2026-11-17 · Tamaño: proyecto por tandas, sin cambios de datos ni de lógica de negocio.

## Intención
Refinar el aspecto de las vistas antes de la Fase 8b siguiendo el artefacto de claude design "Amika redesign" (13 pantallas + kit de componentes), sin regresiones funcionales.

## Metas
- Tokens, tipografía, logo, shell y navegación según el artefacto.
- Reutilizar los componentes existentes (`GameCard`, `EmptyState`, `Button`, `Badge`, `Command`, `Popover`, `NativeSelect`, feature panels); añadir solo los primitivos shadcn que falten (Sheet, Dialog, Tabs, DropdownMenu, Skeleton, Sonner) cuando una pantalla los necesite.
- Mantener la portada real de cada juego (`coverUrl`, respaldo: icono de dados). Los cuadros de color del artefacto NO se usan.

## No metas
- Sin cambios en la BD, acciones de servidor, RLS ni rutas de datos.
- Sin eliminar el modo claro ni la i18n (en/es).

## Decisiones del usuario (2026-11-17)
1. **Navegación:** seguir el artefacto: Home · Library · [+ Log] · Stats · People; Settings pasa al menú del avatar.
2. **Tema/logo:** oscuro por defecto con paleta del artefacto; modo claro se mantiene. `public/Logo_Dark.png` en oscuro; en claro, meeple SVG + wordmark de texto.
3. **Alcance:** por tandas; tests pesados (e2e) solo al cerrar cada tanda.

## Tandas
1. **Base:** tokens (`globals.css`), fuentes (Geist + Nunito para el wordmark), `Brand`, `AppShell`, `AppNav` (botón central Log, People, avatar con DropdownMenu, `padding-bottom` = barra + safe-area), kit de primitivos.
2. **Home, Library, Discover/catálogo, Game detail.**
3. **Log match, Stats, People, Settings, Landing, Sign-in, Create game.**

## Mis llamadas (a confirmar al revisar)
- "People" agrupa Friends y Players en una sola pantalla con Tabs; las rutas `/friends` y `/players` se conservan (la nav apunta a `/friends` con `also: ["/players"]`) para no romper enlaces ni e2e.
- Botón central "Log": enlaza a un selector de juego/flujo existente de nueva partida (no hay ruta global hoy; se resuelve en la tanda 1 reutilizando `/games/[id]/plays/new`).
- El PNG del logo tiene ruido en las letras; se usa tal cual y se avisa si se ve mal a tamaño pequeño (alternativa: wordmark SVG/texto).
- Rutas e2e y textos i18n que cambien se ajustan en la misma tanda.

## Enfoques considerados
- A) Reescribir cada vista copiando el HTML del artefacto: rápido, pero duplica estilos y rompe i18n/componentes. Descartado.
- B) **Elegido:** ajustar tokens + shell + componentes compartidos, y luego adaptar cada página reutilizando lo existente.
- C) Solo tokens: demasiado corto, no cubre nav ni layouts.
