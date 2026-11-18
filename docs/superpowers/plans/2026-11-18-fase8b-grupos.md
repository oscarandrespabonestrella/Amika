# Fase 8b — Grupos de jugadores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardar grupos de jugadores del roster propio y añadirlos a una partida con un clic.

**Architecture:** Dos tablas nuevas (`player_groups`, `player_group_members`) con RLS por dueño, un módulo `src/features/groups` que copia el patrón de `src/features/players` (servicio → acciones con zod → componentes) y una pestaña «Grupos» en People. El formulario de partida recibe `groups` y rellena filas con una función pura; el grupo nunca se modifica desde la partida.

**Tech Stack:** Next.js (leer `node_modules/next/dist/docs/` antes de tocar rutas, ver AGENTS.md), Supabase/Postgres + RLS, Clerk (`current_user_id()`), next-intl (en/es/fr), zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-fase8b-grupos-design.md`

## Global Constraints

- Grupos **privados** del dueño; sin invitaciones, roles ni compartir (spec, no objetivos).
- Nombre de grupo: 1–60 caracteres, único por dueño tras `public.normalize_player_name`.
- Un jugador puede estar en varios grupos; miembros = jugadores del **mismo dueño**, comprobado en la base de datos.
- Elegir un grupo **añade los miembros que faltan**, sin duplicar ni reemplazar filas; no modifica el grupo; sin aviso por máximo de jugadores del juego.
- Sin estadísticas por grupo ni guardar el grupo en la partida.
- Errores de esquema = códigos estables (`required`, `tooLong`…); la interfaz los traduce. Catálogos `en`, `es`, `fr` con las mismas claves (`src/i18n/messages.test.ts`).
- Commits **sin** `Co-Authored-By` ni `Claude-Session` (regla del proyecto). Las suites pesadas (integración, e2e) se corren **solo al cerrar la fase** (Task 5).
- Migraciones: nombre `20261118100000_player_groups.sql` (la última existente es `20261117162000`).

## Review Focus

- Borrar un jugador que es miembro de un grupo: el grupo sigue, sin ese miembro (cascade).
- Fusionar jugadores: los miembros del absorbido pasan al conservado sin duplicar si ya estaban ambos en un grupo.
- Grupo vacío: «Añadir grupo» no hace nada y no rompe el formulario; se puede crear vacío.
- Añadir un grupo cuando ya hay filas vacías (nombre vacío, sin `playerId`): las usa antes de crear filas nuevas.
- Usuario B no puede ver, editar ni añadir a su grupo jugadores de A (RLS y trigger de mismo dueño).

---

### Task 1: Migración, RLS y `merge_players`

**Files:**
- Create: `supabase/migrations/20261118100000_player_groups.sql`
- Create: `tests/integration/rls-player-groups.test.ts`
- Modify (vía `create or replace`, copiando la versión de `20261117161000_identity_follows_roster.sql`): `public.merge_players`

**Interfaces:**
- Produces: tablas `public.player_groups(id uuid pk, owner_id text, name text, created_at, updated_at)` y `public.player_group_members(group_id uuid, player_id uuid, primary key (group_id, player_id))`; índice único `(owner_id, normalize_player_name(name))`.

- [ ] **Step 1: Escribir el test de integración** `tests/integration/rls-player-groups.test.ts` (mismo andamiaje `withRole`/`fixtures` que `rls-players.test.ts`, usuarios A y B, jugadores `Ana`,`Bo` de A y `Ana` de B). Casos, con nombre y aserción:
  - `owner sees only own groups`: A ve su grupo «Jueves»; B ve 0.
  - `anon sees nothing`.
  - `group name is unique per owner after normalization`: insertar «jueves » falla con código `23505`; B puede crear «Jueves».
  - `a member must be a player of the same owner`: A añade el jugador de B a su grupo → error (no se inserta).
  - `B cannot add members to A's group`: error / 0 filas.
  - `deleting a player removes only the membership`: tras borrar `Bo` (sin partidas), el grupo existe y los miembros son solo `Ana`.
  - `deleting a group keeps the players`.
  - `merge_players moves memberships without duplicating`: grupo con ambos → tras `merge_players(keep=Ana, remove=Bo)` queda un único miembro `Ana`; otro grupo solo con `Bo` ahora contiene `Ana`.
  - `caps`: más de 50 grupos por dueño y más de 200 miembros por grupo → error `P0001`.
- [ ] **Step 2: Ejecutar para verlo fallar**

Run: `npm run test:integration -- rls-player-groups`
Expected: FAIL (tablas inexistentes). Si no hay base de datos configurada, el archivo se omite: configurar antes `SUPABASE_DB_PASSWORD`/enlace como los demás tests de integración.
- [ ] **Step 3: Escribir la migración.** Seguir el estilo de `20261116170000_players.sql`: `owner_id text not null default public.current_user_id() references public.profiles(id) on delete cascade`, `check (char_length(name) between 1 and 60)`, `check (normalize_player_name(name) <> '')`, trigger `set_updated_at`, RLS habilitada con políticas `using/with check (owner_id = public.current_user_id())` y `grant` solo a `authenticated`. En `player_group_members`: FKs `on delete cascade` a ambas tablas; política que exige que el grupo sea del usuario **y** que `player_id` pertenezca al mismo dueño (trigger `before insert or update` que compara `players.owner_id` con `player_groups.owner_id`, o `with check` con `exists`). Topes con triggers `before insert` como `enforce_player_cap` (50 grupos por dueño, 200 miembros por grupo, `errcode 'P0001'`). Reemplazar `merge_players` añadiendo, antes del `delete from public.players`: mover `player_group_members` del removido al conservado con `on conflict do nothing`.
- [ ] **Step 4: Aplicar la migración** al proyecto enlazado (`supabase db push`; revisar el diff antes, es la base compartida) y regenerar tipos: `npm run db:types`.
- [ ] **Step 5: Ejecutar el test de integración**

Run: `npm run test:integration -- rls-player-groups rls-players`
Expected: PASS (incluido `rls-players`, que ejercita `merge_players`).
- [ ] **Step 6: Commit** `feat(groups): tablas de grupos de jugadores con RLS y fusión de miembros`

---

### Task 2: Módulo `groups` (esquemas, servicio, acciones, lógica de relleno)

**Files:**
- Create: `src/features/groups/{index.ts,client.ts,schemas.ts,fill.ts,services/group-service.ts,actions/group-actions.ts}`
- Test: `src/features/groups/schemas.test.ts`, `src/features/groups/fill.test.ts`

**Interfaces:**
- Produces (`schemas.ts`): `GROUP_NAME_MAX = 60`; `createGroupSchema = z.strictObject({ name })`; `renameGroupSchema = { groupId: uuid, name }`; `groupIdSchema = z.uuid()`; `setMembersSchema = { groupId: uuid, playerIds: z.array(z.uuid()).max(200) }` (sin repetidos). Nombre: mismos códigos que `playerNameSchema` (`required`, `tooLong`).
- Produces (`group-service.ts`, `server-only`): `type Group = { id: string; name: string; members: { id: string; name: string }[] }`; `listGroups(): Promise<Group[]>` (RLS, orden por nombre); `createGroup(name): Promise<{ outcome: "ok"; id: string } | { outcome: "exists" }>`; `renameGroup(id, name): "ok"|"exists"|"not_found"`; `deleteGroup(id): "ok"|"not_found"`; `setGroupMembers(id, playerIds): "ok"|"not_found"` (reemplaza el conjunto: borra los que sobran, inserta los nuevos). Códigos Postgres como en `player-service.ts` (`23505` → `exists`).
- Produces (`group-actions.ts`): acciones `createGroupAction`, `renameGroupAction`, `deleteGroupAction`, `setGroupMembersAction` con el mismo marco `run(...)` y tipo de resultado que `player-actions.ts` (`unauthenticated | invalid | not_found | exists | failed`); `revalidatePath("/", "layout")`.
- Produces (`fill.ts`, pura, apta para cliente): `type FillRow = { playerId: string | null; name: string }` y `groupFill(rows: readonly FillRow[], members: readonly { id: string; name: string }[]): { fillIndexes: { rowIndex: number; member: { id: string; name: string } }[]; append: { id: string; name: string }[] }` — omite miembros ya presentes (por `playerId`), usa primero las filas vacías (`name.trim() === "" && playerId === null`) en orden y el resto va a `append`.

- [ ] **Step 1: Escribir tests** — `schemas.test.ts`: nombre vacío → `required`, 61 caracteres → `tooLong`, `setMembersSchema` rechaza ids repetidos y no-uuid. `fill.test.ts`: (a) filas `[vacía, vacía]` + 3 miembros → rellena 0 y 1, `append` el tercero; (b) miembro ya presente por `playerId` no se repite; (c) fila con nombre escrito pero sin `playerId` no se considera vacía; (d) grupo vacío → `{ fillIndexes: [], append: [] }`; (e) todas las filas ya contienen a todos → nada.
- [ ] **Step 2: Ejecutar** `npx vitest run src/features/groups` — Expected: FAIL.
- [ ] **Step 3: Implementar** `schemas.ts` y `fill.ts` (sin dependencias de servidor).
- [ ] **Step 4: Ejecutar** `npx vitest run src/features/groups` — Expected: PASS.
- [ ] **Step 5: Implementar** servicio y acciones siguiendo `src/features/players/services/player-service.ts` y `actions/player-actions.ts`; `listGroups` usa `.from("player_groups").select("id, name, player_group_members(players(id, name))")`. `index.ts` exporta el lado servidor (`listGroups`, `type Group`, componentes) y `client.ts` lo que necesita un componente cliente (`groupFill`, tipos), como `src/features/players/client.ts`.
- [ ] **Step 6: Commit** `feat(groups): esquemas, servicio, acciones y relleno de grupos`

---

### Task 3: Pestaña «Grupos» en People

**Files:**
- Create: `src/app/[locale]/(app)/groups/page.tsx`, `src/features/groups/components/groups-manager.tsx`
- Modify: `src/components/layout/people-tabs.tsx` (3 pestañas: `grid-cols-3`, `max-w-md`), `src/components/layout/app-nav.tsx:21` (añadir `/groups` a `also` de `people`), `src/i18n/messages/{en,es,fr}.json` (`People.groups` y bloque `Groups`)
- Test: cubierto por `messages.test.ts` y el E2E del Task 5

**Interfaces:**
- Consumes: `listGroups`, `Group`, acciones del Task 2; `listPlayers`, `Player` de `@/features/players`.
- Produces: ruta `/groups`; `GroupsManager({ groups: Group[], players: Player[] })` (cliente).

- [ ] **Step 1: Leer** la guía de Next en `node_modules/next/dist/docs/` para páginas/params de esta versión y replicar `src/app/[locale]/(app)/players/page.tsx` (mismo `PeopleTabs`, `EmptyState`, `setRequestLocale`).
- [ ] **Step 2: Implementar `GroupsManager`**, tomando `players-manager.tsx` como referencia de estilo y accesibilidad: lista de grupos con nombre y nº de miembros; crear (campo + botón), renombrar, borrar con confirmación, y editar miembros con casillas de verificación sobre el roster (guardar llama a `setGroupMembersAction`). Mostrar los códigos de error traducidos (`exists`, `required`, `tooLong`, `failed`). Estado vacío: sin jugadores → enlazar a `/players`; sin grupos → texto explicativo. Controles táctiles de ≥44 px (como `iconButton` en `play-form.tsx`).
- [ ] **Step 3: Añadir** textos `Groups.*` y `People.groups` en `en.json`, `es.json` («Grupos»), `fr.json` («Groupes»).
- [ ] **Step 4: Verificar** `npx vitest run src/i18n` y `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(groups): pestaña Grupos en People`

---

### Task 4: «Añadir grupo» en el formulario de partida

**Files:**
- Modify: `src/features/plays/components/play-form.tsx` (prop `groups`, botón/menú junto al encabezado `players-title`, ~línea 395), `src/app/[locale]/(app)/games/[id]/plays/new/page.tsx`, `src/app/[locale]/(app)/games/[id]/plays/[playId]/page.tsx` (cargar `listGroups()` y pasar `groups`), `src/i18n/messages/{en,es,fr}.json` (`Plays.form.addGroup`, `addGroupNone`)
- Test: cubierto por `fill.test.ts` (lógica) y E2E del Task 5

**Interfaces:**
- Consumes: `groupFill`, `Group` (de `@/features/groups/client`), `newRow(name, values, manual, playerId)` y `setRows` existentes en `play-form.tsx`.
- Produces: prop `groups: Group[]` en `PlayForm`.

- [ ] **Step 1: Implementar** un selector «Añadir grupo» (un popover/menú con los grupos y su nº de miembros; oculto si `groups.length === 0`). Al elegir: llamar `groupFill(rows.map(({playerId,name}) => ({playerId,name})), group.members)`; poner `playerId`/`name` en las filas indicadas por `fillIndexes` y añadir `newRow` para `append`. No marcar filas como `touched`. No llamar a ninguna acción del grupo.
- [ ] **Step 2: Cargar `groups`** en las dos páginas con `Promise.all` junto a lo que ya consultan.
- [ ] **Step 3: Verificar** `npm run typecheck && npm run lint && npx vitest run src/features` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(plays): añadir un grupo de jugadores a la partida con un clic`

---

### Task 5: E2E, documentación y cierre de fase

**Files:**
- Create: `tests/e2e/app-groups.spec.ts` (copiar el esqueleto de `tests/e2e/app-players.spec.ts`; elegir el siguiente `PREFIX` libre con `grep -rn "const PREFIX" tests/e2e`)
- Modify: `docs/DECISIONS.md` (ADR-044), `docs/ROADMAP.md` (8b hecha; estadísticas por grupo pendientes), `docs/DATABASE.md` (tablas), `docs/SECURITY.md` (RLS de grupos), `src/i18n` si falta algo

- [ ] **Step 1: Escribir el E2E** con estas pruebas: (1) crear grupo «Jueves» con dos jugadores desde `/groups`; (2) abrir «registrar partida» de un juego, escribir un jugador a mano (sin `playerId`) en la fila 1, elegir «Jueves» y comprobar que el jugador ya presente no se duplica y los demás entran; (3) quitar un miembro de la partida y comprobar en `/groups` que el grupo sigue con todos; (4) renombrar y borrar el grupo. Verificar accesibilidad con `AxeBuilder` como en `app-players.spec.ts`.
- [ ] **Step 2: Documentar** ADR-044 (qué, por qué tablas propias frente a lista de ids/etiqueta, consecuencias) y actualizar ROADMAP, DATABASE y SECURITY.
- [ ] **Step 3: Cierre de fase — correr las suites pesadas** (regla de tests al final)

Run: `npm run typecheck && npm run lint && npm test && npm run test:integration && npx playwright test app-groups app-players app-plays`
Expected: todo PASS. Si algo falla, parar y diagnosticar antes de seguir.
- [ ] **Step 4: Commit** `test(e2e): grupos de jugadores` y `docs: ADR-044 grupos de jugadores`
