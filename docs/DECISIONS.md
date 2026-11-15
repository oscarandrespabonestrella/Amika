# Amika — Registro de decisiones (ADR)

Fecha base: 2026-11-15. Estado *propuesto* salvo indicación. Formato: contexto → decisión → consecuencias.

## ADR-001 Modular monolith
Un despliegue Next.js con módulos por feature y límites aplicados por lint.

## ADR-002 Supabase + RLS para datos y Storage
Postgres y Storage gestionados reducen infraestructura y coste. RLS desde la migración 0001; las Server Actions duplican la comprobación.

## ADR-003 Desarrollo sin Docker
No hay Supabase local; se usa un proyecto cloud `boardgame-hub-dev` en la **cuenta nueva** del usuario, con migraciones por CLI. *Alternativa*: Docker Desktop.

## ADR-004 npm como gestor de paquetes
Ya instalado; sin necesidad de pnpm.

## ADR-005 Tema Adaptive con next-themes *(confirmada)*
Clase `dark` + tokens semánticos; modo `system` por defecto; sin flash.

## ADR-006 Registro público libre con verificación *(confirmada)*
Sin invitaciones ni aprobación. La verificación de email la ejecuta Clerk (ver ADR-014).

## ADR-007 i18n con next-intl y prefijo de ruta *(revisada)*
`/{locale}/…`. **UI: `en` (por defecto), `es`, `fr`**; la arquitectura permite añadir más (de, nl…) sin cambiar lógica. Reglas: `en` + los idiomas que existan, como filas por idioma en `game_resources`/`rules_content`. `proxy.ts` combina Clerk y next-intl.

## ADR-008 Estructura por features
`services/` y `schemas/` dentro de cada feature (desviación de la orientación inicial).

## ADR-009 Motor de puntuación declarativo y versionado
JSON validado, sin `eval`, inmutable al publicar.

## ADR-010 Estadísticas bajo demanda
Vistas SQL `security_invoker`; sin tablas derivadas hasta medir.

## ADR-011 Catálogo bajo demanda con BGG como fuente *(nueva)*
El usuario añade juegos por búsqueda manual (y por foto en Fase 7); el servidor importa el juego a una caché global la primera vez que alguien lo necesita. Proyecto personal y no comercial → compatible con la licencia de BGG (token, atribución, sin IA). Juegos no encontrados: entrada propia privada del usuario. *Pendiente*: verificar términos oficiales y qué se puede cachear.

## ADR-012 Contenido de terceros
No alojar manuales con copyright; vídeos con embed `youtube-nocookie.com`; imágenes con licencia/atribución.

## ADR-013 Partidas simples en el MVP *(revisada)*
Los demás participantes son nombres libres; la partida es solo del creador. Compartir con usuarios enlazados (pendiente→aceptado) se pospone a la Fase 8.

## ADR-014 Clerk para identidad *(nueva, decisión del usuario)*
- **Contexto**: se necesita auth gratuita con verificación de email sin montar SMTP/dominio solo para auth.
- **Decisión**: Clerk gestiona identidad y sesiones; Supabase solo datos/Storage y valida el JWT de Clerk (third-party auth). Supabase Auth no se usa.
- **Consecuencias**: IDs de usuario `text` (`sub`); `profiles` se crea de forma perezosa + webhooks; `@supabase/ssr` ya no hace falta (se usa `@supabase/supabase-js` con `accessToken`); políticas RLS con `auth.jwt()->>'sub'`; dependencia de un segundo proveedor; producción de Clerk exige dominio propio (verificar).
- **Alternativas descartadas**: Supabase Auth + Resend (requería dominio), Better Auth/Auth.js (más mantenimiento).

## ADR-015 `cacheComponents` desactivado en Fase 1 *(nueva)*
El scaffold de Next 16 activa `cacheComponents` y `partialPrefetching`. Con Clerk y next-intl obligan a envolver en `<Suspense>` todo lo que lea sesión o idioma, sin beneficio en el MVP. Se desactivan; reevaluar en Fase 9 (rendimiento).

## ADR-016 shadcn con estilo Radix y utilidades estándar *(nueva)*
El CLI de shadcn generó por defecto el estilo `base-nova` (Base UI). Las directrices piden Radix, así que `components.json` usa `radix-nova`. El template importaba `cn` desde un paquete npm genérico (`cn`) de procedencia dudosa: se sustituye por la implementación estándar con `clsx` + `tailwind-merge` en `src/lib/utils.ts`. **Al añadir componentes con `shadcn add`, comprobar que no vuelve a importar `from "cn"`.**

## ADR-017 Webhooks y temas de Clerk sin dependencias extra *(nueva)*
`@clerk/nextjs/webhooks` incluye `verifyWebhook`, así que no se añade `svix`. El tema visual de Clerk usa `@clerk/ui/themes` (`shadcn`), que hereda nuestros tokens claro/oscuro.
Además: `@types/node` se sube a 24 (coincide con el Node instalado y lo exige Vitest 5).

## ADR-018 E2E contra la compilación de producción *(nueva)*
Con `next dev`, varios workers de Playwright piden a la vez rutas aún sin compilar y el servidor devolvía de forma intermitente `SyntaxError: Unexpected end of JSON input` (1–2 fallos por ejecución, sin error de nuestro código en los logs). Contra `next build && next start` el resultado fue 42/42 en 4 ejecuciones seguidas, así que se trata como un artefacto del modo dev. El `webServer` de Playwright usa build + start.
Los usuarios de prueba (`bglib-e2e-{a,b}+clerk_test@example.com`) se crean en la instancia de desarrollo de Clerk con `privateMetadata.e2eTestUser = true`, y los helpers se niegan a tocar usuarios sin esa marca. Los `+clerk_test` no envían correo real.

## ADR-019 Nombre del producto: Amika *(decisión del usuario, 2026-11-15)*
El producto se llama **Amika** (antes «BoardGame Hub», nombre provisional). Cambia en la interfaz (APP_NAME, metadatos en en/es/fr), la documentación y el nombre del paquete npm. Se mantienen sin renombrar los identificadores de infraestructura ya creados: proyecto Supabase `boardgame-hub-dev`, app de Clerk `BG_LIB` y la carpeta local `boardgame-lab`. Pendiente: dominio, repositorio y comprobar que el nombre está libre como marca/dominio.

## ADR-020 Catálogo: vocabulario único e importación atómica en SQL *(nueva, Fase 2)*
Categorías, mecánicas, diseñadores y editoriales comparten `terms` + `term_translations` + `game_terms` (columna `type`) en vez de ocho tablas casi idénticas. La importación es una función Postgres (`upsert_external_game`) para que juego, id externo, traducción, términos y relaciones se escriban en una sola transacción e idempotente: un fallo a medias no deja un juego importado a medias. Búsqueda con `pg_trgm` + `unaccent` (`search_games`, `SECURITY INVOKER`).

## ADR-021 Imágenes (decisión del usuario, Fase 2)
De BGG solo se **enlaza** la URL de la portada (con atribución); no se copia ningún archivo mientras sus términos no estén verificados. Las fotos hechas por el propio usuario se guardan en un bucket privado, se reducen y recodifican en el navegador (se pierde el EXIF) y solo las ve su dueño. Queda abierta la opción de descargar portadas de BGG si los términos lo permiten: sería un cambio acotado en el adaptador y en la tabla de medios.

## ADR-022 Fuentes externas detrás de `GameSource` *(nueva)*
La app solo conoce la interfaz `GameSource` (`search`, `fetchGame`, `isConfigured`). BGG es una implementación (`sources/bgg/`). Todo lo no verificado (formato de la cabecera del token, 202/429, campos reales) vive en `client.ts` y `parse.ts`; las respuestas de ejemplo de `fixtures.ts` están escritas a mano y deben sustituirse por respuestas reales en cuanto llegue el token (`bgg.contract.test.ts` se salta hasta entonces).

## ADR-023 Lecciones de la Fase 2 que cambian reglas
- **Claves enmascaradas**: `SUPABASE_SERVICE_ROLE_KEY` = JWT clásica o `sb_secret_` completa; validado al arrancar (ver SECURITY §11).
- **`unstable_rethrow`** en todo `catch` que rodee `auth()`.
- **`loading.tsx` solo en el listado** (grupo de rutas `(list)`): si envuelve la ficha, un id inexistente responde 200 en vez de 404 porque la respuesta ya empezó a enviarse.
- **El botón de borrar foto espera a Clerk** (como los de subida): sin token la petición sale anónima.
- **Prettier no debe formatear artefactos** de test (`test-results/`).
