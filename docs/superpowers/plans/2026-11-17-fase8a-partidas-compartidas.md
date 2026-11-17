# Fase 8a — Amigos y partidas compartidas: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amigos por enlace y partidas compartidas en directo (cada uno escribe su columna, el dueño cierra), con vinculación posterior de nombres a usuarios, «Jugadas en casa de otros» y borrado que traspasa la partida.

**Architecture:** Mismas tablas de partidas (`plays`, `play_participants`, `play_scores`) con un dueño actual (`owner_id`), un estado (`open|closed`) y una tabla de miembros (`play_members`). RLS pasa de «solo el creador» a «dueño o miembro aceptado». Las operaciones delicadas son funciones SQL `security definer` con comprobaciones propias; el directo usa Supabase Realtime (`postgres_changes`) con el cliente de navegador que ya existe, más una lectura periódica de respaldo.

**Tech Stack:** Next.js (versión con cambios: leer `node_modules/next/dist/docs/` antes de tocar rutas/acciones), Clerk, Supabase (RLS, Realtime), Zod, next-intl (en/es/fr), Vitest, Playwright, `pg` para tests RLS.

**Spec:** `docs/superpowers/specs/2026-11-17-fase8a-partidas-compartidas-design.md`

## Global Constraints
- Todo acceso del usuario pasa por RLS; el cliente nunca decide totales, orden ni ganador (`src/features/plays/compute.ts`, en el servidor al cerrar).
- Tope de 12 participantes por partida; 100 amigos; 10 enlaces activos; 30 invitaciones a partidas por usuario y día.
- Enlace de amistad: un solo uso, caduca a los 7 días, revocable. Amistad en los dos sentidos al abrirlo.
- Solo juegos del **catálogo** (`games.owner_id is null`) se pueden compartir; los manuales siguen privados.
- Sin buscador de usuarios; un amigo solo expone nombre visible y avatar (función `list_friends`, nunca `profiles` entero).
- Textos en `en`, `es` y `fr` (regla anti-literales); fechas absolutas en docs.
- **Política de tests del usuario**: se escriben con cada tarea, pero las suites completas (`npm test`, `npm run test:integration`, `npm run e2e`) **solo se ejecutan en la tarea 12**. En las demás: `npm run typecheck` y el test concreto de la tarea. Excepción acordada en el diseño: el spike (tarea 1) y la RLS «extraño no ve nada» (tarea 2) se comprueban pronto.
- Las migraciones se aplican al proyecto Supabase único (dev = el que usa Vercel): cada migración debe ser **aditiva e idempotente en datos** y probada en transacción revertida antes de `supabase db push`.

## Review Focus
1. Un **extraño** (ni miembro ni invitado) no lee ni una fila de una partida compartida, ni por Realtime. → tarea 2 y 1.
2. Un **invitado sin aceptar** no ve participantes ni puntos, solo la invitación. → tarea 2 y 4.
3. `save_play` del dueño sobre una partida abierta **no borra los puntos** que ya escribió un invitado. → tarea 5.
4. Borrar la partida o la **cuenta** del dueño no destruye partidas con otros miembros aceptados. → tarea 6.
5. Estadísticas de un invitado incluyen la partida compartida aunque no pueda leer `players` del dueño. → tarea 7.

---

## File Structure
- `supabase/migrations/20261117100000_sharing_schema.sql` — columnas, tablas, backfill, caps, Realtime.
- `supabase/migrations/20261117110000_sharing_rls.sql` — helpers y políticas RLS nuevas.
- `supabase/migrations/20261117120000_friends.sql` — amigos, enlaces, `list_friends`.
- `supabase/migrations/20261117130000_play_invites.sql` — invitaciones, vinculación, salir.
- `supabase/migrations/20261117140000_save_play_shared.sql` — `save_play` no destructivo, `close_play`, `save_my_scores`.
- `supabase/migrations/20261117150000_play_delete_transfer.sql` — `delete_play`, traspaso en borrado de cuenta.
- `supabase/migrations/20261117160000_stats_shared.sql` — estadísticas por identidad de participante.
- `src/features/friends/` — `schemas.ts`, `services/friends-service.ts`, `actions/friend-actions.ts`, `components/*`.
- `src/features/plays/` — `services/sharing-service.ts`, `actions/sharing-actions.ts`, `live/merge-play-state.ts`, `live/use-live-play.ts`, `components/live-play.tsx`, `components/invites-inbox.tsx`.
- `src/app/[locale]/(app)/friends/page.tsx`, `.../friends/join/[code]/page.tsx`, `.../invites/page.tsx`, `.../plays/elsewhere/page.tsx`, `.../games/[id]/plays/[playId]/live/page.tsx`.
- Tests: `tests/integration/rls-play-sharing.test.ts`, `tests/integration/friends.test.ts`, `tests/integration/play-invites.test.ts`, `tests/e2e/app-shared-plays.spec.ts`, unitarias junto a cada módulo.

---

### Task 1: Spike de Realtime con Clerk y RLS
**Files:** Create `scripts/realtime-spike.mts`; Create `supabase/migrations/20261117095000_realtime_publication.sql`.
**Interfaces:** Produces: la publicación `supabase_realtime` incluye `plays`, `play_participants`, `play_scores`, `play_members` (esta última se añade en la tarea 1 como `alter publication ... add table` condicional a que exista; ver paso 3).
- [ ] **Step 1:** Migración que añade `plays`, `play_participants`, `play_scores` a `supabase_realtime` (idempotente: solo si no están) y fija `replica identity full` en las tres.
- [ ] **Step 2:** `scripts/realtime-spike.mts`: con el SDK de Clerk (`createClerkClient`, como `tests/e2e/helpers.ts`) obtiene un token de sesión de dos usuarios de prueba (`TEST_USERS.a`, `.b`); crea dos clientes con `createSupabaseBrowserClient(getToken)`; A se suscribe a `postgres_changes` de `plays`.
- [ ] **Step 3:** Comprobar y escribir en la consola: (a) A recibe el INSERT de una partida de A; (b) A **no** recibe el INSERT de una partida de B; (c) el DELETE de una partida de A llega (con id). Salida esperada: `PASS a`, `PASS b`, `PASS c`. Borrar las filas de prueba al final.
- [ ] **Step 4:** Ejecutar: `node --conditions=react-server --import tsx scripts/realtime-spike.mts`. Si (b) falla, **parar y avisar al usuario**: el diseño del directo depende de ello.
- [ ] **Step 5:** `supabase db push`, `git add` y commit `chore(realtime): publication + spike script`.

### Task 2: Esquema de compartición y RLS
**Files:** Create las dos migraciones `..100000_sharing_schema.sql` y `..110000_sharing_rls.sql`; Test `tests/integration/rls-play-sharing.test.ts`; Modify `src/lib/supabase/database.types.ts` (`npm run db:types`).
**Interfaces:** Produces (SQL): `plays.owner_id text`, `plays.status text check in ('open','closed')`; `play_participants.user_id text null`, `play_participants.display_name text not null`; tabla `play_members(id uuid pk, play_id, user_id, status check in ('invited','accepted','declined','left'), invited_by, invited_at, responded_at, participant_id)` única por `(play_id, user_id)`; funciones `public.is_play_member(p_play uuid) returns boolean` (miembro `accepted` o dueño) y `public.is_play_owner(p_play uuid) returns boolean`, ambas `security definer stable`, `search_path=''`.
- [ ] **Step 1:** Tests (describe `withRole` como `rls-plays.test.ts`) con estos nombres y aserciones: `"un extraño no ve la partida ni sus participantes ni sus puntos"` (0 filas en las 3 tablas); `"un invitado sin aceptar no ve la partida"`; `"un miembro aceptado ve la partida, sus participantes y la versión de hoja"`; `"un miembro aceptado escribe solo sus puntos"` (UPDATE de otro participante → 0 filas afectadas); `"un miembro no escribe con la partida cerrada"`; `"el dueño escribe todo mientras está abierta"`; `"un miembro no ve una partida de juego manual"` (no se puede invitar); `"las partidas existentes siguen siendo cerradas y de su creador"` (backfill).
- [ ] **Step 2:** Migración de esquema: añade columnas (con `owner_id := created_by`, `status := 'closed'`, `display_name := players.name`, `user_id := players.linked_user_id`), crea `play_members` (dueño como `accepted`), caps por trigger (12 miembros, 30 invitaciones/día por `invited_by`), `replica identity full` y publicación para `play_members`. `created_by` pasa a ser **nullable** con `on delete set null` (el dueño real es `owner_id`).
- [ ] **Step 3:** Migración RLS: sustituye `plays_select_own`, `play_participants_all_own`, `play_scores_all_own`, `play_expansions_*` por políticas basadas en `is_play_member`/`is_play_owner`: lectura miembro/dueño; INSERT/UPDATE/DELETE de `plays`, participantes y expansiones solo dueño y `status='open'`; `play_scores`: dueño todo, miembro solo las de su participante (`participant.user_id = current_user_id()`) con la partida abierta. Lectura de `scoring_sheet_versions`, `scoring_sheets` (título) y `games` **del catálogo** para miembros de una partida que los usa. Mantener `revoke ... from anon`.
- [ ] **Step 4:** `npx vitest run --config vitest.integration.config.mts tests/integration/rls-play-sharing.test.ts` → todos pasan; ejecutar también **solo** `rls-plays.test.ts` y `rls-players.test.ts` (compatibilidad) → pasan. (Excepción pedida: esta RLS se prueba pronto.)
- [ ] **Step 5:** `supabase db push`, `npm run db:types`, `npm run typecheck`, commit `feat(plays): sharing schema and RLS`.

### Task 3: Amigos
**Files:** Create `..120000_friends.sql`; Test `tests/integration/friends.test.ts`.
**Interfaces:** Produces (SQL, `security definer`, grant solo `authenticated`): `create_friend_invite() returns text` (código), `redeem_friend_invite(p_code text) returns text` (id del amigo), `revoke_friend_invite(p_code text) returns void`, `list_friends() returns table(user_id text, display_name text, avatar_url text)`, `remove_friend(p_friend text) returns void`; tablas `friend_invites`, `friendships(user_a, user_b)` con `user_a < user_b` y único. Errores: `FR001` enlace inválido/usado/caducado/revocado, `FR002` ya sois amigos (devuelve el mismo id sin error), `FR003` tope de 100 amigos, `FR004` tope de 10 enlaces activos, `FR005` un usuario canjea su propio enlace.
- [ ] **Step 1:** Tests: `"redimir crea la amistad en los dos sentidos"`; `"el enlace es de un solo uso"` (segundo canje → `FR001`); `"un enlace caducado o revocado no se puede canjear"`; `"no puedes canjear tu propio enlace"` (`FR005`); `"list_friends solo devuelve nombre y avatar de mis amigos"` (columnas exactas; un no-amigo no aparece); `"quitar amigo no borra partidas compartidas"`; `"un extraño no puede leer friend_invites ni friendships"` (RLS: 0 filas).
- [ ] **Step 2:** Implementar migración (RLS activada y sin políticas de lectura directa: todo por las funciones). El código es aleatorio de ≥128 bits, base64url.
- [ ] **Step 3:** Ejecutar solo `tests/integration/friends.test.ts` → pasa. Commit `feat(friends): invite links and friendships (SQL)`.

### Task 4: Invitaciones a partidas
**Files:** Create `..130000_play_invites.sql`; Test `tests/integration/play-invites.test.ts`.
**Interfaces:** Consumes: `is_play_owner`, `list_friends`. Produces (SQL): `invite_to_play(p_play uuid, p_friend text, p_seat smallint) returns uuid` (id de `play_members`; solo dueño, solo amigos, solo juegos del catálogo, partida abierta, el participante de ese asiento recibe `user_id`); `respond_play_invite(p_member uuid, p_accept boolean) returns void`; `leave_play(p_play uuid) returns void`; `list_my_invites() returns table(member_id uuid, play_id uuid, game_name text, invited_by_name text, invited_at timestamptz)` (nunca devuelve participantes ni puntos). Errores: `PI001` no eres su amigo, `PI002` juego manual, `PI003` ya invitado, `PI004` tope diario, `PI005` partida cerrada.
- [ ] **Step 1:** Tests: `"solo el dueño invita y solo a amigos"` (`PI001`); `"no se invita a una partida de un juego manual"` (`PI002`); `"aceptar da acceso de lectura; rechazar deja el nombre suelto y el dueño ve declined"` (participante conserva `display_name`, `user_id` queda null); `"list_my_invites no expone participantes ni puntos"`; `"salir conserva la partida para los demás"`; `"el tope diario de 30 invitaciones"` (`PI004`).
- [ ] **Step 2:** Implementar migración. Aceptar fija `responded_at` y `participant_id`; rechazar pone `user_id = null` en el participante.
- [ ] **Step 3:** Ejecutar solo `tests/integration/play-invites.test.ts` → pasa. Commit `feat(plays): play invitations (SQL)`.

### Task 5: Vincular después, `save_play` no destructivo y cierre
**Files:** Create `..140000_save_play_shared.sql` (incluye vinculación); extend `tests/integration/play-invites.test.ts`; Modify `src/features/plays/save-errors.ts` y su test.
**Interfaces:** Produces (SQL): `save_play(p jsonb) returns uuid` **reescrita**: en una partida existente actualiza participantes **en su sitio** por `player_id` (conserva `user_id`, `display_name` actualizado, y los `play_scores` de las categorías que el payload no menciona para participantes con `user_id`), borra solo los quitados, y pone `status` desde `p->>'status'` (por defecto `open` si hay miembros, `closed` si no); `save_my_scores(p_play uuid, p_scores jsonb) returns void` (solo el propio participante, partida abierta; `p_scores` = `{categoryKey: json}`); `close_play(p_play uuid, p jsonb) returns void` (dueño; recibe totales/orden/ganador ya calculados por `compute.ts` y cierra); `link_player_to_friend(p_player uuid, p_friend text) returns uuid` (crea `player_link_requests`; `players.linked_user_id` solo se fija al aceptarse); `respond_player_link(p_request uuid, p_accept boolean) returns int` (nº de partidas añadidas); `unlink_player(p_player uuid)`. La restricción de `players` que obliga a `linked_user_id = owner_id` se relaja a «yo o un amigo aceptado».
- [ ] **Step 1:** Tests: `"save_play del dueño no borra los puntos que escribió un invitado"` (invitado escribe, dueño guarda cambiando notas, los puntos siguen); `"save_my_scores no escribe en la columna de otro"`; `"close_play fija totales y rechaza más ediciones de miembros"`; `"vincular crea una sola solicitud agrupada con N partidas"`; `"aceptar añade al amigo como miembro de las N partidas y fija user_id"`; `"rechazar no cambia nada"`; `"deshacer la vinculación no borra partidas"`.
- [ ] **Step 2:** Implementar migración. En TypeScript, `save-errors.ts` mapea los nuevos códigos (`PI00x`, `FR00x`) a resultados tipados; añadir casos a `save-errors.test.ts`.
- [ ] **Step 3:** Ejecutar solo los dos tests tocados (`play-invites.test.ts`, `save-errors.test.ts`) → pasan. Commit `feat(plays): non-destructive save, close, link a player to a friend`.

### Task 6: Borrado con traspaso
**Files:** Create `..150000_play_delete_transfer.sql`; extend `tests/integration/rls-play-sharing.test.ts`; Modify `src/features/profiles/services/clerk-sync.ts` (`deleteUserData`) y `delete-user-data.test.ts`.
**Interfaces:** Produces: `delete_play(p_play uuid) returns void` (dueño; si hay otros miembros `accepted` traspasa `owner_id` al más antiguo y quita al dueño anterior de `play_members`; si no, borra); `transfer_or_delete_plays(p_user text) returns void` (`security definer`, solo `service_role`): misma lógica para todas las partidas de ese usuario.
- [ ] **Step 1:** Tests SQL: `"borrar con miembros traspasa al más antiguo"`; `"borrar sin miembros elimina la partida"`; `"transfer_or_delete_plays deja intactas las partidas con otros miembros"`. Test unitario en `delete-user-data.test.ts`: `"deleteUserData traspasa partidas antes de borrar el perfil"` (orden de llamadas: Storage → `transfer_or_delete_plays` → borrar perfil).
- [ ] **Step 2:** Implementar migración y llamar a `admin.rpc("transfer_or_delete_plays", { p_user: userId })` en `deleteUserData` antes del `delete` del perfil.
- [ ] **Step 3:** Ejecutar solo esos dos tests → pasan. Commit `feat(plays): delete passes the match to the other members`.

### Task 7: Estadísticas con partidas compartidas
**Files:** Create `..160000_stats_shared.sql`; Test `tests/integration/rls-stats.test.ts` (ampliar).
**Interfaces:** Modifies (misma firma y columnas que hoy, más `shared boolean` en `my_overview`/`my_top_games`): `my_overview`, `my_top_games`, `head_to_head`, `game_stats`, `game_score_series`. La identidad del «yo» pasa a ser `play_participants.user_id = current_user_id()` **o** el jugador `linked_user_id = yo` del dueño; los nombres salen de `play_participants.display_name`, no de `players`.
- [ ] **Step 1:** Tests: `"un invitado ve la partida compartida en my_overview"`; `"head_to_head de un invitado usa display_name"`; `"las estadísticas de antes no cambian"` (mismos números para un usuario sin partidas compartidas); `"game_stats funciona para un invitado sin leer players"`.
- [ ] **Step 2:** Implementar migración con `create or replace` de las cinco funciones. Mantener `security invoker`.
- [ ] **Step 3:** Ejecutar solo `rls-stats.test.ts` → pasa. `npm run db:types`, commit `feat(stats): count shared matches by participant identity`.

### Task 8: Servicios, esquemas y acciones (TypeScript)
**Files:** Create `src/features/friends/{schemas.ts,services/friends-service.ts,actions/friend-actions.ts,index.ts}`, `src/features/plays/{services/sharing-service.ts,actions/sharing-actions.ts}`; tests `schemas.test.ts` junto a cada uno.
**Interfaces:** Produces: `createFriendInviteAction(): Promise<{ok:true; url:string}|{ok:false;error:"limit"}>`; `redeemFriendInviteAction(code: unknown): Promise<{ok:true; friendId:string}|{ok:false;error:"invalid"|"own"|"limit"}>`; `listFriends(): Promise<{userId:string; displayName:string; avatarUrl:string|null}[]>`; `inviteToPlayAction(input: {playId:string; friendId:string; seat:number})`; `respondPlayInviteAction(input: {memberId:string; accept:boolean})`; `listMyInvites()`; `closePlayAction(playId:string)` (calcula con `computePlay` y llama a `close_play`); `saveMyScoresAction(playId:string, scores: Record<string,ScoreValue>)` (valida contra el motor de hojas `validateDefinition`/`evaluate`: categorías y tipos cerrados); `deletePlayAction(playId:string)`; `listElsewherePlays()` (partidas donde soy miembro y el juego no está en mi biblioteca). Todas devuelven códigos que la UI traduce, y comprueban `auth()`.
- [ ] **Step 1:** Tests de esquemas: `"el código de amigo rechaza formatos inválidos"`, `"saveMyScores rechaza una categoría que no existe en la hoja"`, `"saveMyScores rechaza un valor de tipo equivocado"`.
- [ ] **Step 2:** Implementar servicios (usan `createSupabaseServerClient`, como `play-service.ts`) y acciones.
- [ ] **Step 3:** `npm run typecheck` y los tests de esquemas → pasan. Commit `feat(friends,plays): services and actions`.

### Task 9: Estado en directo (lógica pura y suscripción)
**Files:** Create `src/features/plays/live/merge-play-state.ts`, `merge-play-state.test.ts`, `use-live-play.ts`.
**Interfaces:** Produces: `type LivePlay = { id; status:'open'|'closed'; participants:{id; seat; name; userId:string|null; scores:Record<string,unknown>; total:number|null}[]; members:{userId:string; status:string}[] }`; `applyChange(state: LivePlay, change: {table:'plays'|'play_participants'|'play_scores'|'play_members'; type:'INSERT'|'UPDATE'|'DELETE'; row: unknown}): LivePlay | "refetch"` (un DELETE devuelve `"refetch"`); `useLivePlay(playId: string, initial: LivePlay): { play: LivePlay; connected: boolean }` (suscribe con `createSupabaseBrowserClient`, aplica cambios, y si el socket cae o llega `"refetch"` vuelve a leer; lectura periódica de ~10 s como respaldo; limpia el canal al desmontar).
- [ ] **Step 1:** Tests de `applyChange`: `"un UPDATE de puntos cambia solo esa columna"`; `"un DELETE pide refetch"`; `"un cambio de una partida distinta se ignora"`; `"los totales mostrados son provisionales y no sustituyen a los de la partida cerrada"`.
- [ ] **Step 2:** Implementar `merge-play-state.ts` (puro) y el hook.
- [ ] **Step 3:** Ejecutar solo `merge-play-state.test.ts` → pasa. Commit `feat(plays): live play state`.

### Task 10: Pantallas de amigos e invitaciones
**Files:** Create `src/features/friends/components/{friends-panel.tsx,invite-link.tsx}`, `src/features/plays/components/invites-inbox.tsx`; Create las rutas `friends/page.tsx`, `friends/join/[code]/page.tsx`, `invites/page.tsx`; Modify `src/components/layout/app-nav.tsx` (entrada «Amigos» e insignia de invitaciones), `src/i18n/messages/{en,es,fr}.json` (claves `Friends.*`, `Invites.*`, `Nav.friends`).
**Interfaces:** Consumes las acciones de la tarea 8. La página `join/[code]` canjea el código al cargar y redirige a `/friends` con un aviso; sin sesión, a iniciar sesión con `redirect_url`.
- [ ] **Step 1:** Implementar las pantallas con los estados vacío/error/carga del proyecto (`empty-state.tsx`); botón copiar enlace; revocar; lista de amigos con quitar; bandeja con Aceptar/Rechazar; la insignia se actualiza en directo suscribiéndose a `play_members` del usuario.
- [ ] **Step 2:** Claves i18n en los tres idiomas; el test existente de mensajes (anti-literales) debe seguir verde: `npx vitest run src/i18n`.
- [ ] **Step 3:** `npm run typecheck` y `npm run lint` → sin errores. Commit `feat(friends): friends, link and invitations screens`.

### Task 11: Partida en directo y «En casa de otros»
**Files:** Create `src/features/plays/components/live-play.tsx`, la ruta `games/[id]/plays/[playId]/live/page.tsx`, `plays/elsewhere/page.tsx`; Modify `src/features/players/components/player-picker.tsx` (los amigos aparecen en el buscador y al elegir uno se llama a `inviteToPlayAction`), `players-manager.tsx` (vincular un nombre a un amigo, con estado «pendiente»), `plays-panel.tsx` (entrada a la vista en directo; el dueño borra con `deletePlayAction`), `src/i18n/messages/*.json`.
**Interfaces:** `LivePlay` muestra una columna por participante; editable solo la propia (miembro) o todas (dueño) mientras `status='open'`; el dueño ve el botón **Cerrar partida** (`closePlayAction`); participantes que rechazaron aparecen como «rechazó»; totales marcados «provisional» hasta cerrar. La vista «En casa de otros» lista `listElsewherePlays()` agrupada por juego, con etiqueta.
- [ ] **Step 1:** Implementar la vista y sus enlaces; reutilizar los controles de entrada de puntos del formulario actual (`play-form.tsx`) para no duplicar la edición por tipo de categoría.
- [ ] **Step 2:** i18n en los tres idiomas.
- [ ] **Step 3:** `npm run typecheck`, `npm run lint` → sin errores. Commit `feat(plays): live shared play and "at a friend's house" section`.

### Task 12: E2E, verificación final y documentación
**Files:** Create `tests/e2e/app-shared-plays.spec.ts`; Modify `tests/e2e/helpers.ts` (usuarios `p` y `q` en `TEST_USERS`), `docs/DECISIONS.md` (ADR-040), `docs/ROADMAP.md` (8a hecha; 8b, 8c pendientes), `docs/SECURITY.md`, `docs/DATABASE.md`, `README.md` si lista comandos.
**Interfaces:** Consumes todo lo anterior.
- [ ] **Step 1:** E2E con **dos contextos de navegador**: `"dos usuarios: amistad por enlace"`; `"invitar a un amigo, aceptar, puntuar su columna y verlo en directo en el otro navegador"`; `"el invitado no edita la columna de otro"`; `"rechazar deja al jugador como rechazó"`; `"vincular un nombre a un amigo registrado después"`; `"el dueño cierra y nadie edita"`; `"borrar como dueño la deja al otro participante"`; `"una partida de un juego que no tengo aparece en En casa de otros"`; `"un extraño no ve la partida (404)"`. Casos escritos con los usuarios `p` y `q` y limpieza de datos al terminar.
- [ ] **Step 2:** **Ejecutar ahora las suites completas**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run e2e`. Salida esperada: todo verde; corregir y repetir hasta lograrlo. Anotar los recuentos nuevos en `ROADMAP.md`.
- [ ] **Step 3:** ADR-040 (decisiones de 8a, incluidos los límites: sin correo/push, solo catálogo, reabrir fuera), SECURITY (enumeración de cuentas, enlaces de un solo uso, qué ve un invitado sin aceptar), DATABASE (tablas y funciones nuevas), ROADMAP.
- [ ] **Step 4:** Commit `feat(plays): phase 8a shared plays, friends, live scoring`, y avisar al usuario para probar en el móvil con otra cuenta.

---

## Self-review
- **Cobertura de la spec:** amigos (3, 10), partida compartida y RLS (2, 5), directo (1, 9, 11), invitaciones y confirmación (4, 10), vincular después (5, 11), «en casa de otros» (8, 11), borrado y cuenta (6), estadísticas (7), pruebas y documentación (12). Sin huecos.
- **Consistencia de nombres:** `is_play_member/is_play_owner` (2) → usadas en 4–6; `list_friends` (3) → 4 y 8; `close_play`, `save_my_scores`, `link_player_to_friend` (5) → acciones de 8; `LivePlay`/`applyChange` (9) → 11.
- **Proporción:** el plan es más corto que el código que describe; los cuerpos SQL/TS los decide quien implementa, con las firmas y los casos de prueba fijados.
- **Riesgo conocido:** la tarea 1 puede invalidar el enfoque de directo; si falla, se vuelve al usuario antes de seguir.
