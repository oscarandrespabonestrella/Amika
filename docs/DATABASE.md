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
  games ||--o{ scoring_configs : versions
  games ||--o{ plays : played
  scoring_configs ||--o{ plays : used_by
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

## 5. Game Center
| Tabla | Notas |
|---|---|
| `game_resources` | `game_id`, `kind` (`rules\|video\|link\|manual`), `locale`, `url`, `title`, `is_official`, `source_locale`. Reglas: siempre `en` + los idiomas que existan, cada uno como fila. Vídeos = ID de YouTube. Manuales solo como enlace oficial. |
| `rules_content` | Resumen propio de reglas: `game_id`, `locale`, `body_md`, `source_locale`, `is_machine_translated`. |
| `faq_entries` / `faq_translations` | Preguntas por juego e idioma. |

## 6. Biblioteca (privada)
`library_items`: `user_id text`, `game_id`, `status` (`owned\|wishlist\|previously_owned`), `is_favorite`, `rating` (1–10), `notes`, `acquired_at`. Único (`user_id`,`game_id`). Añadir un juego a la biblioteca dispara la importación del juego si no está en la caché.

## 7. Partidas (MVP: solo del creador)
| Tabla | Notas |
|---|---|
| `plays` | `created_by text`, `game_id`, `played_at`, `duration_minutes`, `scoring_config_id` (nullable), `notes`, `extra jsonb`. |
| `play_participants` | `play_id`, `display_name` (texto libre), `user_id text null` (reservado para enlazar usuarios en Fase 8; en MVP solo el propio creador), `seat`, `is_winner`, `total_score`, `rank`. |
| `play_scores` | `participant_id`, `category_key`, `value jsonb`; único (`participant_id`,`category_key`). |
| `play_expansions` | `play_id`, `game_id`. |
| `play_photos` | `play_id`, `storage_path`. Bucket privado. |

Compartir partidas con otros usuarios (enlace pendiente→aceptado) queda para la Fase 8; el esquema lo admite añadiendo `link_status` sin romper datos.

## 8. Motor de puntuación
`scoring_configs`: `game_id`, `version`, `status` (`draft\|published`), `definition jsonb` (validado con Zod), `published_at`. Único (`game_id`,`version`). Trigger impide editar `definition` al estar publicada. Las partidas guardan la versión usada.

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
`20261115180000_foundations` (perfiles, roles, RLS) · `20261115200000_catalog` (catálogo, búsqueda, RLS) · `20261115210000_game_photos` (fotos + bucket) · `20261115220000_import_function` (importación atómica + tope de fotos).
Pendientes: biblioteca (Fase 3), Game Center (4), partidas y puntuación (5), vistas de estadísticas (6).
