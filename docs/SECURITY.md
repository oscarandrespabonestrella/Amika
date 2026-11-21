# Amika — Seguridad y privacidad

> v2 · 2026-11-15 (revisado: autenticación con Clerk)

## 1. Principios
Defensa en profundidad: validar en cliente (UX) **y** servidor; autorización en la Server Action **y** RLS; mínimo privilegio; secretos solo en servidor; ocultar un botón nunca protege una operación.

## 2. Autenticación (Clerk)
- **Clerk** gestiona registro, verificación de email, login/logout, reset de contraseña, sesiones y protección anti-bot/abuso. También envía los correos, así que **no se necesita SMTP propio** para el flujo de auth. OAuth/social login se activa desde Clerk sin tocar el dominio de la app.
- **Supabase** no autentica: acepta el JWT de Clerk como *third-party auth provider* (configuración en ambos dashboards). El cliente Supabase se crea con `accessToken: () => session.getToken()`; las políticas RLS leen `auth.jwt()->>'sub'`.
- Verificación en servidor: `await auth()` (Clerk) en cada Server Action y Route Handler; sin sesión → rechazo.
- Mensajes de error claros sin enumerar cuentas (comportamiento por defecto de Clerk).
- Rutas protegidas en `proxy.ts` con `clerkMiddleware` envolviendo el proxy de next-intl.
- **Webhooks de Clerk** (`user.created`, `user.updated`, `user.deleted`) en un Route Handler con verificación de firma Svix; usan service_role solo dentro de ese handler.
- **Límite/atención**: instancias de *producción* de Clerk requieren dominio propio y las de *desarrollo* son solo para pruebas (a confirmar en la doc vigente antes de abrir a otras personas). Free tier: ~10.000 MAU (verificar).
- Dependencia de proveedor: IDs de usuario son strings de Clerk; si se migrase de proveedor habría que remapear `profiles.id`.

## 3. Autorización
Roles `admin`/`moderator` en `user_roles` (solo service_role puede escribir). `is_admin()` `SECURITY DEFINER` con `search_path` fijo. Toda acción admin comprueba rol en servidor. No se confía en metadatos editables por el cliente.

## 4. Matriz RLS (activa en todas las tablas)
Todas las políticas usan `(select auth.jwt()->>'sub')` (≡ `current_user_id()`), siempre con `to authenticated` salvo lecturas públicas.

| Tabla | SELECT | Escritura |
|---|---|---|
| `profiles` | propio; otros solo si `is_public` (vista limitada) | solo propio |
| `user_roles` | propio | ninguna (service_role) |
| `games`, traducciones, relaciones, etiquetas, media | globales (`owner_id is null`): todos; propios: solo el dueño | **catálogo global**: solo service_role / admin; **juego propio**: su dueño |
| `game_photos` | solo dueño | solo dueño; ruta dentro de su carpeta; solo sobre juegos visibles; máx. 10 por juego |
| Storage `game-photos` | solo dueño (primera carpeta = su id) | solo dueño |
| `catalog_imports` | nadie | solo `service_role` |
| `terms`, `game_terms`, `game_external_ids`, `game_relations` | según la visibilidad del juego | solo `service_role` |
| `game_resources`, `rules_content`, `game_images` | quien ve el juego | solo administradores, y solo sobre juegos globales |
| `manual_suggestions` | su autor y administradores | proponer: cualquiera (siempre `pending`, como sí mismo y solo en juegos globales; máx. 5 pendientes por juego); retirar: el autor si está pendiente; rechazar/borrar cualquiera: administradores |
| `manual_requests` | nadie | solo `service_role` |
| `faq_entries` | publicadas: todos; pendientes/rechazadas: su autor y administradores | sugerir: cualquiera (siempre `pending` y como sí mismo); editar/retirar: el autor mientras esté pendiente; publicar/rechazar/borrar cualquiera: administradores |
| `faq_translations` | igual que su entrada | igual que su entrada |
| `scoring_sheets` | el autor; cualquiera si es `public` y no está desactivada; el administrador; y quien tenga una partida con una de sus versiones (aunque se despublique o desactive). Nunca se expone el autor | solo el autor: `title`, `locale`, `visibility` (publicar solo juegos del catálogo, 5 al día); `published_at`, `verified_*`, `disabled_*` solo por trigger o funciones de administrador (permisos por columna); máx. 20 por usuario y juego |
| `scoring_sheet_versions` | las de las hojas que puede leer | insertar: solo el autor de la hoja (la versión debe ser la siguiente, si no hay conflicto); **nadie actualiza ni borra una versión suelta** (solo se van con su hoja); máx. 50 por hoja |
| `scoring_votes` | solo el propio voto (el administrador, todos) | solo con una partida propia que use exactamente esa versión, nunca sobre la hoja propia; uno por versión; un aviso exige motivo (1–300). Los motivos solo los lee el administrador (`admin_sheet_flags`) |
| Funciones `admin_set_sheet_verified/disabled`, `admin_sheet_flags` | — | `security definer`; comprueban `is_admin()` dentro (42501 si no) |
| `library_items` | solo dueño | solo dueño; solo sobre juegos que puede ver; `user_id` no se puede cambiar ni falsificar |
| `plays`, `play_participants`, `play_scores`, `play_expansions` | solo `created_by` (los hijos, vía su partida) | solo `created_by`; el juego debe ser visible y la versión de hoja también (en la práctica, hojas propias); `play_expansions` solo con expansiones; topes: 5 000 partidas, 12 jugadores, 20 expansiones. Escritura por `save_play` (invoker: aplica la RLS) |
| `players` | solo el dueño | solo el dueño: `name` y `linked_user_id` (solo él mismo o nulo, uno como máximo = «soy yo»); único por nombre normalizado; máx. 200; un participante solo puede apuntar a **tus** jugadores; `merge_players` es `security invoker` (aplica la RLS) |
| `player_groups`, `player_group_members` | solo el dueño (los miembros, vía su grupo) | solo el dueño: nombre único normalizado, máx. 50 grupos; un miembro solo puede ser **tu** jugador en **tu** grupo (la política de inserción comprueba ambos bajo RLS) |

Importación al catálogo global: función de servidor con service_role, con rate limit por usuario y validación de lo recibido de la fuente. Los usuarios no pueden insertar en el catálogo global.

Pruebas de RLS: SQL con `set local role authenticated` y `set local request.jwt.claims = '{"sub":"user_a"}'` contra el proyecto dev; casos mínimos: dueño, otro usuario, anónimo, admin.

## 5. Validación y entradas
Zod en cada Server Action/Route Handler; límites de tamaño y MIME real en subidas; Markdown sanitizado; vídeos solo YouTube (`youtube-nocookie.com`); respuestas de fuentes externas tratadas como no confiables.

## 6. Secretos y configuración
- Cliente: solo `NEXT_PUBLIC_SUPABASE_URL`, clave publicable de Supabase y `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- Servidor (`server-only`): `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, Supabase `service_role`, token de BGG, claves de IA.
- `.env*` fuera de git; variables validadas con Zod al arrancar; escaneo de secretos en CI.
- Cabeceras: CSP con nonce (permitiendo dominios de Clerk), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.

## 7. Logging
Logger central sin PII ni tokens; sin trazas al cliente. Monitorización (Sentry gratuito u otra) en Fase 9.

## 8. Privacidad / RGPD
- Datos mínimos: email (en Clerk), nombre visible, idioma, tema. Clerk y Supabase son encargados del tratamiento: documentarlo en la política de privacidad.
- **Exportar**: “Descargar mis datos” → JSON (perfil, biblioteca, partidas y puntuaciones).
- **Borrar cuenta**: la acción borra datos propios (perfil, biblioteca, partidas, fotos en Storage) y luego el usuario en Clerk; el webhook `user.deleted` actúa como red de seguridad idempotente. Los juegos propios privados se eliminan.
- Sin analítica de terceros en MVP; solo cookies técnicas (Clerk/tema/idioma).
- Pendiente antes de producción: política de privacidad, términos, edad mínima.

## 9. Terceros y propiedad intelectual
- **BoardGameGeek**: proyecto personal y no comercial (confirmado por el usuario) → encaja en su licencia no comercial. Requisitos conocidos: token de autorización, atribución “Powered by BGG”, sin modificar datos, prohibido entrenar IA con ellos. Si se añadiese publicidad o cobros pasaría a ser comercial y requeriría licencia. Pendiente: leer los términos oficiales (la wiki respondió 403 a nuestra herramienta) y confirmar qué se puede guardar en caché.
- Manuales: solo enlaces (nunca se aloja un PDF en nuestro servidor; ver §21 y ADR-046). Vídeos: embed de YouTube. Imágenes: con licencia/atribución.

## 10. Riesgos
| Riesgo | Mitigación |
|---|---|
| Fuga entre usuarios | RLS en todas las tablas + tests de aislamiento |
| JWT de Clerk mal configurado en Supabase | Test E2E: usuario A no lee datos de B |
| Webhook falsificado | Verificación de firma Svix |
| Abuso de la importación a catálogo | Rate limit + service_role solo en servidor |
| Subidas maliciosas | Validación MIME/tamaño, bucket privado, URLs firmadas |
| Dependencia de proveedor (Clerk) | IDs como `text`; capa `features/auth` aislada |
| Dependencias vulnerables | `npm audit`/Dependabot |

## 11. Fase 2: catálogo, importación y fotos
- **Escritura del catálogo global solo desde el servidor**: los usuarios no tienen permisos de escritura sobre `terms`, `game_terms`, `game_external_ids`, `game_relations` ni sobre juegos con `owner_id is null`; probado con 47 tests de RLS/SQL. La función `upsert_external_game` solo la puede ejecutar `service_role`.
- **Entrada externa tratada como no confiable**: el XML de BGG se analiza con `fast-xml-parser` (sin resolver entidades externas; probado contra XXE y bombas de entidades), con tope de 2 MB, y el resultado se valida **otra vez** con Zod antes de la base de datos. Las descripciones se muestran como **texto plano** (nunca HTML). Solo se aceptan portadas `https://` y la ficha las enlaza con `referrerPolicy="no-referrer"`.
- **Límite de uso por usuario**: 10 llamadas/min y 60/h a la fuente externa (también las búsquedas y los intentos fallidos). Registro en `catalog_imports` porque las instancias serverless no comparten memoria; es un límite blando.
- **Token de BGG**: solo en servidor (`BGG_API_TOKEN`), nunca en mensajes de error ni logs; opcional mientras esté pendiente (la interfaz explica que no está disponible). `redirect: "error"` y host fijo.
- **Ids validados**: `^\d{1,9}$` antes de construir cualquier URL externa (sin inyección de parámetros o rutas).
- **Fotos**: privadas por defecto, tipo y tamaño limitados en el bucket, EXIF eliminado en el cliente, URLs firmadas efímeras y borrado completo con la cuenta.
- **Claves de Supabase**: la clave `service_role` debe ser la JWT clásica o una `sb_secret_` **completa**. La CLI y el panel **enmascaran** las secretas nuevas tras crearlas; pegar la máscara produce «Invalid API key» lejos de la causa. `serviceRoleKeySchema` lo detecta al arrancar y lo explica. Cada secreto se valida por separado (un problema con uno no rompe lo que no lo usa).
- **Errores de Next**: los `catch` que envuelven `auth()` llaman a `unstable_rethrow`; si no, se tragan las señales internas de Next (rutas dinámicas, redirecciones).

## 12. Fase 3: biblioteca y juegos propios
- **Biblioteca privada**: 15 tests de RLS (aislamiento, `user_id` no falsificable ni transferible, no se pueden añadir juegos privados ajenos, único por usuario, rangos de valoración y notas, cascada al borrar juego/cuenta).
- **Entradas validadas** con Zod estricto (`.strict()`: sin asignación masiva), también en el servidor; la UI solo ofrece los estados permitidos y la base de datos los refuerza con un CHECK.
- **Editar/borrar juegos propios**: solo el dueño de un juego `manual` (RLS + comprobación explícita); un juego importado da 404. Al borrar, los **archivos** de sus fotos se eliminan antes que la fila (las filas se borran en cascada, los archivos no) y usando la sesión del propio usuario, sin necesitar la clave de servicio.
- **Borrado en dos pasos** en la interfaz (sin clics accidentales).

## 13. Fase 4: Game Center
- **Roles**: el contenido global solo lo escribe un administrador (`user_roles`, `is_admin()`); las acciones del servidor lo comprueban para dar un error claro, y **la RLS es la barrera real** (20 tests: usuario, otro usuario, anónimo, administrador, publicación propia, suplantación, límites).
- **Un usuario no puede publicar** su propia sugerencia: ni al insertar (`status` debe ser `pending` y `created_by` ser él) ni al actualizar; tras publicarse deja de poder editarla.
- **Vídeos**: solo se guarda el **id** de YouTube, extraído por `parseYoutubeId` (hosts permitidos, rechaza falsificaciones como `youtube.com.evil.com`, `youtube.com@evil.com`, `javascript:`, `data:`); la URL del reproductor se construye únicamente desde el id y siempre es `youtube-nocookie.com`.
- **Privacidad del reproductor**: no se pide nada a YouTube hasta que el usuario pulsa «reproducir» (comprobado en E2E); el `iframe` va con `sandbox`.
- **Enlaces y imágenes**: solo `https`, sin credenciales incrustadas; los enlaces externos abren con `rel="noopener noreferrer"`; las imágenes enlazadas con `referrerPolicy="no-referrer"` y con crédito obligatorio.
- **Texto plano**: resúmenes, preguntas y respuestas se muestran como texto (nunca HTML).
- **Rol de administrador**: se concede con `scripts/grant-admin.mjs`, que exige un correo **verificado** en Clerk y rechaza los usuarios de prueba. No hay ninguna pantalla ni acción de la app que cambie roles.
- **Datos personales**: el borrado de cuenta elimina las sugerencias pendientes y deja anonimizadas las publicadas (`created_by` pasa a null).

## 14. Fase 6b: estadísticas
- **Solo lectura y solo lo propio**: las seis funciones de estadísticas son `security invoker`; la RLS de `plays`, `play_participants`, `players` y `games` decide qué se cuenta, así que nadie agrega partidas ajenas. `anon` no puede ejecutarlas (probado). No crean ni modifican datos.
- **Salida acotada**: la serie de puntuaciones se limita a las últimas 200 partidas como máximo; el desglose por categoría, a las últimas 200 con hoja. Un usuario con 5 000 partidas no genera respuestas enormes.
- **Contenido no confiable**: las definiciones de hoja guardadas se validan antes de evaluarlas (una inválida oculta el desglose y no lanza); los nombres de jugador y de juego se muestran siempre como texto.
- **Sin datos nuevos de terceros**: Recharts se ejecuta en el navegador sobre datos ya cargados; no hay llamadas externas ni cookies nuevas.

## 15. Fase 7a: reconocimiento local
- **La imagen no sale del dispositivo** (Fase 7a; reforzado en 7a-2, §17): el reconocimiento se ejecuta en el navegador; al servidor solo llegan como máximo un código de barras y 3 líneas de texto (≤ 80 caracteres), con esquema estricto.
- **Tabla** (migración 0016): `game_barcodes` solo del dueño (tope 500, juego visible, solo se puede reapuntar `game_id`). Los hashes de imagen de 7a y sus funciones se eliminaron en la migración 0017.

## 16. Cabeceras de seguridad y CSP (Fase 7a)
Construidas en `src/lib/security-headers.ts` (puro, con tests) y aplicadas a todas las rutas desde `next.config.ts`.
- **Siempre**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (cámara solo propia; micrófono, geolocalización y pagos desactivados) y, en producción, `Strict-Transport-Security`.
- **Content-Security-Policy**: lista solo lo que la app usa de verdad: Clerk (el host de su API frontal sale de la clave publicable, así que en producción se ajusta solo), Supabase, imágenes de BoardGameGeek, el embed `youtube-nocookie.com` y los motores WebAssembly **propios** (`'wasm-unsafe-eval'`, `worker-src 'self' blob:`). Cierra `object-src`, `base-uri`, `form-action` y `frame-ancestors`, y limita a dónde pueden enviarse datos (`connect-src`).
- **Estado: modo solo informe** (`Content-Security-Policy-Report-Only`) hasta que se active `CSP_ENFORCE=1` en el entorno de **compilación** (Vercel → Environment Variables, luego volver a desplegar). Motivo: la CSP no se puede probar con el dominio de producción de Clerk (registro con protección anti-bots) desde aquí.
- **Evidencia**: cero violaciones de CSP en la app con sesión, en la página de entrada de Clerk y en el worker del modelo con WebAssembly (`app-security-headers.spec.ts`); toda la batería E2E pasó **con la CSP en modo bloqueo** (254 correctas; un fallo de contraste de axe y dos intermitentes que pasan solos, sin relación con la CSP).
- **Para activarla**: 1) desplegar una vista previa, 2) abrir entrada y registro de Clerk y mirar la consola del navegador (no debe haber «Refused to…»), 3) poner `CSP_ENFORCE=1` y volver a desplegar; si algo se rompe, quitar la variable.
- **Compromiso conocido**: `script-src` incluye `'unsafe-inline'` (los scripts de hidratación de Next son en línea; una política con nonce obligaría a renderizar todas las páginas de forma dinámica). Mejora futura.
- **Zod sin JIT en el navegador** (`components/zod-config.tsx`): Zod 4 sondea `new Function`; con una CSP estricta el navegador lo notificaría como violación aunque se capture.
- **Ruta de los motores**: `/zxing/*` (y, desde 7a-2, `/models/*`, `/ort/*` y `/opencv/*`) no pasan por el proxy de idiomas (sus `.wasm` y `.gz` recibían un prefijo `/en` y daban 404).

## 17. Reconocimiento en vivo con cámara (Fase 7a-2)
- **Apagado de serie y por dispositivo**: no se descarga ni se carga nada hasta que el usuario lo activa y confirma el aviso de la descarga (~85 MB). Solo `installModel` descarga el modelo; `createEmbedder` se niega a funcionar (sin descargar) si no está instalado.
- **Motores autoalojados**: el modelo (`/models/`), el motor de ONNX Runtime (`/ort/`) y OpenCV.js (`/opencv/`) se sirven desde nuestro origen (copias en `public/`, fuera de git, hechas por `scripts/copy-model-assets.mjs`); `env.allowRemoteModels = false`: nunca se contacta con Hugging Face ni con una CDN en tiempo de ejecución. Esos directorios no pasan por el proxy de idiomas. Si el modelo se aloja en otro origen https (`NEXT_PUBLIC_MODEL_BASE_URL`), solo ese origen se añade a `connect-src`.
- **La imagen de la cámara nunca sale del dispositivo**: los fotogramas se procesan en un Web Worker y en el hilo principal; las únicas peticiones que genera el reconocimiento son GET de portadas propias (`/api/covers/[gameId]`) y llamadas a acciones del servidor con un código de barras (13 dígitos) o texto. Un E2E (cámara falsa) comprueba que ninguna petición no-GET lleva una imagen ni más de 4 KB.
- **Punto de entrada nuevo `GET /api/covers/[gameId]`**: 401 sin sesión; 404 si el id no es un UUID, el juego no es visible para el usuario (RLS), no tiene portada o su host no es de BoardGameGeek; descarga acotada (https, hosts de BGG, ≤ 5 MB, 25 MP, sin SVG, redirecciones revalidadas) y devuelve un JPEG ≤ 512 px con `Cache-Control: private`. No guarda nada.
- **Cámara**: se pide solo al pulsar «Escanear»; se libera al detener, al ocultar la pestaña, al salir de la página y tras 90 s sin reconocer nada. La política de permisos ya limita la cámara a nuestro origen.
- **Hallazgo abierto (CSP)**: `opencv.js` usa `eval` (embind). Con la CSP en modo informe funciona; con `CSP_ENFORCE=1` se bloquearía y la verificación ORB fallaría (la app degrada a solo CLIP). Antes de activar el modo bloqueo: `'unsafe-eval'` solo en la página de juegos, o OpenCV dentro de un worker servido con su propia CSP. El worker del modelo y ONNX Runtime no producen violaciones (E2E `app-security-headers.spec.ts`).
- **Cadena de suministro**: el modelo CLIP se descarga de Hugging Face **solo al construir** (`prebuild`) y se sirve desde nuestro origen; en tiempo de ejecución no se contacta con ningún tercero (`allowRemoteModels = false`). Pendiente: fijar y verificar el hash del modelo descargado.

## 18. Paquete de referencia de los 500 mejores (Fase 7a-3)
- **Qué viaja**: nada nuevo sobre la imagen de la cámara, que sigue sin salir del dispositivo (E2E: ninguna petición no-GET lleva imágenes ni cuerpos > 4 KB). El paquete (~1 MB) se descarga de **nuestro origen** y solo **después** de activar la función (E2E: cero peticiones a `/reference-pack/` antes de activar; una sola tras activar; ninguna tras recargar).
- **`GET /api/covers/pack/[bggId]`**: 401 sin sesión; id que no sea 1–9 dígitos → 404 sin consultar nada; id fuera del manifiesto → el mismo 404 vacío; la URL de la portada sale **del manifiesto versionado**, nunca de la petición, y pasa por `isAllowedCoverUrl`/`fetchCoverBytes`/`coverJpeg` (https, hosts de BGG, redirecciones acotadas, ≤ 5 MB, 25 MP, sin SVG). No guarda nada y no repite la URL en los errores. No es un proxy abierto. (La prueba E2E no incluye `%2e%2e`: el cliente HTTP lo normaliza antes; lo cubre la prueba unitaria del handler.)
- **Integridad del paquete**: el manifiesto nombra su fichero con el hash de los bytes; el navegador valida el tamaño exacto (`500 × 512 × 4`), que todo número sea finito y que cada vector tenga norma 1. Un paquete truncado, corrupto o abortado **no se guarda** y se conserva el anterior; la función sigue con el catálogo.
- **Datos de terceros**: los vectores derivan de portadas de BoardGameGeek; el volcado `boardgames_ranks.csv` es de uso con sus términos y **no está en el repo**. Uso personal y no comercial, con atribución. En el repo hay **una** portada real (62 KB, `tests/support/fixtures/pack-cover-224517.jpg`) solo como imagen de prueba del E2E: en un repo privado; **retirarla si el repo se hiciera público**.
- **CSP**: sin cambios (mismo origen). Sigue pendiente lo de OpenCV.js y `eval` (§17).
- **Pendiente**: sin checksum fijado de la descarga del modelo en build (§17); el paquete lo genera el desarrollador desde su máquina y se revisa en el diff de git.

## 19. Fase 8a: amigos y partidas compartidas
- **Descubrimiento de cuentas**: no hay búsqueda de usuarios. Una amistad nace de un enlace de un solo uso (122·2 bits aleatorios, caduca a los 7 días, revocable); canjear exige sesión y un clic. `friend_invites` y `friendships` tienen RLS sin políticas y sin permisos: todo pasa por funciones `security definer` que comprueban al llamante. `list_friends()` solo devuelve identificador, nombre y avatar.
- **Qué ve quien no ha aceptado**: solo juego, quién invita y cuándo (`list_my_invites`). Ni participantes ni puntos. Un extraño o un invitado sin aceptar recibe 404 en la pantalla en directo y no recibe eventos de Realtime (probado en `rls-play-sharing.test.ts` y en el spike).
- **Quién escribe qué**: el dueño escribe todo; un miembro aceptado solo los puntos de **su** participante y solo con la partida abierta (`can_write_scores`, aplicado por RLS y otra vez en `save_my_scores`). Un miembro no usa la hoja del dueño para sus propias partidas (`play_sheet`, no política).
- **Vinculación**: `players.linked_user_id` solo puede ser el propio dueño o un amigo que aceptó una solicitud; un disparador lo exige y una actualización directa del cliente falla con 42501.
- **Borrado de cuenta**: antes de borrar el perfil se ejecuta `transfer_or_delete_plays` (solo `service_role`). Las partidas con otros miembros pasan a ellos; no se destruyen estadísticas ajenas.
- **Límites**: 12 miembros por partida, 100 amigos, 10 enlaces activos, 30 invitaciones por usuario y día.
- **Pendiente**: Realtime comparte el límite de conexiones del plan gratuito de Supabase; con ~10 usuarios no es un problema.
- **Realtime y los DELETE**: Supabase no aplica RLS a los eventos DELETE de `postgres_changes` (solo a INSERT/UPDATE). Con `replica identity full` el evento puede traer la fila antigua; el spike (`scripts/realtime-spike.mts`) mostró que solo llega el identificador. Por eso la pantalla en directo **no se fía del DELETE**: ante uno vuelve a leer la partida con RLS. Lo que se filtra es, como mucho, el id de una fila borrada.

## 20. PWA (service worker)
`/sw.js` se sirve con `Cache-Control: no-cache, no-store, must-revalidate`. El service worker solo intercepta navegaciones y, si fallan, devuelve `/offline.html` precacheado: **no guarda respuestas autenticadas ni datos de usuario**. La CSP existente ya cubre `worker-src 'self'`; el manifest cae en `default-src 'self'`.

## 21. Buscador de manuales
- **Entrada no fiable**: toda URL que sale de un buscador es dato hostil. Antes de que el servidor la abra: `https` solamente, sin credenciales ni puerto, ≤500 caracteres, sin IP literal, `localhost` ni sufijos internos (`.local`, `.internal`…), y el nombre se **resuelve** y se rechaza si alguna dirección es privada, de loopback, enlace local (incluye el metadato de la nube), multicast o IPv4 mapeada en IPv6 (`url-safety.ts`). Se repite en **cada salto** de redirección (máx. 3, `redirect: "manual"`).
- **Qué es un PDF**: no basta el `content-type`; hace falta la firma `%PDF-` en los primeros bytes (`pdf-verifier.ts`). Tope de tiempo (8 s verificando, 50 s descargando) y de tamaño (declarado y real: 200 MB al verificar, 100 MB al descargar). Limitación conocida: el `fetch` resuelve el nombre otra vez, así que un DNS hostil podría contestar distinto la segunda vez; la respuesta solo se inspecciona y se retransmite como PDF, nunca se interpreta.
- **El proxy `/api/manuals/file` no es abierto**: exige sesión y **un único** selector: `resource` / `suggestion` (ids de la base de datos, filtrados por RLS: lo no visible responde igual que lo inexistente, 404) o `token` (HMAC-SHA256 con `MANUAL_LINK_SECRET`, ligado a la URL, al juego y **al usuario**, caduca a 1 h; comparación en tiempo constante). Nunca acepta una URL cruda. Responde siempre `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`: un PDF ajeno **no se muestra en línea desde nuestro origen**. El nombre del archivo sale de la URL, nunca de texto del usuario.
- **Cuota de la API de pago**: la caché (`manual_search_cache`) y el contador de llamadas (`manual_requests`, `kind='api_call'`) son solo de `service_role`; el tope mensual global se comprueba antes de cada búsqueda en vivo y el límite por usuario (3/min, 10/día) solo cuando no hay caché. Sin tope, un usuario o un bucle podría agotar el plan gratuito.
- **Claves**: `BRAVE_SEARCH_API_KEY`, `MANUAL_LINK_SECRET` y `MANUAL_MONTHLY_CALL_LIMIT` solo en servidor (`lib/env/server.ts`), nunca `NEXT_PUBLIC`, nunca en logs ni errores. Ambas son opcionales.
- **Coste y abuso**: búsquedas 3/min y 10/día en vivo, descargas (y verificaciones al proponer) 20/h por usuario, en `manual_requests`.
- **Texto no fiable**: los títulos vienen de la web; se limpian de etiquetas, se limitan a 200 caracteres y se pintan como texto (React). La página sin conexión `public/offline/manuals.html` usa `textContent`, nunca `innerHTML`.
- **Copia en el dispositivo**: Cache Storage de quien la pide; el servidor no guarda nada. El service worker solo responde de esa caché a `/offline/manuals/files/*`; las respuestas autenticadas siguen sin cachearse.
- **Derechos de autor**: se guarda el enlace al sitio original, no el documento; se descartan los sitios que realojan PDF ajenos; la interfaz lo recuerda. La copia local es para uso personal de quien la descarga.

## 22. Noche de juegos: ruta pública del invitado (`/n/:token`, `/api/nights/guest/[token]`)
Es la única superficie pública de la función; toda la lógica pasa por **un** route handler de Next (ADR-049).
- **Token y clave hasheados**: el token del enlace (32 bytes aleatorios, base64url) solo se muestra una vez; en la BD queda su sha256 (`game_night_links.token_hash`). La clave del invitado (aleatoria) vive en su cookie y en la BD solo su hash (`game_night_guests.guest_key_hash`). Una filtración de la base de datos no da enlaces ni identidades de invitado utilizables.
- **Solo `service_role`**: las funciones `guest_*` no tienen `grant execute` para `anon` ni `authenticated`; el navegador no habla con Supabase. Se prueba en los tests SQL.
- **Un enlace expone una noche, nada más**: título, fecha, nombre visible del anfitrión, juegos (nombre, portada, jugadores, duración) y votos con los nombres de quien votó. Ni bibliotecas, ni partidas, ni perfiles, ni fichas de juegos propios (solo `name_snapshot`/`cover_snapshot`).
- **CSRF** (el invitado usa cookie): el POST exige `Content-Type: application/json`, rechaza `Sec-Fetch-Site` distinto de `same-origin`/`none` y comprueba que `Origin`, si viene, sea el de la aplicación. Cuerpo máximo 1 KiB.
- **Cookie por enlace**: `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/nights/guest/<token>`, válida hasta la caducidad del enlace. Dos noches no comparten cookie y el navegador no la manda a ninguna otra ruta.
- **Límites de frecuencia**: 30 escrituras/min por invitado y 300/h por enlace (registro en Postgres, límite blando); tope de 30 invitados por enlace. Sin ellos un bucle podría llenar la noche de invitados falsos.
- **Cabeceras**: respuestas con `Referrer-Policy: no-referrer` y `X-Robots-Tag: noindex`; la página `/n/:token` es `noindex` y no envía `Referer` hacia fuera, así el token no se filtra a terceros ni a buscadores.
- **Validez del enlace**: se evalúa en SQL desde la fecha de la noche (caduca al final del día siguiente a `starts_on`, UTC), no desde un valor guardado que pudiera quedar desfasado; además se puede revocar o regenerar (`revoked_at`) y una noche cerrada no acepta votos. Un enlace inválido, caducado o revocado responde igual (error `GN005`).
- **Texto no fiable**: el nombre de invitado (1–40 caracteres, recortado) se pinta como texto (React), nunca como HTML.
- **Limitación conocida**: sin cuentas, nada impide que alguien con el enlace vote dos veces con dos nombres; los nombres son visibles en la noche y el anfitrión puede revocar el enlace.
- **Amigos**: leen la noche solo una vez aceptada la invitación (`is_night_member`); escriben (votar, sugerir, salir) únicamente por funciones `security definer` que comprueban amistad, noche abierta y topes.
