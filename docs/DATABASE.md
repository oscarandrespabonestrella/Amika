# Amika — Modelo de datos

> v2 · 2026-11-15 (revisado: Clerk como identidad, catálogo bajo demanda, partidas simples). PostgreSQL (Supabase), esquema `public`.

## 1. Convenciones
- **Identidad externa (Clerk)**: los usuarios no viven en `auth.users`. El ID de usuario es el `sub` del JWT de Clerk (`user_2abc…`), por tanto **`text`**, no `uuid`. Helper `public.current_user_id() returns text` = `(select auth.jwt()->>'sub')`. Sin FK a `auth.users`.
- Resto de PK `uuid` (`gen_random_uuid()`); `created_at`/`updated_at` con trigger.
- FKs con índice y `on delete` explícito.
- Locales como `text` con CHECK (`^[a-z]{2}(-[A-Z]{2})?$`), no enum, para añadir idiomas sin migrar tipos.
- Borrado real (RGPD), no soft-delete.
- RLS en **todas** las tablas desde 0001 (ver [SECURITY](SECURITY.md)).
- Estadísticas bajo demanda: vistas/funciones con `security_invoker`.

## 2. Diagrama
```mermaid
erDiagram
  profiles ||--o{ user_roles : has
  profiles ||--o{ library_items : owns
  profiles ||--o{ game_photos : takes
  profiles ||--o{ games : "creates (custom, private)"
  games ||--o{ library_items : "in"
  games ||--o{ game_translations : has
  games ||--o{ game_external_ids : "imported as"
  games ||--o{ game_relations : "expansions"
  games ||--o{ game_terms : tagged
  terms ||--o{ game_terms : used_by
  terms ||--o{ term_translations : has
  games ||--o{ game_photos : "photos of"
  games ||--o{ game_resources : has
  games ||--o{ scoring_sheets : "score sheets"
  scoring_sheets ||--o{ scoring_sheet_versions : versions
  games ||--o{ plays : played
  scoring_sheet_versions ||--o{ plays : used_by
  profiles ||--o{ plays : created_by
  plays ||--o{ play_participants : has
  plays ||--o{ play_expansions : uses
  plays ||--o{ play_photos : has
  play_participants ||--o{ play_scores : has
```

## 3. Identidad
| Tabla | Campos |
|---|---|
| `profiles` | `id text` PK (= Clerk user id, `default current_user_id()`), `display_name`, `avatar_path`, `locale` (default `en`), `theme` (`light\|dark\|system`), `is_public` (default false), timestamps. |
| `user_roles` | `user_id text`, `role` (`admin\|moderator`). Solo escribible con service_role. |

**Creación del perfil**: ya no hay trigger sobre `auth.users`. Se crea (a) de forma perezosa en el primer acceso (`ensureProfile`, idempotente) y (b) por webhook de Clerk `user.created`. El webhook `user.deleted` dispara el borrado de datos (ver SECURITY §8). Webhooks verificados con firma (Svix).

`public.is_admin()` `SECURITY DEFINER`, `search_path` fijo, consulta `user_roles` por `current_user_id()`.

## 4. Catálogo global (caché bajo demanda) — implementado en 0002/0004
El catálogo **no se precarga**: un servicio de servidor consulta la fuente externa (BGG) cuando alguien añade un juego que aún no existe y lo guarda con `service_role` mediante la función atómica `upsert_external_game(jsonb)`. Los usuarios nunca escriben en el catálogo global.

| Tabla | Notas |
|---|---|
| `games` | `kind` (`base\|expansion`), `name`, `original_name`, `year_published`, `min/max_players`, `min/max_playtime`, `min_age`, `original_language`, `cover_url` (solo `https://`, **enlazada, no copiada**), `source` (`bgg\|manual`), `owner_id` (null = global; si no, juego propio privado), `fetched_at`. CHECKs: mín ≤ máx y `(source='manual') = (owner_id is not null)`. Índice GIN trigram sobre `f_unaccent(name)`. |
| `game_translations` | (`game_id`,`locale`): `name`, `description`. BGG aporta solo `en`; los juegos propios, el idioma del usuario. |
| `game_external_ids` | (`game_id`,`source`) y único (`source`,`external_id`): evita duplicados al importar. |
| `game_relations` | Expansiones: `type` (`has_expansion\|expansion_of\|…`), `related_game_id` (nulo si aún no importado) + referencia externa (`related_external_id`, `related_name`). Se resuelve al leer. |
| `terms`, `term_translations`, `game_terms` | **Una sola estructura** para categorías, mecánicas, diseñadores y editoriales (`type`). Sustituye a las 8+ tablas previstas inicialmente (ver ADR-020). |
| `catalog_imports` | Registro por usuario (`user_id`, `source`, `external_id`, `created_at`) para el límite de uso; sin acceso para usuarios. |

**Búsqueda**: `search_games(q, p_kind, p_players, p_max_minutes, p_limit)`, `SECURITY INVOKER` (la RLS decide qué ve cada usuario), insensible a mayúsculas y acentos (`unaccent`), con comodines `%`/`_` escapados, ordenada por similitud.

**Importación**: `upsert_external_game(p jsonb)` crea o actualiza juego + id externo + traducción + términos + relaciones en **una transacción**, es idempotente y solo ejecutable por `service_role`.

**Juego propio**: si no aparece en la fuente, el usuario crea uno (`source='manual'`); solo él lo ve. No se puede promocionar a global desde la API (la RLS lo impide).

**Pendiente (BGG)**: qué campos e imágenes se pueden guardar/mostrar según sus términos; mientras tanto solo metadatos básicos + ID, portada enlazada con atribución.

## 5. Game Center — implementado en 0006
Solo para juegos **globales**: un juego propio y privado no tiene Game Center. El contenido lo escribe un **administrador**; los usuarios solo pueden **proponer preguntas frecuentes** (decisión del usuario, ADR-026).

| Tabla | Notas |
|---|---|
| `game_resources` | `kind` (`rules\|video\|link`), `locale` (null = cualquier idioma), `title`, `url` (solo `https://`) o `youtube_id` (11 caracteres), `is_official`, `sort`. CHECK de forma: un vídeo es **solo** un id de YouTube; el resto, **solo** una URL https. Los manuales con copyright **no se alojan**: solo enlaces. |
| `rules_content` | Resumen de reglas con palabras propias, una fila por idioma (`game_id`,`locale`,`body` ≤20 000). Texto plano. |
| `game_images` | Galería de imágenes **enlazadas** con `attribution` obligatoria (+ licencia y pie opcionales). No se copian archivos. |
| `faq_entries` | `status` (`pending\|published\|rejected`), `created_by`, `reviewed_by/at`. Máximo **5 sugerencias pendientes** por usuario y juego (trigger). |
| `faq_translations` | (`faq_id`,`locale`): `question` ≤300, `answer` ≤3000. |

Visibilidad de FAQ: lo publicado lo ve todo el mundo; una sugerencia pendiente o rechazada solo su autor y los administradores. El autor puede editar o retirar la suya **mientras esté pendiente**; nunca puede publicarla él mismo.
Idiomas: se muestra el del usuario, luego el inglés y luego cualquiera, con una etiqueta cuando difiere.

## 6. Biblioteca (privada) — implementado en 0005
`library_items`: `user_id` (por defecto el `sub` del token), `game_id`, `status` (**`owned` | `previously_owned`**; la lista de deseos queda fuera por decisión del usuario del 2026-11-15, añadirla es ampliar el CHECK), `is_favorite`, `rating` (1–10, opcional), `notes` (≤2000), timestamps. Único (`user_id`,`game_id`). RLS: solo el dueño lee, edita y borra; solo puede añadir juegos que **puede ver** (no los privados de otro). Se borra en cascada con el juego y con la cuenta.

`search_library(q, p_status, p_favorites, p_limit)`: la biblioteca del usuario unida a `games`, insensible a acentos, con filtros de estado y favoritos; `SECURITY INVOKER`.

Pendiente a propósito: etiquetas personales y fecha de adquisición (sin necesidad real todavía).

## 7. Partidas (MVP: solo del creador)
| Tabla | Notas |
|---|---|
| `plays` | `created_by text`, `game_id`, `played_at`, `duration_minutes`, `scoring_version_id` (nullable, → `scoring_sheet_versions`, `on delete restrict`), `notes`, `extra jsonb`. |
| `play_participants` | `play_id`, `display_name` (texto libre), `user_id text null` (reservado para enlazar usuarios en Fase 8; en MVP solo el propio creador), `seat`, `is_winner`, `total_score`, `rank`. |
| `play_scores` | `participant_id`, `category_key`, `value jsonb`; único (`participant_id`,`category_key`). |
| `play_expansions` | `play_id`, `game_id`. |
| `play_photos` | `play_id`, `storage_path`. Bucket privado. |

Compartir partidas con otros usuarios (enlace pendiente→aceptado) queda para la Fase 8; el esquema lo admite añadiendo `link_status` sin romper datos.

## 8. Hojas de puntuación — implementado en 0007 y 0008 (Fase 5a)
Cualquier usuario puede crear hojas (ADR-030). En la Fase 5a **todas son privadas**; publicar, votos y «verificada» llegan en la 5c.

| Tabla | Notas |
|---|---|
| `scoring_sheets` | `game_id`, `owner_id` (autor, por defecto el `sub` del token), `title` (≤80), `locale`, `visibility` (`private\|public`; la RLS solo admite `private` por ahora), `copied_from` (→ hoja origen, `set null`). Máx. **20 hojas privadas por usuario y juego** (trigger). `game_id` y `owner_id` no se pueden cambiar. |
| `scoring_sheet_versions` | `sheet_id`, `version` (≥1), `definition jsonb` (objeto, ≤50 000 bytes). Único (`sheet_id`,`version`). **Inmutables**: no hay política de `update` y un trigger lo impide hasta con roles privilegiados. Máx. **50 versiones por hoja**. |

**Numeración y conflictos (0008)**: el cliente indica la versión que va a crear (la que cargó + 1); el trigger solo la acepta si es de verdad la siguiente. Si otra pestaña guardó antes, falla con `23505` y la aplicación lo muestra como «conflicto» en lugar de pisar la última versión. Con `version` nulo se numera sola (max + 1).

**La definición no es de fiar**: un usuario con su JWT puede escribir filas por la API sin pasar por nuestro Zod. Por eso la base impone tipo y tamaño y la aplicación vuelve a validar (`validateDefinition`) cada vez que lee una; el motor (`evaluate`) también revalida y nunca lanza.

**Definición** (`schemaVersion: 1`, validada con Zod): lista de 1–40 categorías con `key` estable y única (`^[a-z][a-z0-9_]{0,29}$`, se genera una vez y no se edita), `label` (≤60), `scoring` (suma al total) y un `type` de un catálogo cerrado: `number`, `count_times`, `per_n`, `boolean`, `choice`, `table` (valor exacto → puntos), `set_bonus` (suma de cuadrados + puntos por serie completa) y `derived` (`sum|product|floor_div|min|max` sobre los **puntos** de otras categorías; sin ciclos). Solo enteros, dentro de ±1 000 000. Ver ADR-031.

## 9. Estadísticas
Vistas/funciones SQL con `security_invoker = true`. Índices: `plays(game_id, played_at)`, `play_participants(user_id, play_id)`. Sin materializar en MVP.

## 10. Storage y fotos propias — implementado en 0003
| Bucket | Acceso |
|---|---|
| `game-photos` | **Privado**; 5 MiB; solo `image/jpeg\|png\|webp`. Ruta `<clerk_user_id>/<game_id>/<uuid>.jpg`. Políticas `storage.objects`: leer/escribir/borrar solo si la primera carpeta es tu id. |
| `avatars` | No se crea: el avatar lo gestiona Clerk. |

`game_photos` (`user_id`, `game_id`, `storage_path`): RLS solo propietario; `CHECK storage_path like user_id || '/%'`; solo sobre juegos que el usuario puede ver; **máximo 10 por usuario y juego** (trigger). El navegador reduce la imagen a ≤1600 px y la recodifica a JPEG, lo que **elimina los metadatos EXIF** (ubicación GPS, etc.). Se muestran con URLs firmadas de 1 h.

Al borrar la cuenta, `deleteUserData` elimina primero los archivos (las filas se borran en cascada, los archivos no) y después el perfil.

## 11. Migraciones aplicadas
`20261115180000_foundations` (perfiles, roles, RLS) · `20261115200000_catalog` (catálogo, búsqueda, RLS) · `20261115210000_game_photos` (fotos + bucket) · `20261115220000_import_function` (importación atómica + tope de fotos) · `20261115230000_library` (biblioteca + `search_library`) · `20261116000000_game_center` (recursos, reglas, imágenes, FAQ) · `20261116100000_scoring_sheets` (hojas y versiones) · `20261116110000_scoring_version_guard` (control de concurrencia de versiones).
Pendientes: partidas (5b), publicar/votos/verificada (5c), vistas de estadísticas (6).
