# Fase 8a — Amigos y partidas compartidas en directo

> Diseño · 2026-11-17 · estado: pendiente de aprobación del usuario.
> Fase 8 se divide: **8a** (este documento) · **8b** grupos y estadísticas por grupo · **8c** admin avanzado. 8b y 8c quedan fuera.

## Intención
Una noche de juegos con amigos: una persona **registra (puntúa)** la partida y añade a los jugadores, por nombre suelto o, si ya tienen cuenta, **por usuario**. Los usuarios añadidos **ven el resultado en directo** y **rellenan sus propios puntos** desde su móvil. Quien se registra después de la partida puede **vincularse a su nombre** a posteriori. Las partidas de juegos que el invitado no tiene van a una sección propia: **«Jugadas en casa de otros»**.

## Objetivos
1. **Amigos** por enlace de invitación, sin buscador abierto de usuarios.
2. **Partida compartida**: un único registro, varios usuarios con acceso, cada uno escribe solo su columna; el creador escribe todo y cierra.
3. **Directo**: lo que escribe uno lo ven los demás en segundos, sin recargar.
4. **Confirmación**: añadir a un amigo a una partida le envía una invitación que debe aceptar; hasta entonces no ve nada.
5. **Vincular después**: asociar un nombre suelto de mi lista de jugadores a un amigo, con su confirmación.
6. **«En casa de otros»**: sección derivada, sin acción manual del invitado.
7. **Borrado que no destruye**: si el creador borra, la partida pasa a los demás participantes; solo se elimina cuando no queda nadie.

## No objetivos (8a)
- Grupos, estadísticas por grupo, admin avanzado (8b, 8c).
- Notificaciones fuera de la app (correo, push). Las invitaciones se ven dentro de la app.
- Chat, comentarios, feed, perfiles públicos, búsqueda de usuarios.
- Partidas de **juegos propios** (manuales) compartidas: la ficha de un juego manual es privada de su dueño. Quedan privadas en 8a *(decisión mía, ver «Decisiones mías»)*.
- Servicio de tiempo real propio.

## Anti-objetivos (aunque «funcione» sería un fallo)
- Que alguien pueda **descubrir cuentas** de otras personas (enumerar usuarios o correos).
- Que un invitado vea una partida **sin haber aceptado**, o cambie puntos de otro.
- Que los totales, el orden o el ganador **los decida el cliente** (siguen calculándose en el servidor al cerrar).
- Que borrar una cuenta o una partida **borre estadísticas ajenas** sin querer.

## Restricciones
- Stack actual: Next.js, Clerk (`current_user_id()`), Supabase con RLS; todo acceso del usuario pasa por RLS.
- Hoy una partida es privada del creador en **todas** sus tablas (`plays`, `play_participants`, `play_scores`, `play_expansions`) y los jugadores viven en la lista del creador (`players`); `players.linked_user_id` solo puede ser el propio dueño. Esas reglas cambian aquí y son la parte más delicada.
- Totales y ganador: `src/features/plays/compute.ts`, en el servidor.
- Tope actual de 12 jugadores por partida.
- Preferencia del usuario: **las suites pesadas de tests solo al final de la fase**; en medio, comprobaciones baratas.

## Enfoques considerados
- **A. Un único registro compartido (elegido por el usuario).** Mismas tablas; se añade una tabla de membresía y un dueño actual; RLS pasa de «solo el creador» a «el dueño o un miembro que aceptó»; Realtime de Supabase sobre las mismas tablas. + una sola fuente de verdad, el traspaso al borrar sale casi gratis; − hay que reescribir con cuidado las políticas RLS.
- **B. Una copia por participante, sincronizadas.** + RLS casi igual; − dos escritores sobre copias, justo el conflicto que se quiere evitar.
- **C. Servicio de tiempo real propio.** + control del directo; − infraestructura y permisos duplicados, injustificado para ~10 usuarios.

«Sockets»: no se monta nada propio. Supabase Realtime usa WebSockets gestionados; el navegador solo se suscribe con el cliente que ya existe (`createSupabaseBrowserClient`, token de Clerk).

## Diseño

### 1. Amigos
- `friend_invites(code, created_by, expires_at, used_by, used_at, revoked_at)`: enlace `/{locale}/friends/join/{code}`. Requiere sesión. Al abrirlo, crea la amistad **en los dos sentidos** y consume el código. Caduca (7 días) y se puede revocar.
- `friendships(user_a, user_b, created_at)` con el par ordenado y único. Quitar un amigo la borra; las partidas ya compartidas **no** se tocan.
- Lo único que un amigo ve del otro: nombre visible y avatar, mediante una función (`list_friends`) que no expone `profiles` entero. Sin búsqueda de usuarios.
- Topes: 100 amigos, 10 enlaces activos por usuario.

### 2. Partida compartida
- `plays` gana: `owner_id` (dueño actual; empieza siendo el creador, `created_by` no cambia) y `status` (`open` | `closed`; las partidas existentes pasan a `closed`).
- `play_members(play_id, user_id, status, invited_by, invited_at, responded_at, participant_id)` con `status` ∈ `invited | accepted | declined | left`. El dueño también figura como miembro aceptado.
- `play_participants` gana `user_id` (nullable: nombre suelto = sin cuenta) y `display_name` (instantánea del nombre), porque un invitado **no puede leer la lista de jugadores del dueño**. Se mantiene `player_id` para la lista del dueño.
- RLS: ver/leer si eres dueño o miembro `accepted`. Escribir:
  - dueño: todo, mientras `open`; solo él cierra.
  - miembro: solo `play_scores` de **su** participante, mientras `open`.
  - cerrada: nadie edita salvo el dueño (reabrir queda como mejora, ver «Pendiente»).
- Los miembros leen también la **versión de hoja** con la que se puntúa (hoy solo la ve su dueño) y el juego, si es del catálogo.
- Las notas del invitado sobre su columna no existen; las notas de la partida las edita el dueño.

### 3. Directo
- Realtime `postgres_changes` sobre `plays`, `play_participants`, `play_scores`, `play_members`, con RLS del usuario (las filas que no puede leer no le llegan). Hay que añadir las tablas a la publicación `supabase_realtime`.
- Los DELETE de Realtime no pasan por RLS y traen poco: ante un DELETE la pantalla **vuelve a leer** la partida en lugar de fiarse del evento.
- Si el socket se cae, la pantalla reintenta y hace una lectura periódica (~10 s) como respaldo.
- Los totales en pantalla mientras está abierta son **provisionales** (solo para mostrar). Los definitivos, el orden y el ganador los fija el servidor al cerrar, con `compute.ts`.

### 4. Invitaciones y confirmación
- Añadir un amigo a una partida crea un `play_members` en `invited`. A su cuenta le llega (en directo y al abrir la app) una **bandeja de invitaciones** con una insignia: «X te añadió a una partida de {juego}» → **Aceptar** / **Rechazar**.
- Aceptar: pasa a `accepted` y ve la partida. Rechazar: `declined`; el nombre queda en la partida como jugador suelto y el dueño lo ve como «rechazó».
- Hasta aceptar, el invitado solo ve la invitación (juego, quién, fecha), nunca puntos ni participantes.
- Topes: 12 participantes por partida (ya existe); 30 invitaciones enviadas por usuario y día.

### 5. Vincular después
- El dueño asocia un jugador de su lista a un **amigo**: se relaja la restricción de `players.linked_user_id` (hoy solo «yo»).
- Esa vinculación crea **una invitación agrupada**: «X te asignó N partidas» → aceptar todas o rechazar. Al aceptar, cada una de esas partidas pasa a tener al amigo como miembro y su `participant.user_id` queda fijado.
- Deshacer la vinculación (el dueño) o salirse (el amigo, `left`) no borra la partida.

### 6. «Jugadas en casa de otros»
- Es una **vista derivada**: partidas donde soy miembro aceptado y cuyo juego **no está en mi biblioteca**. Si el juego sí está, la partida aparece en mi historial normal.
- Cuentan en mis estadísticas personales con una etiqueta que las distingue.

### 7. Borrado
- El dueño borra → si hay miembros `accepted`, `owner_id` pasa al miembro aceptado más antiguo y la partida desaparece solo del historial del anterior dueño; si no queda ninguno, se elimina de verdad.
- Un miembro que se sale deja de verla (`left`) sin afectar a los demás.
- **Cuenta eliminada**: hoy `plays.created_by` borra en cascada; con partidas compartidas eso destruiría estadísticas ajenas. Hay que traspasar la partida antes (mismo criterio que arriba) y que la cascada solo borre las que se quedan sin participantes.

## Decisiones mías (revisables)
1. Amistad **bidireccional al abrir el enlace**, sin segunda confirmación: compartir el enlace ya prueba que se conocen. Enlace **de un solo uso** que caduca en 7 días y se puede revocar.
2. **Solo juegos del catálogo** se pueden compartir; las partidas de juegos manuales siguen privadas.
3. Rechazar deja el **nombre suelto** en la partida, visible para el dueño como «rechazó».
4. **`display_name` instantánea** en `play_participants` para que los invitados vean nombres sin acceder a la lista del dueño.
5. Totales provisionales en pantalla, definitivos al cerrar en el servidor.
6. Vinculación posterior con **una sola invitación agrupada** en vez de una por partida.
7. Mientras la partida está abierta, el invitado **no** edita sus puntos tras cerrar; reabrir queda fuera.
8. Sin correo ni push; solo bandeja dentro de la app.

## Pendiente / lo decide quien construye
- Orden de migraciones y **backfill** (`owner_id = created_by`, `status = 'closed'`, `user_id` = «yo» donde ya exista, `display_name` desde `players.name`).
- Diseño exacto de pantallas: amigos, invitaciones, partida en directo, «en casa de otros», en `es`/`en`/`fr`.
- Validación en servidor de los puntos que escribe un invitado con el motor de hojas (categorías y tipos cerrados).
- Si reabrir una partida cerrada hace falta tras usarlo.
- **Primera tarea técnica**: un spike de Realtime con el token de Clerk y RLS (que a un usuario sin acceso no le llegue nada), antes de apoyar el resto en ello.

## Pruebas (política del usuario)
- Se **escriben** con cada pieza: RLS/SQL (qué ve y qué escribe cada rol: dueño, miembro aceptado, invitado, extraño), unitarias del traspaso y los topes, y E2E de «dos navegadores a la vez» para el directo.
- Se **ejecutan** las suites completas solo **al final de la fase**; en medio, typecheck y el test concreto de la tarea. El spike de Realtime y la RLS de «extraño no ve nada» sí se comprueban pronto por ser la base de todo.

## Riesgos
| Riesgo | Mitigación |
|---|---|
| Reescribir RLS de `plays` rompe el aislamiento actual | Tests RLS de «extraño no ve nada» desde el primer día; las políticas nuevas se añaden, no se relajan a ciegas |
| Realtime con token de Clerk no se comporta como se espera | Spike previo; respaldo con lectura periódica |
| Dos personas escribiendo a la vez | Cada cual escribe solo su columna; el dueño edita su propia vista con lectura fresca |
| Enumeración de cuentas | Sin buscador; solo amigos y enlaces de un solo uso |
| Borrar cuenta destruye partidas ajenas | Traspaso antes del borrado (punto 7) |
