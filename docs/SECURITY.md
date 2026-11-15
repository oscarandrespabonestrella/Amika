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
| `game_resources`, `faq_*`, `rules_content` | todos (publicados) | admin |
| `scoring_configs` | publicadas: todos; draft: admin | admin; inmutables al publicar |
| `library_items` | solo dueño | solo dueño |
| `plays` y tablas hijas | solo `created_by` | solo `created_by` |
| Storage `play-photos` | solo dueño (ruta `<uid>/…`) | solo dueño |

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
