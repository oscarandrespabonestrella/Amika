# Fase 5 — Partidas y hojas de puntuación (diseño)

> 2026-11-16 · Estado: pendiente de aprobación · Sustituye lo previsto en ROADMAP fase 5, DATABASE §7–8 y SECURITY (`scoring_configs`: «solo admin»).

## 1. Intención
El usuario juega a juegos con muchas categorías de puntos (7 Wonders, Wingspan, Harmonies…) y quiere registrar la partida sin hacer cuentas a mano. Por eso el motor de puntuación es el núcleo de la fase, no un añadido. A largo plazo quiere hojas específicas por juego y puntuar a partir de una foto de la hoja (Fase 7).

## 2. Objetivos, no objetivos, antiobjetivos
**Objetivos**
- Cualquier usuario crea hojas de puntuación con un editor de formulario (sin escribir fórmulas) y las deja privadas o las publica para todos.
- Registrar una partida con participantes por nombre, puntuación por categoría, ganador/es, duración, expansiones y notas.
- Los usuarios pueden elegir la hoja más fiable gracias a votos, avisos y un sello de «verificada» del administrador.

**No objetivos (esta fase)**
- Fotos de partida y puntuación por imagen (Fase 7). Compartir partidas con otros usuarios, amigos, grupos (Fase 8). Estadísticas (Fase 6).
- Fórmulas libres anidadas. Decimales en puntuaciones (solo enteros).

**Antiobjetivos**
- Hojas erróneas o abusivas que lleguen a todos sin freno; una partida cuyo total cambie porque alguien editó la hoja después; evaluar código del usuario (`eval`).

## 3. Enfoques considerados
| | Qué es | Pros / contras |
|---|---|---|
| A | Catálogo cerrado de tipos de campo | Editor y validación simples; no cubre reglas raras sin tocar código |
| B | Árbol de fórmulas libre | Lo expresa todo; editor difícil en móvil, más abuso posible |
| **C (elegido)** | A + un tipo «derivado» que calcula desde otras categorías con operaciones fijas | Cubre los tres juegos objetivo; editor sigue siendo un formulario |

Reparto en tres entregas con revisión tras cada una (elegido por el usuario).

## 4. Decisiones del usuario
- Cualquier usuario puede crear hojas; **publicar** para todos también está abierto a cualquiera, con mecanismo de fiabilidad (votos, avisos, verificada).
- Cualquier usuario puede **copiar** una hoja publicada y modificar su copia.
- Motor opción C. Fotos de partida y puntuación por imagen quedan para la Fase 7. Expansiones en la partida: sí.

## 5. Motor de puntuación (`features/scoring/engine`)
Módulo puro, sin React ni Supabase. Se ejecuta en cliente (totales en vivo) y en servidor (recálculo autoritativo al guardar; el cliente nunca decide el total).

**Hoja = lista ordenada de categorías**, cada una con `key` estable, `label`, `type` y límites. Tipos:
`number` (entero), `count_times` (cantidad × puntos), `per_n` (1 punto cada N, división entera), `boolean` (sí/no → puntos), `choice` (una opción de varias, cada una con puntos), `table` (valor → puntos, interpolación no), `set_bonus` (varios contadores: suma de cuadrados + puntos por juego completo, como la ciencia de 7 Wonders), `derived` (operación fija `sum|product|floor_div|min|max` sobre otras categorías por `key`).
El total es la suma de las categorías marcadas como puntuables (las de apoyo pueden no sumar).

**Validación (Zod + reglas)**: `key` únicas; los `derived` solo referencian claves existentes, sin ciclos (orden topológico); máximo 40 categorías; tablas ≤ 50 filas; valores enteros en ±1 000 000; etiquetas ≤ 60 caracteres. Sin `eval`, sin cadenas ejecutables. Evaluación determinista y total (nunca lanza por entrada del usuario; valor inválido → error de campo).
**Preparado para Fase 7**: cada categoría tiene clave, etiqueta, tipo y rango, de modo que un modelo de visión pueda proponer valores por clave y el usuario los confirme.

## 6. Datos (migración nueva, sobre DATABASE §7–8)
Decisión mía: separar identidad de hoja y versiones.
- `scoring_sheets`: `id`, `game_id`, `owner_id` (autor), `title`, `locale` (idioma de las etiquetas), `visibility` (`private|public`), `copied_from` (nullable), `verified_at/by` (nullable), `unpublished_at` (moderación), timestamps. Una hoja de un **juego propio privado** solo puede ser `private` (CHECK/trigger).
- `scoring_sheet_versions`: `sheet_id`, `version`, `definition jsonb`, `published_at`. Inmutable una vez creada (trigger); editar = nueva versión. Único (`sheet_id`,`version`).
- `scoring_votes`: `version_id`, `user_id`, `play_id`, `kind` (`up|flag`), `reason` (≤300, obligatorio en `flag`). Único (`user_id`,`version_id`). RLS: solo se vota con una partida **propia** que use esa versión. Los votos son por versión: una corrección empieza limpia.
- `plays` (`scoring_version_id` nullable), `play_participants`, `play_scores`, `play_expansions` como en DATABASE §7, sin `play_photos` (Fase 7). `total_score`, `rank`, `is_winner` los fija el servidor. Empates: todos los empatados son ganadores.
- RLS: hojas privadas solo del autor; públicas visibles para todos (salvo desactivadas); solo el autor crea versiones; solo el administrador pone/quita `verified` y desactiva (vía `service_role`/función). Partidas y sus hijas: solo el creador. Todo borrado en cascada con la cuenta; las hojas públicas de un usuario borrado pasan a anónimas, no se eliminan (decisión mía: otros pueden tener partidas con ellas) — **a confirmar en el plan frente a RGPD**.
- Límites (decisión mía, ajustables): 20 hojas privadas por usuario y juego; publicar hojas con tope diario por usuario; 5 000 partidas por usuario.

## 7. Elección de la hoja más fiable
Al crear una partida, la hoja por defecto es: **verificada** → si no hay, la de mejor puntuación; las demás a un toque. La puntuación es el **límite inferior de Wilson** de la proporción de «👍» frente a «avisos», para que pocas valoraciones no ganen a muchas (fórmula mía). Aviso = «total incorrecto» con motivo. El administrador desactiva una hoja con avisos repetidos (se oculta de la elección; las partidas existentes la conservan).

## 8. Partidas
Crear, ver, editar y borrar las propias. Una partida sin hoja es válida: un único total manual por participante (decisión mía, para juegos sin hoja aún). Participantes con nombre libre (máx. 12), orden de asiento, notas ≤ 2 000, duración, fecha, expansiones del juego base. Edición de una partida recalcula con la versión que usó. Al terminar con hoja, se ofrece 👍/aviso.
**Entrada (decisión del usuario, 2026-11-16)**: las partidas se registran **solo desde la ficha del juego** (botón «Registrar partida» y su historial en la propia ficha); no hay elemento nuevo en la navegación principal.
**Decisiones mías para la 5b** (ajustables): la hoja de una partida queda fija tras crearla (cambiar de hoja = partida nueva); gana la puntuación más alta (empates: todos ganan); si nadie tiene puntuación registrada no hay ganador; se guarda de forma atómica con una función SQL; la FK a la versión es `no action` (no `restrict`) para que borrar cuenta o juego siga limpiando en cascada, y borrar una hoja con partidas da un aviso claro.
UI en en/es/fr; etiquetas de categoría en el idioma de la hoja (texto del usuario, sin traducción automática). Móvil primero: entrada de puntos por jugador con totales en vivo, objetivos táctiles ≥ 44 px, accesible por teclado.

## 9. Entregas y criterio de «hecho»
1. **Motor + hojas + editor**: motor con tests exhaustivos (7 Wonders, Wingspan, Harmonies reproducidos con sus reglas), migración y RLS probadas, editor de hojas privadas con versiones y copia.
2. **Partidas**: crear/editar/borrar con hoja o total manual, recálculo en servidor, ganadores y empates, historial por juego.
3. **Compartir y fiabilidad**: publicar, votos, avisos, verificada, orden por Wilson, desactivación, topes.
Cada entrega: unitarias + RLS/SQL + E2E (escritorio y móvil, en/es/fr, axe claro/oscuro) verdes, docs actualizados (DATABASE, SECURITY, ROADMAP, nuevos ADR) y revisión del usuario.

## 10. Lo que queda al implementador
Diseño visual del editor y de la entrada de puntos, nombres de tablas/columnas finos, textos, paginación del historial, y el detalle de los topes numéricos, siempre dentro de los límites de arriba.

## 11. Riesgos
- Hojas públicas incorrectas: mitigado por votos, avisos, verificada y desactivación; sigue exigiendo vigilancia del administrador.
- Complejidad del editor para `set_bonus`/`derived` en móvil: plantillas prellenadas (copiar una hoja existente) como vía principal.
- Abuso de publicación: topes y desactivación; revisar antes de abrir al público (Fase 9).
