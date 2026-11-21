# Noche de juegos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selector de juego (lista corta clasificada + Girar) y noches de juegos guardadas con votos de amigos, sugerencias desde su biblioteca y un enlace público temporal para invitados sin cuenta.

**Architecture:** Módulo nuevo `src/features/nights/` (ADR-047: `views/`, `components/`, `services/`, `actions/`). Datos en tres migraciones: esquema + RLS + candidatos; funciones de amigos (`SECURITY DEFINER`, patrón 8a); enlace público y funciones `guest_*` ejecutables solo por `service_role`. La clasificación y el sorteo son funciones puras. La página pública `/n/:token` habla solo con `GET/POST /api/nights/guest/[token]`, que valida el token, la cookie del invitado y el límite de frecuencia y usa `createSupabaseAdminClient()`.

**Tech Stack:** Next 16 App Router, TypeScript strict, next-intl (en/es/fr/pt), Clerk, Supabase (Postgres + RLS), zod, shadcn/ui (radix-nova), Vitest, `pg` para integración, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-21-noche-de-juegos-design.md`

## Global Constraints

- Commits **sin** `Co-Authored-By` ni ninguna línea de atribución (regla del usuario).
- Rama `feat/game-night` desde `main`; el spec (sin commit) va en el primer commit.
- Cada `supabase db push` a dev lo aprueba el usuario antes de ejecutarlo.
- Sin literales en la UI: todo texto en `src/i18n/messages/{en,es,fr,pt}.json` bajo el espacio `Nights`.
- `shadcn add` reintroduce `import { cn } from "cn"`: revisar tras cada `add` (la regla ESLint lo bloquea).
- `unstable_rethrow(error)` en todo `catch` alrededor de `auth()`.
- Topes: 20 noches abiertas por anfitrión · 12 juegos por noche · 3 sugerencias por amigo y noche · 30 amigos invitados · 30 invitados por enlace.
- Título 1–80; nombre de invitado 1–40 (recortado); `players` 1–100; `max_minutes` 5–1440.
- Enlace: token de 32 bytes base64url, en la BD solo `sha256`; caduca al final (UTC) del día siguiente a `starts_on`.
- Cookie del invitado: `amika_guest`, httpOnly, `SameSite=Lax`, `Secure`, `Path=/api/nights/guest`, caduca con el enlace; en la BD solo `sha256` de la clave.
- Límite de frecuencia: 30 escrituras/min por invitado, 300/h por enlace (blando).
- Sondeo cada 10 s solo con la pestaña visible.
- Errores SQL: `GN001` no es tu amigo · `GN002` noche cerrada · `GN003` ya invitado/ya está · `GN004` tope · `GN005` enlace no válido/caducado/revocado · `GN006` juego no está en tu biblioteca · `42501` no es el anfitrión · `P0002` no encontrado.
- Prefijo de fixtures E2E **9913**; usuarios de test nuevos `s` (anfitrión) y `t` (amigo).
- Tests pesados (integración completa, E2E) solo en la Tarea 11 (preferencia del usuario); en cada tarea, solo sus tests.

## Review Focus

1. **Enlace caducado o revocado mientras el invitado tiene la página abierta**: el siguiente voto o sondeo muestra «Este enlace ya no está activo» y no escribe nada (Tarea 6: test `rejects votes after revoke`).
2. **Invitado sin cookie (otro navegador o modo privado)**: crea otro invitado con el nombre que escriba; no hereda votos (Tarea 6: test `new browser is a new guest`).
3. **Biblioteca vacía o sin candidatos tras filtrar**: el selector muestra un estado vacío que explica qué filtro quitar, y Girar está deshabilitado (Tarea 4: `rankCandidates([])` → `[]`; Tarea 7: test del estado vacío).
4. **Un amigo que deja de ser amigo o se borra la cuenta**: deja de ver la noche; sus votos y sugerencias quedan (votos con `user_id` en cascada se borran al borrar la cuenta; la amistad rota no borra nada, pero `is_night_member` exige amistad vigente) (Tarea 2: test `ex-friend loses access`).
5. **Borrar un juego de la biblioteca del anfitrión o del catálogo con la noche abierta**: la fila de `game_night_games` desaparece por cascada solo si se borra el juego; quitarlo de la biblioteca no la quita (la lista usa `name_snapshot`) (Tarea 1: test `library removal keeps night game`).

---

### Task 1: Esquema, RLS y candidatos del selector

**Files:**
- Create: `supabase/migrations/20261121100000_game_nights.sql`
- Create: `tests/integration/rls-game-nights.test.ts`
- Modify: `src/lib/supabase/database.types.ts` (regenerar con `npm run db:types` tras el push)

**Interfaces:**
- Produces (SQL): tablas `game_nights`, `game_night_games`, `game_night_members`, `game_night_votes` (columnas del spec; `game_night_votes` con `user_id text null`, `guest_id uuid null`, `check (num_nonnulls(user_id, guest_id) = 1)`, únicos parciales `(night_game_id, user_id)` y `(night_game_id, guest_id)`; `game_night_games` añade `played boolean not null default false`); `is_night_member(p_night uuid) returns boolean` (`security definer`: dueño, o miembro `accepted` **y** `are_friends(owner, me)`); `picker_candidates(p_players int default null, p_max_minutes int default null)` `security invoker` que devuelve `(game_id uuid, name text, cover_url text, is_custom boolean, min_players smallint, max_players smallint, min_playtime smallint, max_playtime smallint, is_favorite boolean, rating smallint, play_count int, last_played_on date)` — biblioteca `owned`, `kind = 'base'`, filtros con la semántica de `search_library`, partidas vía `my_participants()` unidas a `plays`.
- Políticas: el dueño hace todo sobre `game_nights` y `game_night_games` (los `insert` de juegos exigen `source = 'host'` y `added_by = current_user_id()`); los miembros (`is_night_member`) **leen** `game_nights`, `game_night_games`, `game_night_members` y `game_night_votes`; nadie escribe directamente `game_night_members` ni `game_night_votes` (sin `grant insert/update/delete` a `authenticated`). Cierre automático: `night_is_open(n game_nights) returns boolean` = `status = 'open' and now() < (starts_on + 2)::timestamptz` (UTC); toda función de escritura de las Tareas 2–3 la usa (si no, `GN002`), y los servicios muestran «cerrada» con ella. Topes 20 noches abiertas (contando con `night_is_open`) y 12 juegos por triggers con `for update` sobre el perfil/noche (código `GN004`).

- [ ] **Step 1: Crear la rama**

Run: `git switch main; git pull; git switch -c feat/game-night` (el spec sin commit viaja con el árbol de trabajo).

- [ ] **Step 2: Escribir los tests de integración que fallan**

En `tests/integration/rls-game-nights.test.ts`, con el patrón `withRole`/`fixtures` de `rls-player-groups.test.ts` (usuarios `test_user_a` anfitrión, `test_user_b` amigo, `test_user_c` ajeno; ids `…-0000000013xx`):
- `owner sees own nights only` — C no ve la noche de A (`select` → `[]`).
- `invited but not accepted cannot read` — B con `status='invited'` → `[]`.
- `accepted friend reads night, games, votes` — B aceptado y amigo → ve 1 noche y sus juegos.
- `ex-friend loses access` — borrar la fila de `friendships` → B ve `[]`.
- `members cannot write votes directly` — `insert into game_night_votes` como B → `42501`.
- `twelfth game ok, thirteenth fails` → `GN004`.
- `library removal keeps night game` — borrar `library_items` del juego → la fila de `game_night_games` sigue.
- `picker_candidates filters and counts` — A tiene 3 juegos (`owned` 2–4 jugadores 60 min, `owned` expansión, `previously_owned`) y 2 partidas del primero (última `2026-10-01`): `picker_candidates(3, 90)` → 1 fila con `play_count = 2`, `last_played_on = '2026-10-01'`; `picker_candidates(5, null)` → `[]`.

- [ ] **Step 3: Verificar que fallan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/rls-game-nights.test.ts`
Expected: FAIL (`relation "public.game_nights" does not exist`).

- [ ] **Step 4: Escribir la migración**

Con cabecera de comentario como las de 8a (qué contiene, códigos de error), `set search_path = ''` en todas las funciones y `updated_at` con `set_updated_at()`.

- [ ] **Step 5: Ensayar y aplicar**

Ensayar el SQL en transacción revertida; **pedir aprobación al usuario**; `supabase db push`; `npm run db:types`.

- [ ] **Step 6: Verificar que pasan**

Run: el comando del Step 3. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-11-21-noche-de-juegos-design.md docs/superpowers/plans/2026-11-21-noche-de-juegos.md supabase/migrations/20261121100000_game_nights.sql tests/integration/rls-game-nights.test.ts src/lib/supabase/database.types.ts
git commit -m "feat(nights): esquema, RLS y candidatos del selector"
```

### Task 2: Funciones de amigos (invitar, responder, sugerir, votar)

**Files:**
- Create: `supabase/migrations/20261121110000_game_night_friends.sql`
- Create: `tests/integration/game-night-friends.test.ts`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: tablas e `is_night_member` (Tarea 1).
- Produces (SQL, todas `security definer`, comprueban al llamante, noche `open` o `GN002`):
  - `invite_to_night(p_night uuid, p_friend text) returns void` — solo dueño (`42501`), `are_friends` (`GN001`), ya invitado/aceptado (`GN003`), tope 30 (`GN004`); reinvita si estaba `declined`.
  - `respond_night_invite(p_night uuid, p_accept boolean) returns void` — solo el invitado.
  - `leave_night(p_night uuid) returns void` — borra su fila de miembro; sus votos se quedan.
  - `suggest_night_game(p_night uuid, p_game uuid) returns uuid` — miembro aceptado; juego del catálogo (`owner_id is null`) que el llamante tiene `owned` (`GN006`); ya en la lista (`GN003`); tope 3 por amigo y 12 por noche (`GN004`); guarda `name_snapshot`/`cover_snapshot`, `source='suggested'`.
  - `toggle_night_vote(p_night_game uuid) returns boolean` — dueño o miembro aceptado; devuelve `true` si ahora vota.
  - `night_invites() returns table (night_id uuid, title text, starts_on date, host_name text)` — invitaciones `invited` del llamante en noches `open`.
  - `night_votes(p_night uuid) returns table (night_game_id uuid, voter_name text, is_guest boolean)` — solo miembros; nombre visible del perfil o nombre del invitado.

- [ ] **Step 1: Tests que fallan** — en `game-night-friends.test.ts`: `invite requires friendship` (→ `GN001`), `only owner invites` (B invita → `42501`), `double invite` (→ `GN003`), `accept then read`, `suggest not owned` (→ `GN006`), `suggest custom game` (→ `GN006`), `fourth suggestion` (→ `GN004`), `toggle vote twice` (→ `true` luego `false`, 0 filas), `closed night rejects vote` (→ `GN002`), `night_votes shows names` (perfil `display_name` de B), `leave keeps votes`.
- [ ] **Step 2: Verificar que fallan** — `npx vitest run --config vitest.integration.config.mts tests/integration/game-night-friends.test.ts` → FAIL.
- [ ] **Step 3: Migración** — `grant execute` solo a `authenticated` en estas funciones; `revoke` de `public`.
- [ ] **Step 4: Ensayar, aprobación del usuario, `db push`, `db:types`.**
- [ ] **Step 5: Verificar que pasan** — mismo comando → PASS.
- [ ] **Step 6: Commit** — `feat(nights): invitaciones, sugerencias y votos de amigos`.

### Task 3: Enlace público y funciones de invitado

**Files:**
- Create: `supabase/migrations/20261121120000_game_night_guests.sql`
- Create: `tests/integration/game-night-guests.test.ts`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces (SQL):
  - Tablas `game_night_links` (único parcial: un enlace sin revocar por noche), `game_night_guests`, `game_night_requests` (registro de frecuencia: `link_id`, `guest_id null`, `created_at`; sin políticas, como `manual_requests`).
  - `create_night_link(p_night uuid, p_token_hash text) returns timestamptz` (dueño; revoca el anterior; devuelve `expires_at` = `starts_on + 2 días` a las 00:00 UTC) y `revoke_night_link(p_night uuid) returns void` — `authenticated`.
  - Solo `service_role`: `guest_night_state(p_token_hash text, p_guest_key_hash text default null) returns jsonb` (`{night:{title,startsOn,hostName,status}, games:[{id,name,cover,minPlayers,maxPlayers,minPlaytime,maxPlaytime,votes,voters:[name],mine}], guest:{name}|null}`; enlace inválido → `GN005`), `guest_join_night(p_token_hash text, p_name text, p_guest_key_hash text) returns uuid` (tope 30 → `GN004`), `guest_toggle_vote(p_token_hash text, p_guest_key_hash text, p_night_game uuid) returns boolean`, `guest_rename(p_token_hash text, p_guest_key_hash text, p_name text) returns void`, `log_night_request(p_token_hash text, p_guest_key_hash text) returns table (last_minute int, last_hour int)`.

- [ ] **Step 1: Tests que fallan** — `guest functions not callable by authenticated` (→ `42501`), `…by anon` (→ `42501`), y como rol de servicio: `state hides other nights`, `expired link` (→ `GN005`), `revoked link` (→ `GN005`), `join + toggle + state shows mine`, `thirty-first guest` (→ `GN004`), `name trimmed, empty rejected` (→ `23514`), `request log counts`.
- [ ] **Step 2: Verificar que fallan** — `npx vitest run --config vitest.integration.config.mts tests/integration/game-night-guests.test.ts`.
- [ ] **Step 3: Migración.** `withRole` solo admite `authenticated|anon`: los tests de servicio llaman como el rol privilegiado de las fixtures (sin `set local role`); añadir a `tests/integration/db.ts` `asService<T>(fixtures, fn)` que hace exactamente eso.
- [ ] **Step 4: Ensayar, aprobación, `db push`, `db:types`.**
- [ ] **Step 5: Verificar que pasan.**
- [ ] **Step 6: Commit** — `feat(nights): enlace público y funciones de invitado`.

### Task 4: Clasificación y sorteo (puros)

**Files:**
- Create: `src/features/nights/rank.ts`, `src/features/nights/rank.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Candidate = { gameId: string; name: string; coverUrl: string | null; isCustom: boolean;
    minPlayers: number | null; maxPlayers: number | null; minPlaytime: number | null; maxPlaytime: number | null;
    isFavorite: boolean; rating: number | null; playCount: number; lastPlayedOn: string | null };
  export type Reason = { key: "neverPlayed" } | { key: "notPlayedFor"; months: number }
    | { key: "favorite" } | { key: "highlyRated" } | { key: "fitsPlayers"; players: number };
  export type Ranked = Candidate & { score: number; reasons: Reason[] };
  export function rankCandidates(c: readonly Candidate[], opts: { today: string; players?: number; limit?: number }): Ranked[];
  export function spin(items: readonly { id: string; score: number; votes: number }[], random: () => number): string | null;
  ```
- Puntuación (spec): nunca jugado +3; si jugado, `min(días, 180) / 180 × 3`; favorito +2; `(rating − 5) × 0,3` si hay rating; empate por nombre (`localeCompare`, base); `limit` por defecto 5. Motivos: `neverPlayed`; `notPlayedFor` si ≥ 60 días (meses = `floor(días/30)`); `favorite`; `highlyRated` si rating ≥ 8; `fitsPlayers` si `players` dado. Peso del sorteo = `score / maxScore + votes` (si `maxScore` es 0, solo `1 + votes`).

- [ ] **Step 1: Tests que fallan** — `empty input returns empty`; `never played beats played recently`; `favorite adds 2` (dos candidatos iguales salvo favorito: diferencia 2); `recency saturates at 180 days` (200 y 400 días → misma puntuación); `ties by name`; `reasons`: jugado hace 95 días → `{key:"notPlayedFor", months:3}`, rating 9 → `highlyRated`; `limit default 5`; `spin([])` → `null`; `spin` con `random = () => 0` → el primero; `spin` con dos de igual puntuación y uno con 3 votos y `random = () => 0.5` → el votado.
- [ ] **Step 2: Fallan** — `npx vitest run src/features/nights/rank.test.ts`.
- [ ] **Step 3: Implementar.** Sorteo: suma acumulada de pesos y `random() × total`.
- [ ] **Step 4: Pasan.**
- [ ] **Step 5: Commit** — `feat(nights): clasificación y sorteo del selector`.

### Task 5: Servicios, esquemas, errores y acciones (con sesión)

**Files:**
- Create: `src/features/nights/schemas.ts` (+ `.test.ts`), `src/features/nights/error-codes.ts` (+ `.test.ts`), `src/features/nights/services/night-service.ts`, `src/features/nights/actions/night-actions.ts`, `src/features/nights/index.ts`, `src/features/nights/client.ts`

**Interfaces:**
- Consumes: SQL de las Tareas 1–3; `rankCandidates` (Tarea 4).
- Produces:
  - `schemas.ts`: `nightInputSchema` (`title` 1–80 recortado, `startsOn` `YYYY-MM-DD`, `players` 1–100 opcional, `maxMinutes` 5–1440 opcional, `groupId` uuid opcional, `gameIds` uuid[] 1–12 únicos), `pickerQuerySchema` (`players`, `maxMinutes`, `groupId` opcionales), `guestNameSchema` (1–40 recortado).
  - `error-codes.ts`: `NIGHT_ERROR_CODES = ["unauthenticated","invalid","failed","not_found","not_friend","closed","already","limit","not_owned","link_invalid","rate_limited"]`, `toNightError(code: string): NightErrorCode` y `fromPgCode(code: string | undefined): NightErrorCode` (`GN001→not_friend`, `GN002→closed`, `GN003→already`, `GN004→limit`, `GN005→link_invalid`, `GN006→not_owned`, `P0002→not_found`, `42501→not_found`).
  - `night-service.ts` (`import "server-only"`, cliente con sesión): `getPickerShortlist(q: PickerQuery, today: string): Promise<Ranked[]>` (si `groupId`, `players` = nº de miembros del grupo), `listNights(): Promise<NightSummary[]>`, `getNight(id: string): Promise<NightDetail | null>`, `createNight(input: NightInput): Promise<{ id: string } | { error: NightErrorCode }>`, `setNightGame(nightId, gameId, change: { pinned?: boolean; played?: boolean } | "remove")`, `closeNight(id)`, `inviteToNight(nightId, friendId)`, `respondNightInvite(nightId, accept)`, `leaveNight(nightId)`, `suggestNightGame(nightId, gameId)`, `toggleNightVote(nightGameId): Promise<boolean>`, `listNightInvites(): Promise<NightInvite[]>`, `createNightLink(nightId): Promise<{ token: string; expiresAt: string }>` (token `randomBytes(32).toString("base64url")`, guarda `sha256` hex), `revokeNightLink(nightId)`.
  - `NightDetail = { id; title; startsOn; status: "open"|"closed"; isOwner: boolean; hostName: string; players: number|null; maxMinutes: number|null; groupId: string|null; linkExpiresAt: string|null; games: { id; gameId; name; coverUrl; source: "host"|"suggested"; pinned; played; votes: number; voters: string[]; mine: boolean }[]; members: { userId; name; status }[] }`.
  - `night-actions.ts`: una acción por operación con el marco `run()` de `friend-actions.ts`, `revalidatePath("/nights", "layout")`; `createNightLinkAction` llama antes a `ensureDisplayName()`.
  - `index.ts` exporta servicios/tipos para páginas; `client.ts` exporta tipos y `NIGHT_ERROR_CODES` para componentes cliente.

- [ ] **Step 1: Tests que fallan** — `schemas.test.ts`: título vacío/81 → inválido; `gameIds` con 13 o repetidos → inválido; `startsOn` `2026-02-30` → inválido. `error-codes.test.ts`: cada `GN00x` a su clave; código desconocido → `failed`.
- [ ] **Step 2: Fallan** — `npx vitest run src/features/nights`.
- [ ] **Step 3: Implementar** esquemas, errores, servicio y acciones.
- [ ] **Step 4: Pasan** + `npm run typecheck` + `npm run lint`.
- [ ] **Step 5: Commit** — `feat(nights): servicios y acciones de noches`.

### Task 6: Ruta pública del invitado

**Files:**
- Create: `src/features/nights/guest/token.ts` (+ `.test.ts`), `src/features/nights/guest/guest-service.ts`, `src/app/api/nights/guest/[token]/route.ts`, `tests/unit/nights-guest-route.test.ts`

**Interfaces:**
- Produces:
  - `token.ts`: `hashSecret(s: string): string` (sha256 hex), `isTokenShape(s: string): boolean` (base64url de 43 caracteres), `newGuestKey(): string`, `GUEST_COOKIE = "amika_guest"`, `GUEST_LIMITS = { perMinute: 30, perHour: 300 }`, `isGuestOverLimit(u: { lastMinute: number; lastHour: number }): boolean`.
  - `guest-service.ts` (`server-only`, `createSupabaseAdminClient()`): `getGuestState(tokenHash, guestKeyHash | null): Promise<GuestState | { error: "link_invalid" }>`, `guestJoin`, `guestToggleVote`, `guestRename`, `logGuestRequest`.
  - `route.ts`: `GET` → `GuestState` (`Cache-Control: no-store`); `POST` cuerpo `{ action: "join", name } | { action: "vote", nightGameId } | { action: "rename", name }` validado con zod. Respuestas: 400 cuerpo inválido, 404 `{error:"link_invalid"}` (token mal formado, caducado o revocado), 429 `{error:"rate_limited"}`, 409 `{error:"limit"}`, 401 `{error:"no_guest"}` (vote/rename sin cookie). `join` pone la cookie (atributos de Global Constraints, `expires` = caducidad del enlace). Todas las respuestas: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.

- [ ] **Step 1: Tests que fallan** — `token.test.ts`: `hashSecret("a")` = `ca978112…bb` (sha256 conocido), `isTokenShape` acepta 43 base64url y rechaza `../x`, límites 30/300. `nights-guest-route.test.ts` (servicio simulado con `vi.mock`): `malformed token is 404 without db call`, `join sets httpOnly cookie on /api/nights/guest`, `vote without cookie is 401`, `rejects votes after revoke` (servicio → `link_invalid` → 404), `new browser is a new guest` (sin cookie, `join` crea otro), `over limit is 429`.
- [ ] **Step 2: Fallan** — `npx vitest run src/features/nights/guest tests/unit/nights-guest-route.test.ts`.
- [ ] **Step 3: Implementar.** El route handler no pasa por next-intl (`/api` ya se excluye en `proxy.ts`).
- [ ] **Step 4: Pasan** + `typecheck` + `lint`.
- [ ] **Step 5: Commit** — `feat(nights): ruta pública del invitado`.

### Task 7: Selector y lista de noches

**Files:**
- Create: `src/app/[locale]/(app)/nights/page.tsx`, `src/app/[locale]/(app)/nights/new/page.tsx`, `src/features/nights/views/nights-home.tsx`, `src/features/nights/views/night-picker.tsx`, `src/features/nights/components/spin-card.tsx`, `src/features/nights/components/reason-badges.tsx`
- Modify: `src/proxy.ts` (añadir `nights` a `PROTECTED_PATH`), `src/i18n/messages/{en,es,fr,pt}.json` (espacio `Nights`), `src/app/[locale]/(app)/home/page.tsx` (tarjeta «Noche de juegos» con enlace a `/nights`; **sin** entrada nueva en la barra inferior, que ya tiene 5 con «Registrar» en el centro — llamada del plan)

**Interfaces:**
- Consumes: `getPickerShortlist`, `listNights`, `listNightInvites`, `respondNightInviteAction`, `createNightAction`, `spin`, `listGroups`.
- Produces: `NightPicker` (`{ mode: "now" | "plan"; groups: Group[]; initial: Ranked[]; query: PickerQuery }`): filtros por la URL (`?players=&maxMinutes=&groupId=`, `router.replace`); lista corta con `ReasonBadges`; `SpinCard` (resultado grande, «Jugar este» → `/games/:id/plays/new?group=<groupId>`, «Girar otra vez»; sin animación con `prefers-reduced-motion`); en modo `plan`: fijar/quitar, título, fecha (por defecto hoy) y «Guardar noche» → `/nights/:id`. `NightsHome`: «Elegir juego ahora» (picker `now` inline), «Planear una noche» → `/nights/new`, invitaciones (Aceptar/Rechazar), mis noches abiertas y cerradas.

- [ ] **Step 1:** Añadir claves `Nights.*` en los 4 idiomas (incluidas las de motivos con plural ICU para `months`); `npx vitest run src/i18n/messages.test.ts` → PASS (mismas claves en todos).
- [ ] **Step 2:** Implementar páginas, vistas y componentes; estado vacío con texto «Ningún juego encaja: prueba con más tiempo o sin número de jugadores» y Girar deshabilitado.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run routes:map` (actualiza `docs/ROUTES.md`).
- [ ] **Step 4:** Comprobar en `next dev` con el navegador: filtrar, Girar, guardar.
- [ ] **Step 5: Commit** — `feat(nights): selector y lista de noches`.

### Task 8: Detalle de la noche (anfitrión y amigos)

**Files:**
- Create: `src/app/[locale]/(app)/nights/[id]/page.tsx`, `src/features/nights/views/night-detail.tsx`, `src/features/nights/components/{vote-button,suggest-game,invite-friends,share-link,use-poll}.tsx`
- Modify: `src/features/friends/views/friends-panel.tsx` (bloque «Invitaciones a noches» con `listNightInvites`), mensajes en 4 idiomas

**Interfaces:**
- Consumes: `getNight`, acciones de la Tarea 5, `spin`, lista de amigos del módulo `friends`.
- Produces: `usePoll(fn: () => void, ms = 10000)` (solo con `document.visibilityState === "visible"`); `NightDetail` view: juegos ordenados por votos (luego fijados, luego puntuación), nombres de quien votó, `VoteButton` (optimista), Girar con votos, «Jugar este» → `/games/:gameId/plays/new?night=<id>`, marcar jugado; anfitrión: `InviteFriends`, `ShareLink` (crear/copiar/Web Share/revocar/regenerar; aviso «quien tenga el enlace verá los nombres de quien vota»; muestra el token **solo** en la respuesta de creación), quitar juegos, cerrar noche; amigo aceptado: `SuggestGame` (combobox sobre su biblioteca `owned` del catálogo), salir. `notFound()` si `getNight` → `null`.

- [ ] **Step 1:** Implementar con los errores mostrados por `toNightError`.
- [ ] **Step 2:** `typecheck`, `lint`, `routes:map`.
- [ ] **Step 3:** Comprobar en el navegador con dos cuentas (anfitrión y amigo).
- [ ] **Step 4: Commit** — `feat(nights): detalle de la noche con votos y sugerencias`.

### Task 9: Página pública del invitado

**Files:**
- Create: `src/app/[locale]/n/[token]/page.tsx`, `src/features/nights/views/guest-night.tsx`
- Modify: mensajes en 4 idiomas

**Interfaces:**
- Consumes: `GET/POST /api/nights/guest/[token]` (Tarea 6).
- Produces: página sin sesión (fuera de `(app)`), `generateMetadata` con `robots: { index: false, follow: false }`; vista cliente: carga el estado, si `guest` es `null` pide el nombre antes del primer voto, votar/quitar voto, cambiar nombre, sondeo con `usePoll`; 404 → «Este enlace ya no está activo»; 429 → «Demasiados votos seguidos, espera un momento». Sin enlaces a fichas ni a la app salvo «¿Qué es Amika?» a `/`.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `typecheck`, `lint`, `routes:map`.
- [ ] **Step 3:** Comprobar en una ventana privada: unirse, votar, recargar (sigue siendo el mismo invitado), otra ventana privada = otro invitado.
- [ ] **Step 4: Commit** — `feat(nights): página pública para votar sin cuenta`.

### Task 10: «Jugar este» rellena la partida + documentación

**Files:**
- Modify: `src/app/[locale]/(app)/games/[id]/plays/new/page.tsx`, `src/features/plays/views/play-form.tsx` (prop `initialGroupId?: string` y `initialUserIds?: string[]`)
- Create: `src/features/nights/prefill.ts` (+ `.test.ts`)
- Modify: `docs/DECISIONS.md` (ADR-049), `docs/SECURITY.md` (sección de la ruta pública), `docs/ROADMAP.md`, `docs/ROUTES.md`

**Interfaces:**
- Produces: `prefillFromNight(night: NightDetail, roster: { id: string; linkedUserId: string | null }[]): { groupId: string | null; playerIds: string[] }` — miembros aceptados cuyo `userId` coincide con un `linkedUserId` del roster; el formulario aplica primero `groupFill` del grupo y luego esos jugadores sin duplicar. `?group=<id>` (desde el selector sin guardar) solo aplica el grupo. Parámetros inválidos o de otro → se ignoran.

- [ ] **Step 1: Tests que fallan** — `prefill.test.ts`: `accepted linked friend added`, `invited friend not added`, `unlinked friend not added`, `no group returns null groupId`.
- [ ] **Step 2: Fallan** → **Step 3: Implementar** → **Step 4: Pasan** (`npx vitest run src/features/nights/prefill.test.ts`).
- [ ] **Step 5:** Escribir ADR-049 (decisiones del spec con sus «llamadas mías»), sección de SECURITY y fila de ROADMAP.
- [ ] **Step 6: Commit** — `feat(nights): jugar desde la noche y documentación (ADR-049)`.

### Task 11: E2E y verificación completa

**Files:**
- Create: `tests/e2e/app-nights.spec.ts`
- Modify: `tests/e2e/helpers.ts` (usuarios `s` «E2E Sam» y `t` «E2E Tina», sus `STATE_FILE`), `tests/e2e/auth.setup.ts` si enumera usuarios

**Interfaces:**
- Consumes: todo lo anterior. Fixtures con prefijo `9913`; limpiar noches, amistad y juegos de `s`/`t` antes y después.

- [ ] **Step 1: Escribir la E2E** (serial): `picker ranks and spins` (3 juegos en la biblioteca de `s`, filtro 4 jugadores → 2 resultados con motivo, Girar muestra uno); `empty picker explains` (filtro 12 jugadores → estado vacío, Girar deshabilitado); `plan, invite, friend votes and suggests` (contexto de `t`: acepta en `/friends`, vota, sugiere 1); `guest link votes without account` (contexto sin `storageState`: abre `/n/<token>`, escribe nombre, vota; `s` ve el nombre tras ≤ 10 s); `revoked link shows inactive`; `play this pre-fills players`; axe claro/oscuro en `/nights`, `/nights/:id` y `/n/:token`; viewport móvil para `/n/:token`; un recorrido en `es` y `pt`.
- [ ] **Step 2:** Run: `npm run build && npx playwright test tests/e2e/app-nights.spec.ts` → PASS.
- [ ] **Step 3: Suites completas** — `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e`. Expected: todo verde; anotar totales en `docs/ROADMAP.md`.
- [ ] **Step 4: Commit** — `test(nights): E2E de noches de juegos`.
