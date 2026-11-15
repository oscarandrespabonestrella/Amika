# Amika — Roadmap

> v2 · 2026-11-15. Cada fase termina con tests pasando, docs actualizados y revisión del usuario.

## Fases y criterio de “hecho”
| Fase | Alcance | Hecho cuando |
|---|---|---|
| 0 | Análisis y documentación | Docs aprobados |
| 1 | Fundamentos | Usuario se registra con Clerk, entra, cambia tema/idioma; RLS probada; CI verde |
| 2 | Perfiles, caché de catálogo, búsqueda y fichas | Buscar un juego lo importa de BGG y muestra su ficha en en/es/fr |
| 3 | Biblioteca | Añadir/quitar, favoritos, notas, filtros; aislamiento probado |
| 4 | Game Center | Reglas (en + idiomas disponibles), FAQ, vídeos, galería, expansiones |
| 5 | Partidas y puntuación | Registrar partida con config versionada y participantes por nombre |
| 6 | Estadísticas | Personales y por juego, gráficos |
| 7 | IA | Identificar juego por foto (visión → nombre → búsqueda), lectura de hojas |
| 8 | Comunidad | Partidas compartidas con usuarios, amigos, grupos, admin avanzado |
| 9 | Producción | Auditoría, a11y, rendimiento, monitorización, legal, despliegue |

## Fase 1 — tareas (revisadas)
1. Scaffold Next.js (TS strict, Tailwind v4, ESLint, Prettier) + CI.
2. shadcn/ui + tokens claro/oscuro + `next-themes` + selector de tema.
3. next-intl: `en` (defecto), `es`, `fr`; regla anti-literales.
4. **Clerk**: app en modo desarrollo, `ClerkProvider`, páginas de sign-in/sign-up, `proxy.ts` = `clerkMiddleware` + next-intl.
5. **Supabase** (cuenta nueva): proyecto `boardgame-hub-dev`, Clerk como third-party auth provider, cliente con `accessToken`.
6. Migración `0001`: `current_user_id()`, `profiles`, `user_roles`, `is_admin`, RLS; `ensureProfile` + webhook de Clerk con firma Svix.
7. Shell responsive (barra inferior móvil / sidebar escritorio) y estados vacío/error/carga.
8. Tests: Vitest (schemas), RLS por SQL con claims simulados, Playwright (login con usuario de prueba de Clerk, tema, idioma, responsive).
9. Preview en Vercel y documentación de variables de entorno.

## Decisiones pendientes y riesgos
| # | Tema | Estado |
|---|---|---|
| 1 | Conector de Supabase aún en la cuenta antigua | El usuario debe reconectarlo a la cuenta nueva (y/o `supabase login` en terminal) |
| 2 | Clerk en producción requiere dominio propio; la instancia de desarrollo es para pruebas | Decidir dominio antes de abrir a los ~10 usuarios (verificar doc vigente) |
| 3 | Token de BGG y términos exactos de caché/imágenes | Solicitar token en boardgamegeek.com/applications; leer términos |
| 4 | Sin Docker | Tests RLS contra proyecto cloud dev |
| 5 | Plan gratuito de Supabase: pausa por inactividad | Aceptable en dev; Pro (~25 USD/mes) si se abre al público |
| 6 | Edad mínima, política de privacidad, nombre/dominio | Antes de Fase 9 |

## Estado de la Fase 1 (actualizado 2026-11-15)
| Tarea | Estado |
|---|---|
| 1 Scaffold + CI | Hecho. Repo privado `Amika` en GitHub; la CI (format, lint, tipos, tests, build) pasa en verde |
| 2 shadcn/ui (Radix) + tokens + tema | Hecho |
| 3 next-intl en/es/fr | Hecho |
| 4 Clerk (`ClerkProvider`, sign-in/up, `proxy.ts`) | Hecho y probado con sesión real (usuarios de prueba) |
| 5 Supabase dev + Clerk como third-party auth | Hecho: el token de Clerk es aceptado y RLS se aplica (verificado en E2E) |
| 6 Migración 0001 + perfiles + webhook | Migración aplicada y probada; webhook escrito, **falta registrarlo en Clerk** |
| 7 Shell responsive y estados | Hecho (home vacío, ajustes, 404) |
| 8 Tests | 30 unitarios + 14 RLS + 42 E2E (público, sesión, layout, a11y) verdes |
| 9 Despliegue en Vercel | Hecho: https://amika-lake.vercel.app ; las 42 E2E pasan contra ese despliegue. Pendiente: webhook de Clerk y cabeceras de seguridad (CSP) |
