# Fase 6 — Jugadores y estadísticas (diseño)

> 2026-11-16 · Estado: aprobado por el usuario en la conversación (opción 2 «lista de jugadores propia», biblioteca de gráficos) · Sustituye lo previsto en ROADMAP fase 6 y en DATABASE §7 (`display_name` de los participantes) y §9.

## 1. Intención
Ver quién gana más, con qué puntuaciones y cómo evoluciona cada juego. Los rivales de una partida pueden ser **texto libre o usuarios**, y un nombre libre debe poder **renombrarse o enlazarse a un usuario cuando esa persona cree su cuenta**. Por eso un jugador deja de ser un texto suelto en cada partida y pasa a ser una entidad.

## 2. Decisiones del usuario
- Jugador = texto libre **o** usuario; con el tiempo un nombre libre se puede cambiar o enlazar a una cuenta.
- **Lista de jugadores propia** (opción 2): cada partida referencia un jugador de la lista del creador; renombrar o fusionar se hace en un solo sitio y las estadísticas lo siguen. El enlace a cuentas ajenas (invitación y aceptación, estadísticas cruzadas) queda para la Fase 8; el modelo ya lo admite.
- **Usar la mejor biblioteca de gráficos disponible** en lugar de escribirlos a mano: **shadcn/ui Chart sobre Recharts 3** (misma pila que el proyecto, colores `--chart-N` claros/oscuros, teclado y lector de pantalla activados por defecto en Recharts 3).
- Se reparte en **6a** (lista de jugadores) y **6b** (estadísticas y gráficos), con revisión tras cada una.

## 3. Modelo (6a)
- `players(id, owner_id, name, linked_user_id, …)`: del creador; único por (`owner_id`, nombre normalizado = minúsculas, sin acentos, espacios colapsados) para que «Ana» y «ana » sean la misma; `linked_user_id` solo puede ser el propio creador por ahora (**«soy yo»**, como máximo uno); tope 200 por usuario.
- `play_participants.player_id` (obligatorio, FK `no action`) sustituye a `display_name`; único (`play_id`,`player_id`): **un jugador no aparece dos veces en una partida**. Borrar un jugador solo si no tiene partidas; **fusionar** mueve sus partidas a otro (se rechaza si jugaron juntos en alguna).
- `save_play` recibe por participante `playerId` o `name` (si es nuevo lo crea en la misma transacción, o reutiliza el existente con el mismo nombre normalizado).
- Migración de datos: un jugador por (creador, nombre normalizado) a partir de los nombres existentes; si una partida tenía dos nombres que normalizan igual, el segundo pasa a «Nombre (2)».
- Interfaz: selector de jugador (combobox accesible con búsqueda; «Crear “texto”» si no existe; no deja elegir dos veces el mismo), página **Mis jugadores** (renombrar, fusionar, borrar si no tiene partidas, «soy yo»), accesible desde Ajustes y desde el formulario de partida.

## 4. Estadísticas (6b, se planificará tras la 6a)
- **Por juego** (en la ficha): partidas, victorias y % por jugador, media y mejor puntuación, evolución de puntuaciones, duración media, desglose por categoría cuando hay hoja.
- **Personales**: mis victorias y %, juegos más jugados, cara a cara contra cada jugador (necesita «soy yo»).
- Vistas/funciones SQL con `security invoker` sobre `player_id`; gráficos con shadcn Chart/Recharts y los tokens `--chart-N`; cada gráfico con tabla o resumen accesible equivalente.

## 5. Decisiones mías (ajustables)
No se crea ningún jugador «yo» automáticamente (se marca desde Mis jugadores); no hay elemento nuevo en la navegación principal en la 6a (Mis jugadores cuelga de Ajustes y del formulario; las estadísticas de la 6b decidirán su sitio); la normalización de nombres la decide la base de datos y el navegador solo la imita para el selector; renombrar a un nombre que ya existe se rechaza (hay que fusionar).

## 6. Fuera de alcance
Invitaciones y enlace a cuentas ajenas, estadísticas compartidas entre cuentas (Fase 8); estadísticas por grupo; importar jugadores.

## 7. Riesgos
- Migrar nombres libres existentes a jugadores puede fundir a dos personas con el mismo nombre: se resuelve fusionando/renombrando después (y no hay datos reales masivos todavía).
- El selector con búsqueda debe ser accesible por teclado y en móvil: se prueba con axe y E2E.
