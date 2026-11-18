# Amika — Arquitectura

> Fase 0 · 2026-11-15. Versiones de librerías por confirmar al instalar en Fase 1.

## 1. Estilo: modular monolith
Una sola aplicación Next.js desplegable, organizada en **módulos por funcionalidad** con límites explícitos. Sin microservicios. Un módulo puede extraerse más adelante si hiciera falta porque solo se comunica por su API pública.

## 2. Stack
| Capa | Tecnología |
|---|---|
| Framework | Next.js (App Router, Next 16: `proxy.ts` sustituye a `middleware.ts`), React, TypeScript strict |
| UI | Tailwind CSS v4, shadcn/ui + Radix, Lucide, Motion (solo donde aporte) |
| Formularios/validación | React Hook Form + Zod (mismos esquemas en cliente y servidor) |
| i18n | next-intl (rutas con prefijo de locale) |
| Tema | next-themes (clase `dark`, sin flash) |
| Identidad | **Clerk** (`@clerk/nextjs`): registro, verificación de email, sesiones, reset |
| Datos | Supabase: Postgres, Storage, RLS (`@supabase/supabase-js` con `accessToken` de Clerk; sin Supabase Auth) |
| Gráficos | Recharts |
| Tests | Vitest, Playwright |
| Infra | GitHub, Vercel, Supabase |

Gestor de paquetes: **npm** (ya disponible; sin pnpm instalado). Ver ADR-004.

## 3. Estructura del proyecto
```
src/
  app/[locale]/           rutas y layouts (solo composición, sin lógica de negocio)
    (public)/ (auth)/ (app)/ admin/
  features/<módulo>/      auth, profiles, catalog, library, game-center, manuals, plays, scoring, stats, admin, ai*
    views/                cuerpo de pantalla que renderiza una página (ADR-047)
    components/           piezas reutilizables del módulo
    actions/              Server Actions (validan con Zod y delegan en services)
    services/             lógica de negocio + acceso a datos (Supabase)
    schemas/              Zod
    types.ts
    index.ts              API pública del módulo
  components/ui/          shadcn
  components/             compartidos (layout, estados vacíos, selector de tema/idioma)
  lib/                    supabase/, env, utils, logger, rate-limit
  i18n/                   routing, request, messages/{en,es,fr,de,nl}.json
supabase/                 migrations/, seed, config.toml
tests/                    unit (junto al código), integration (RLS), e2e (Playwright)
docs/
```
**Páginas, vistas y componentes (ADR-047)**: una *página* es `src/app/[locale]/**/page.tsx` (la URL es la ruta de carpetas sin `[locale]` ni `(grupo)`; mapa generado en `docs/ROUTES.md` con `npm run routes:map`); `layout/loading/error/not-found` son envoltorios de Next, no páginas. Una *vista* (`features/<f>/views/`) es el cuerpo de pantalla que una página renderiza; una página solo lee parámetros, idioma y sesión, carga datos y pinta una vista. Un *componente* (`features/<f>/components/`, `components/`, `components/ui/`) es una pieza reutilizable y **no importa vistas** (lo impone ESLint).

**Desviación respecto a la orientación de las directrices**: `services/`, `schemas/` y `hooks/` viven *dentro de cada feature* en vez de en la raíz. Motivo: cohesión por módulo y límites claros; en la raíz solo queda lo transversal (`lib/`, `components/`). Los `hooks/` globales se añaden solo si aparecen hooks realmente compartidos.

## 4. Reglas de dependencia
- `app → features → lib/components`. Nunca al revés.
- Una feature solo importa de otra mediante su `index.ts`. Sin ciclos.
- Componentes de UI no contienen SQL ni lógica de negocio; llaman a actions/services.
- Se refuerza con ESLint (`no-restricted-imports` / `import/no-restricted-paths`) y `madge` o equivalente en CI.

## 5. Datos y acceso
- **Lecturas**: Server Components → services → cliente Supabase con sesión del usuario (RLS aplica).
- **Escrituras**: Server Actions: autenticación → Zod → autorización → service. RLS es la última barrera, no la única.
- **Sesión**: la gestiona Clerk. `proxy.ts` = `clerkMiddleware` que devuelve el middleware de next-intl (patrón documentado por Clerk). En servidor: `await auth()`; el cliente Supabase se crea por petición con `accessToken: async () => (await auth()).getToken()`. Con `cacheComponents`, los componentes que llaman a `auth()` van dentro de `<Suspense>`.
- **Catálogo bajo demanda**: `features/catalog/services/importGame` (server-only, service_role) consulta BGG, guarda en la caché global y devuelve el juego; rate limit por usuario. Los usuarios nunca escriben en el catálogo global.
- **Identificación por foto** (Fase 7): visión (LLM) extrae el nombre → misma búsqueda/importación.
- **service_role**: solo en módulos `server-only` (admin, jobs); nunca en cliente ni en variables `NEXT_PUBLIC_*`.
- **Tipos**: generados desde Supabase (`supabase gen types`).
- Cambios de esquema solo mediante migraciones versionadas.

## 6. Online-first
Guardado en backend; UI con estados claros (pending/saved/error), revalidación con `revalidatePath/Tag` y botón de refrescar. Datos externos (p. ej. BGG) se importan bajo demanda por admins con caché en BD, no en cada petición. Sin offline de datos (salvo los manuales PDF que el usuario guarda a propósito en su dispositivo; ADR-046); la app es una PWA instalable (manifest, íconos y un service worker que solo muestra una página «sin conexión»; ADR-045, `features/pwa`).

## 7. Internacionalización
- Locales iniciales: `en` (defecto y fallback), `es`, `fr`; alemán/neerlandés u otros se añaden después sin tocar la lógica; añadir un idioma = añadir `messages/<xx>.json` + entrada en `routing`.
- Ruta `/[locale]/...`; locale inicial por cookie/`profiles.locale`/`Accept-Language`.
- Prohibido texto literal en componentes (regla ESLint sugerida: `no-literal-string` en JSX).
- Contenido de catálogo y reglas: tablas `*_translations` independientes con fallback al idioma original.
- Formatos de fecha/número/moneda con `Intl` vía next-intl.

## 8. Sistema de diseño y temas
- Tokens semánticos en CSS (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--success/warning/danger`…) con valores para claro y oscuro; Tailwind los consume.
- Tema: `next-themes` con `attribute="class"`, `defaultTheme="system"`, `enableSystem`; script inline evita el flash. Selector de 3 estados (claro/oscuro/auto); preferencia en localStorage y, si hay sesión, en `profiles.theme`.
- Navegación: barra inferior en móvil, sidebar en escritorio. Tablas → tarjetas apiladas en móvil.
- Contraste verificado en ambos temas (axe en Playwright).

## 9. Estrategia de pruebas
| Nivel | Herramienta | Qué |
|---|---|---|
| Unitarias | Vitest | Motor de puntuación, schemas, utilidades, estadísticas |
| Integración | Vitest + Supabase | **Políticas RLS** simulando claims (`request.jwt.claims` con `sub`), services |
| E2E | Playwright | Registro, login, reset, biblioteca, partidas, i18n, temas, responsive (móvil/desktop) |
| A11y | axe en E2E | Contraste y roles |

Sin Docker en esta máquina no hay Supabase local: los tests de integración correrán contra un proyecto Supabase cloud de desarrollo (ADR-003). E2E con usuarios de prueba de Clerk.

## 10. Motor de puntuación
Módulo puro `features/scoring/engine`, sin React ni Supabase. Una `ScoringConfig` (JSON validado por Zod, versionada) define categorías, tipos de campo, reglas de cálculo y validaciones. El motor evalúa `(config, entrada) → totales`. La UI solo renderiza a partir de la config. Cada partida guarda la versión usada. Evaluación de fórmulas mediante un DSL de operaciones declarativas (suma, multiplicador, tabla, mín/máx…), **sin `eval`**.

## 11. IA (futura)
Módulo aislado `features/ai` tras una interfaz `AiProvider`; llamadas solo desde servidor; la app funciona sin él. Sin implementación en MVP.

## 12. Despliegue
Vercel (preview por PR) + Clerk + Supabase (dev y, más adelante, prod separados). CI en GitHub Actions: lint, typecheck, test, build. Variables de entorno validadas con Zod al arranque.
