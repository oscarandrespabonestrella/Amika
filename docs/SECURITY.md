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
| `faq_entries` | publicadas: todos; pendientes/rechazadas: su autor y administradores | sugerir: cualquiera (siempre `pending` y como sí mismo); editar/retirar: el autor mientras esté pendiente; publicar/rechazar/borrar cualquiera: administradores |
| `faq_translations` | igual que su entrada | igual que su entrada |
| `scoring_sheets` | el autor; cualquiera si es `public` y no está desactivada; el administrador; y quien tenga una partida con una de sus versiones (aunque se despublique o desactive). Nunca se expone el autor | solo el autor: `title`, `locale`, `visibility` (publicar solo juegos del catálogo, 5 al día); `published_at`, `verified_*`, `disabled_*` solo por trigger o funciones de administrador (permisos por columna); máx. 20 por usuario y juego |
| `scoring_sheet_versions` | las de las hojas que puede leer | insertar: solo el autor de la hoja (la versión debe ser la siguiente, si no hay conflicto); **nadie actualiza ni borra una versión suelta** (solo se van con su hoja); máx. 50 por hoja |
| `scoring_votes` | solo el propio voto (el administrador, todos) | solo con una partida propia que use exactamente esa versión, nunca sobre la hoja propia; uno por versión; un aviso exige motivo (1–300). Los motivos solo los lee el administrador (`admin_sheet_flags`) |
| Funciones `admin_set_sheet_verified/disabled`, `admin_sheet_flags` | — | `security definer`; comprueban `is_admin()` dentro (42501 si no) |
| `library_items` | solo dueño | solo dueño; solo sobre juegos que puede ver; `user_id` no se puede cambiar ni falsificar |
| `plays`, `play_participants`, `play_scores`, `play_expansions` | solo `created_by` (los hijos, vía su partida) | solo `created_by`; el juego debe ser visible y la versión de hoja también (en la práctica, hojas propias); `play_expansions` solo con expansiones; topes: 5 000 partidas, 12 jugadores, 20 expansiones. Escritura por `save_play` (invoker: aplica la RLS) |
| `players` | solo el dueño | solo el dueño: `name` y `linked_user_id` (solo él mismo o nulo, uno como máximo = «soy yo»); único por nombre normalizado; máx. 200; un participante solo puede apuntar a **tus** jugadores; `merge_players` es `security invoker` (aplica la RLS) |

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
- Manuales: solo enlaces oficiales. Vídeos: embed de YouTube. Imágenes: con licencia/atribución.

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
- **La foto no sale del dispositivo**: el reconocimiento (OCR, código de barras, hash de imagen) se ejecuta en el navegador; al servidor solo llegan como máximo 3 líneas de texto (≤ 80 caracteres), un código de barras y un hash de 64 bits.
- **Tablas nuevas** (migración 0016): `game_barcodes` solo del dueño (tope 500, juego visible); `game_image_hashes`: los hashes de portada solo los escribe el servidor (`upsert_cover_hash`, solo `service_role`) y se leen únicamente para juegos visibles; los de fotos propias solo los ve su dueño (tope 20 por juego). `anon` no tiene acceso. Probado en `rls-recognition.test.ts`.

## 16. Cabeceras de seguridad y CSP (Fase 7a)
Construidas en `src/lib/security-headers.ts` (puro, con tests) y aplicadas a todas las rutas desde `next.config.ts`.
- **Siempre**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (cámara solo propia; micrófono, geolocalización y pagos desactivados) y, en producción, `Strict-Transport-Security`.
- **Content-Security-Policy**: lista solo lo que la app usa de verdad: Clerk (el host de su API frontal sale de la clave publicable, así que en producción se ajusta solo), Supabase, imágenes de BoardGameGeek, el embed `youtube-nocookie.com` y los motores WebAssembly **propios** (`'wasm-unsafe-eval'`, `worker-src 'self' blob:`). Cierra `object-src`, `base-uri`, `form-action` y `frame-ancestors`, y limita a dónde pueden enviarse datos (`connect-src`).
- **Estado: modo solo informe** (`Content-Security-Policy-Report-Only`) hasta que se active `CSP_ENFORCE=1` en el entorno de **compilación** (Vercel → Environment Variables, luego volver a desplegar). Motivo: la CSP no se puede probar con el dominio de producción de Clerk (registro con protección anti-bots) desde aquí.
- **Evidencia**: cero violaciones de CSP en la app con sesión, en la página de entrada de Clerk y en el OCR con WebAssembly y su worker (`app-security-headers.spec.ts`); toda la batería E2E pasó **con la CSP en modo bloqueo** (254 correctas; un fallo de contraste de axe y dos intermitentes que pasan solos, sin relación con la CSP).
- **Para activarla**: 1) desplegar una vista previa, 2) abrir entrada y registro de Clerk y mirar la consola del navegador (no debe haber «Refused to…»), 3) poner `CSP_ENFORCE=1` y volver a desplegar; si algo se rompe, quitar la variable.
- **Compromiso conocido**: `script-src` incluye `'unsafe-inline'` (los scripts de hidratación de Next son en línea; una política con nonce obligaría a renderizar todas las páginas de forma dinámica). Mejora futura.
- **Zod sin JIT en el navegador** (`components/zod-config.tsx`): Zod 4 sondea `new Function`; con una CSP estricta el navegador lo notificaría como violación aunque se capture.
- **Ruta de los motores**: `/tesseract/*` y `/zxing/*` no pasan por el proxy de idiomas (sus `.wasm` y `.gz` recibían un prefijo `/en` y daban 404).

## 17. Reconocimiento en vivo con cámara (Fase 7a-2, en curso)
- **Apagado de serie y por dispositivo**: no se descarga ni se carga nada hasta que el usuario lo activa y confirma el aviso de la descarga (~85 MB). Solo `installModel` descarga el modelo; `createEmbedder` se niega a funcionar (sin descargar) si no está instalado.
- **Motores autoalojados**: el modelo (`/models/`), el motor de ONNX Runtime (`/ort/`) y OpenCV.js (`/opencv/`) se sirven desde nuestro origen (copias en `public/`, fuera de git, hechas por `scripts/copy-model-assets.mjs`); `env.allowRemoteModels = false`: nunca se contacta con Hugging Face ni con una CDN en tiempo de ejecución. Esos directorios no pasan por el proxy de idiomas. Si el modelo se aloja en otro origen https (`NEXT_PUBLIC_MODEL_BASE_URL`), solo ese origen se añade a `connect-src`.
