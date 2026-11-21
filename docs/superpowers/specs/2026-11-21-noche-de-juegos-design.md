# Noche de juegos — selector y votación (diseño)

> 2026-11-21 · Idea n.º 1 de la lista de mejoras («What should we play?»), ampliada por el usuario con planificación, votación de amigos y enlace público para invitados sin cuenta.

## Intención y porqué

Responder «¿a qué jugamos esta noche?» con los juegos que el anfitrión tiene, ajustado a cuántos juegan y al tiempo disponible, en **dos momentos** (decisión del usuario):

1. **En la mesa**: la gente ya está y nadie se decide → un toque, un juego.
2. **Antes**: el anfitrión prepara una lista corta y los asistentes **votan** (decisión del usuario: opción «b», votación).

El filtro por jugadores y duración ya existe en `/library` (`search_library`, migración `20261118110000`); lo nuevo es la **clasificación con motivos**, el **giro aleatorio**, la **noche guardada** y la **votación**.

## Objetivos

- Selector: «quién juega» (un grupo propio o un número) + «tiempo» (≤ N minutos) → lista corta clasificada de la biblioteca del anfitrión, cada juego con su motivo; botón **Girar**.
- Guardar una **noche de juegos** (título, fecha) con su lista corta; fijar y quitar juegos.
- **Amigos con cuenta** (amistades de la Fase 8a) invitados por el anfitrión: ven la noche, votan 👍 por juego y **sugieren juegos de su propia biblioteca uno a uno** (decisión del usuario: opción «c»).
- **Invitados sin cuenta**: **un único enlace público temporal por noche** (decisión del usuario: opción «a»), que se pega en el chat; el invitado escribe su nombre y vota. El navegador recuerda su identidad para cambiar sus votos.
- En la noche: lista ordenada por votos; Girar favorece lo más votado; «Jugar este» abre el formulario de partida con jugadores rellenados.

## No objetivos

- Notificaciones push o correo (no existen en la app). Las invitaciones aparecen en el panel de amigos, como las de partida.
- Ver la biblioteca completa de un amigo; compartir bibliotecas en bloque.
- Que los invitados sin cuenta sugieran juegos (no tienen biblioteca en Amika).
- Comentarios, chat, encuestas de fecha, calendario.
- Estadísticas de noches.

## Anti-objetivos

- Que un enlace público exponga algo más que esa noche (ni bibliotecas, ni partidas, ni perfiles).
- Que el navegador del invitado hable directamente con Supabase (decisión del usuario: enfoque 1).
- Que la noche modifique grupos, jugadores o la biblioteca.
- Duplicados imposibles de detectar: los nombres de quien vota son visibles en la noche (el usuario: «la gente sabe quién va, se nota si alguien vota dos veces»).

## Restricciones

- Next 16 (`proxy.ts`), Clerk + Supabase third-party auth, RLS, ids de usuario `text`.
- Patrón de la Fase 8a: tablas sin escritura directa compartida; funciones `SECURITY DEFINER` que comprueban al llamante (`are_friends`, códigos de error propios).
- Idiomas en/es/fr/pt; sin literales (regla de ESLint); axe claro/oscuro; escritorio + móvil.
- Cada `supabase db push` a dev lo aprueba el usuario.
- Producto genérico: nada específico de un juego concreto.

## Enfoques considerados (para el enlace público)

| Enfoque | Compromiso | Resultado |
|---|---|---|
| **1. Puerta en el servidor**: la página del invitado y sus votos pasan por un route handler de Next que valida el token, limita la frecuencia y llama a funciones SQL ejecutables solo por `service_role` | Algo más de código de servidor; toda la superficie pública en un sitio controlado (como `/api/covers` y los manuales) | **Elegido por el usuario** |
| 2. Funciones de Supabase concedidas a `anon` | Menos código; la función queda abierta en internet, fuera de los límites y registros propios | Descartado |
| 3. Votos firmados que se guardan al abrir la noche el anfitrión | Los votos no se ven hasta entonces; contradice planificar antes | Descartado |

Otras decisiones del usuario en la conversación: alcance de la lista = biblioteca del anfitrión + sugerencias de amigos uno a uno («c»); un enlace compartido por noche («a»).

## Diseño

### Rutas

| URL | Quién | Vista |
|---|---|---|
| `/nights` | anfitrión/amigos (con sesión) | lista de mis noches + invitaciones; «Elegir juego ahora» (selector sin guardar) |
| `/nights/new` | anfitrión | selector → guardar como noche |
| `/nights/:id` | anfitrión y amigos aceptados | lista corta, votos, sugerencias, Girar, «Jugar este» |
| `/n/:token` | **público** (sin sesión) | página de invitado: nombre + votar |
| `GET/POST /api/nights/guest/[token]` | público | estado de la noche / votar, cambiar nombre |

`/nights` entra en `PROTECTED_PATH` de `src/proxy.ts`; `/n` **no**. Entrada nueva en Inicio (tarjeta «Noche de juegos») y en la navegación junto a Biblioteca *(llamada mía: dónde exactamente en la navegación lo decide el plan según el espacio en móvil)*.

### Clasificación (pura, `features/nights/rank.ts`)

Entrada: juegos **propios con estado `owned`**, excluidas expansiones (`kind`), filtrados por número de jugadores y minutos con la misma semántica que `search_library`; por cada juego: partidas del anfitrión (número, fecha de la última), favorito, valoración.

Puntuación *(llamada mía, ajustable)*: nunca jugado +3; días desde la última partida (hasta +3, saturado a 180 días); favorito +2; valoración (rating − 5) × 0,3. Empates por nombre. Devuelve los 5 primeros con **motivos** (claves i18n: `neverPlayed`, `notPlayedFor{months}`, `favorite`, `highlyRated`, `fitsPlayers`). Sin número de jugadores → no filtra por jugadores.

**Girar**: sorteo ponderado entre la lista corta (peso = puntuación normalizada + 1 por voto); con la noche guardada, los votos dominan. Semilla inyectable para tests. Animación breve respetando `prefers-reduced-motion`.

Datos: una función SQL `security invoker` de solo lectura `picker_candidates(p_players, p_max_minutes)` que devuelve biblioteca + `play_count` + `last_played_at` del anfitrión (sus partidas como dueño o miembro, como en `stats_shared`).

### Modelo de datos (migración nueva)

- `game_nights`: `id`, `owner_id` (default `current_user_id()`), `title` (1–80), `starts_on` date, `players` smallint null, `max_minutes` smallint null, `group_id` null (atajo; si se borra el grupo, `set null`), `status` (`open`/`closed`), timestamps.
- `game_night_games`: `night_id`, `game_id`, `added_by` text (usuario), `source` (`host`/`suggested`), `pinned` bool, `name_snapshot` text, `cover_snapshot` text null, `created_at`; único (`night_id`, `game_id`).
- `game_night_members`: `night_id`, `user_id`, `status` (`invited`/`accepted`/`declined`), `invited_at`, `responded_at`.
- `game_night_links`: `night_id` (uno activo por noche), `token_hash` (sha256), `expires_at`, `revoked_at`, `created_at`.
- `game_night_guests`: `id`, `night_id`, `display_name` (1–40, recortado), `guest_key_hash`, `created_at`.
- `game_night_votes`: `night_game_id`, y **exactamente uno** de `user_id` / `guest_id`; únicos por votante y juego.

RLS activado; el anfitrión gestiona sus filas; los amigos aceptados **leen** la noche por políticas que llaman a una función `is_night_member(night)`; **toda escritura compartida** (invitar, responder, votar, sugerir, salir) va por funciones `SECURITY DEFINER` con errores propios (`GN001` no es tu amigo, `GN002` noche cerrada, `GN003` ya invitado, `GN004` tope, `GN005` enlace no válido/caducado/revocado, `GN006` juego no está en tu biblioteca, `42501` no es el anfitrión). Las funciones de invitado (`guest_*`) solo tienen `grant execute` a `service_role`.

**Juegos propios (custom)** del anfitrión: pueden estar en la lista; los demás ven solo `name_snapshot`/`cover_snapshot`, sin enlace a la ficha *(llamada mía; en las partidas compartidas se prohibieron — PI002 — porque exponen la ficha; aquí solo se copia nombre y portada)*. Las sugerencias de amigos solo admiten juegos del **catálogo** que el amigo tenga como `owned`.

### Topes *(llamadas mías)*

20 noches abiertas por anfitrión · 12 juegos por noche · 3 sugerencias por amigo y noche · 30 amigos invitados · 30 invitados por enlace · enlace caduca al final del día siguiente a `starts_on` (UTC) y se puede revocar o regenerar · una noche pasa a `closed` sola al caducar (se evalúa al leer) o a mano.

### Enlace público

- Token aleatorio de 32 bytes (base64url) en la URL `/<locale>/n/<token>`; en la BD solo su hash. Se muestra una vez al crearlo, con botón Copiar y «Compartir» (Web Share API si existe).
- Primer voto: el invitado escribe su nombre; el servidor crea `game_night_guests` y devuelve una **cookie httpOnly, `SameSite=Lax`, `Secure`, `Path=/api/nights/guest`**, con la clave del invitado (aleatoria; en la BD su hash), válida hasta la caducidad del enlace. Sin cookie → nuevo invitado.
- Límite de frecuencia en el route handler: 30 escrituras/min por invitado y 300/h por enlace (registro en Postgres, como los manuales; límite blando).
- La página pública muestra: título, fecha, nombre visible del anfitrión, juegos (nombre, portada, jugadores, duración), recuento de votos **y nombres de quien votó** (amigos por su nombre visible, invitados por el escrito). Al crear el enlace, el anfitrión ve el aviso «quien tenga el enlace verá los nombres de quien vota» *(llamada mía)*.
- `robots: noindex`, sin cabecera `Referer` hacia fuera (`Referrer-Policy: no-referrer` en esa ruta), CSP existente.
- Actualización: sondeo cada 10 s mientras la pestaña está visible, en la página pública **y** en `/nights/:id` *(llamada mía: más simple que Realtime con políticas para votos; se puede pasar a Realtime después)*.

### «Jugar este»

Abre `/games/:id/plays/new?night=<id>`: el formulario añade los miembros del `group_id` de la noche (lógica de 8b) y los amigos aceptados vinculados a jugadores del roster. Los invitados sin cuenta no se añaden solos (sus nombres no son jugadores). Marca el juego como jugado en la lista (una noche suele tener varios juegos) y **no** cierra la noche; se cierra al caducar o a mano *(llamada mía)*.

### Selector sin guardar

En `/nights`, «Elegir juego ahora» usa la misma vista del selector sin crear filas: lista corta + Girar + «Jugar este» (con el grupo elegido).

## Pruebas

- Unitarias: `rank.ts` (puntuación, motivos, filtros, empates, sorteo con semilla), esquemas de entrada, cookies/token (hash, caducidad), límites.
- Integración RLS/SQL: aislamiento entre anfitriones; amigo no invitado no ve nada; amigo invitado no ve hasta aceptar *(llamada mía: ve título/fecha/anfitrión en la invitación)*; no se sugiere un juego ajeno; votos únicos; funciones `guest_*` inaccesibles para `authenticated`/`anon`; topes.
- E2E (prefijo **9913**, usuarios de test existentes): crear noche, invitar, votar como amigo, enlace público en contexto sin sesión, cambiar voto, revocar enlace → 404 con mensaje, «Jugar este» rellena; axe claro/oscuro; en/es/fr/pt; móvil.

## Queda para el plan

- Nombres exactos de archivos dentro de `features/nights/` (views/components/services/actions según ADR-047) y regenerar `docs/ROUTES.md` con `npm run routes:map`.
- Diseño visual de la tarjeta de Girar y de la página pública.
- ADR nuevo (ADR-049) con estas decisiones y una sección en `docs/SECURITY.md` para la ruta pública.
