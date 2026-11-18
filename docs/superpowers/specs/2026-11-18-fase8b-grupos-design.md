# Fase 8b — Grupos de jugadores (diseño)

> Fase 8 se divide: 8a partidas compartidas (hecha) · **8b grupos (este documento)** · 8c admin avanzado (fuera).

## Intención y porqué

El usuario juega con las mismas personas (p. ej. «los jueves») y hoy, al registrar una partida, debe elegir a cada jugador uno por uno en `PlayerPicker`. Un **grupo** es una lista guardada de personas de su roster que se añade a la partida con un clic.

## Objetivos

- Crear, renombrar y borrar grupos; añadir y quitar miembros (jugadores del roster propio).
- En el formulario de partida, «Añadir grupo» rellena las filas con los miembros.
- Un jugador puede estar en varios grupos.

## No objetivos

- Estadísticas por grupo (el roadmap las mencionaba; decisión del usuario/diseño: fuera de esta fase; se podrían calcular luego desde las partidas sin guardar el grupo en ellas).
- Grupos compartidos entre cuentas, invitaciones, roles o chat. Los grupos son **privados** del dueño.
- Guardar en la partida a qué grupo pertenecía.

## Anti-objetivos

- Que añadir un grupo modifique el grupo: los cambios de la tabla (añadir/quitar gente) son **temporales**, solo de esa partida.
- Que duplique jugadores ya presentes o reemplace lo ya rellenado.

## Comportamiento acordado (del usuario)

- Elegir un grupo **añade los miembros que falten**; los ya presentes se mantienen sin duplicar.
- Tras elegir el grupo, la tabla permite añadir o quitar más gente sin límite y sin tocar el grupo. No hay aviso por superar el máximo de jugadores del juego.
- Los grupos se gestionan en la sección **People** (`/friends` y `/players`, navegación con `PeopleTabs`).

## Approaches

- **A (elegida): tablas propias** `player_groups` (dueño, nombre) y `player_group_members` (grupo, jugador), con `on delete cascade`. Limpieza automática al borrar/fusionar jugadores; RLS simple por dueño. Coste: dos tablas y una migración.
- B: lista de ids en una fila. Descartada: deja ids huérfanos al borrar/fusionar jugadores.
- C: etiqueta de texto en el jugador. Descartada: el grupo no es una entidad, no se renombra de una vez.

## Diseño

**Datos (migración nueva)**
- `player_groups(id, owner_id default current_user_id() → profiles on delete cascade, name 1–60, created_at, updated_at)`; nombre único por dueño tras normalizar (`normalize_player_name`).
- `player_group_members(group_id → player_groups on delete cascade, player_id → players on delete cascade, primary key (group_id, player_id))`.
- RLS: solo el dueño ve/escribe; los miembros deben ser jugadores del mismo dueño (comprobado en la base, no solo en la interfaz). Tope de grupos por usuario y de miembros por grupo (cota alta, como `enforce_player_cap`).
- Al fusionar jugadores (`merge_players`) los miembros del jugador absorbido pasan al conservado sin duplicar.

**Código** (`src/features/groups`, mismo patrón que `players`): servicio, acciones con esquema zod, componentes.

**Interfaz**
- People: nueva pestaña «Grupos» en `PeopleTabs`: lista de grupos, crear, renombrar, borrar y editar miembros con un selector del roster.
- Formulario de partida: selector «Añadir grupo» junto a las filas de jugadores. Rellena las filas libres con los miembros que falten (por `playerId`); cada fila sigue siendo editable y quitable.

```
Jugadores de la partida
  [ Añadir grupo ▾ ]  → Jueves (5) · Familia (3)
  1. Ana   ✕
  2. Luis  ✕
  + Añadir jugador     ← extras temporales
```

**Textos**: i18n en los idiomas existentes del proyecto.

## Pruebas

Unitarias del cálculo «qué miembros faltan», integración de RLS y de fusión (miembros ajenos rechazados), E2E: crear grupo, añadirlo a una partida con una persona ya presente, quitar un miembro sin que cambie el grupo. Las suites pesadas se corren al cerrar la fase.

## A criterio de quien construya

Orden de la lista de grupos, topes exactos, textos, si «Añadir grupo» va en un popover o un menú.
