# Rediseño Amika — Tanda 1 (base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar la base visual del artefacto "Amika redesign" (tokens, fuentes, logo, shell, navegación con botón central Log, Settings en el menú del avatar) sin cambiar datos ni lógica.

**Architecture:** Se ajustan los tokens semánticos de `globals.css` (el resto de componentes ya solo usa tokens), `Brand` pasa a usar `Logo_Dark.png` en oscuro y meeple SVG + wordmark en claro, y `AppNav`/`AppShell` se reorganizan. "Settings" se añade al menú de Clerk `UserButton` con `UserButton.MenuItems` (no se crea DropdownMenu propio). El botón "+ Log" lleva a una página nueva `/log` que lista la biblioteca con `GameCard` apuntando a `/games/[id]/plays/new`.

**Tech Stack:** Next.js 16 (leer `node_modules/next/dist/docs/` antes de tocar rutas/fuentes), Tailwind 4, next-intl (en/es/fr), Clerk, lucide-react, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-rediseno-amika-design.md`

## Global Constraints

- Tokens artefacto (modo oscuro): background `#0B0F14`, card `#131A22`, border `#263140`, foreground `#F2F1EC`, muted-foreground `#9AA4B2`, primary `#5ED3B5`, primary-foreground `#04241C`, destructive `#F07A6A`, warning/ámbar `#F2B544`, secondary `#18202A`, input fondo `#0F151C`.
- Fuentes: Geist (cuerpo, ya cargada) y Nunito 900 solo para el wordmark en modo claro.
- Nav móvil: exactamente 5 elementos (Home · Library · [+ Log] · Stats · People), objetivos táctiles ≥ 44 px, sin desbordes a 375 px en en/es/fr.
- Navegación activa con `aria-current="page"`; People activo en `/friends` y `/players`.
- Tema por defecto oscuro (`defaultTheme="dark"`); claro y "sistema" siguen disponibles en Settings.
- Todo texto nuevo en los 3 catálogos (`en`, `es`, `fr`) con las mismas claves (`src/i18n/messages.test.ts` lo exige).
- Tests pesados (e2e, integración) solo al cerrar la tanda (Task 6), no por tarea. Por tarea: `npm run typecheck` y `npm run lint`.
- Sin cambios en BD, server actions ni RLS. Commits con el trailer de co-autoría indicado en el sistema.

## Review Focus

- Modo claro: el wordmark debe verse (el PNG es texto blanco sobre transparente). Test: e2e axe en `/en/home` con tema claro.
- Idioma largo (fr "Statistiques", es "Estadísticas") en la barra de 5 ítems con botón central: sin recorte a 375 px.
- `/log` con biblioteca vacía: estado vacío con enlace a añadir juegos, no una página en blanco.
- Contenido tapado por la barra inferior: el último elemento de una página larga es alcanzable al hacer scroll.
- Usuario sin foto/nombre en Clerk: el menú del avatar sigue abriendo y muestra Settings.

---

### Task 1: Tokens y fuentes

**Files:**
- Modify: `src/app/globals.css` (bloque `.dark`)
- Modify: `src/app/[locale]/layout.tsx` (añadir Nunito, `defaultTheme="dark"`)

**Interfaces:**
- Produces: variable CSS `--font-brand` (Nunito) y utilidad `font-brand` vía `@theme inline { --font-brand: var(--font-nunito) }`.

- [ ] **Step 1:** En `.dark` de `globals.css` sustituir los valores por los de Global Constraints (background, foreground, card, popover `#18202A`, secondary, muted `#0F151C`, muted-foreground, primary, primary-foreground, destructive, warning, border, input, ring `#5ED3B5`, sidebar-* coherentes). Se permiten hex (ya hay hex en `--chart-*`). No tocar `--accent` (lo usan hovers de shadcn y el fondo del icono de `GameCard`).
- [ ] **Step 2:** En `layout.tsx` cargar `Nunito({ variable: "--font-nunito", weight: "900", subsets: ["latin"] })`, añadir su `variable` al `className` del `<html>`, y poner `defaultTheme="dark"` en `ThemeProvider`.
- [ ] **Step 3:** Registrar `--font-brand` en el `@theme inline` de `globals.css`.
- [ ] **Step 4:** Verificar contraste AA de `muted-foreground` sobre `card` y de `primary-foreground` sobre `primary` (≥ 4.5:1; el artefacto usa estos pares). Run: `npm run typecheck && npm run lint` → sin errores.
- [ ] **Step 5: Commit** `feat(design): tokens y fuentes del rediseño (oscuro por defecto)`.

### Task 2: Brand con logo

**Files:**
- Modify: `src/components/brand.tsx`

**Interfaces:**
- Consumes: `/Logo_Dark.png` (2172×724 aprox.), `font-brand` (Task 1).
- Produces: `Brand({ href }: { href?: "/" | "/home" })` con la misma firma; accesible con nombre "Amika" (`aria-label={APP_NAME}` en el `Link`).

- [ ] **Step 1:** En `Brand`, renderizar dos variantes: `next/image` con `src="/Logo_Dark.png"`, `alt=""`, altura 28–32 px y clases `hidden dark:block`; y la variante clara `block dark:hidden` = meeple SVG inline (path del artefacto `Main.dc.html`, `fill-primary`) + `<span className="font-brand ...">amika</span>`. Quitar el uso de `Dices`.
- [ ] **Step 2:** Comprobar a mano el PNG a 28 px (ruido en las letras). Si se ve sucio, avisar al usuario y proponer usar la variante SVG/texto también en oscuro; no decidir solo.
- [ ] **Step 3:** `npm run typecheck && npm run lint`.
- [ ] **Step 4: Commit** `feat(design): logo Amika en Brand (PNG oscuro, SVG claro)`.

### Task 3: i18n de navegación

**Files:**
- Modify: `src/i18n/messages/en.json`, `es.json`, `fr.json` (namespace `Nav`)

**Interfaces:**
- Produces: claves `Nav.people`, `Nav.logMatch`, `Nav.account`; namespace nuevo `Log` con `title`, `subtitle`, `emptyTitle`, `emptyBody`, `browse`. Valores: en "People"/"Log a match"/"Account"; es "Personas"/"Registrar partida"/"Cuenta"; fr "Personnes"/"Enregistrer une partie"/"Compte". Textos de `Log` redactados por el implementador en los 3 idiomas.

- [ ] **Step 1:** Añadir las claves en los 3 catálogos.
- [ ] **Step 2:** Run: `npx vitest run src/i18n` → PASS (paridad de claves).
- [ ] **Step 3: Commit** `feat(i18n): textos de navegación y página Log`.

### Task 4: AppNav, AccountMenu y AppShell

**Files:**
- Modify: `src/components/layout/app-nav.tsx`, `src/components/layout/app-shell.tsx`
- Create: `src/components/layout/account-menu.tsx`
- Modify: `tests/e2e/app-layout.spec.ts`

**Interfaces:**
- Consumes: `Nav.*` (Task 3), `Brand` (Task 2).
- Produces: `AccountMenu()` (client component) = `<UserButton>` con `<UserButton.MenuItems><UserButton.Link label={t("settings")} href={`/${locale}/settings`} labelIcon={<Settings />} /><UserButton.Action label="manageAccount" /><UserButton.Action label="signOut" /></UserButton.MenuItems>`. Verificar la API con context7 (`/clerk/clerk-docs`, "UserButton.MenuItems") y con la versión instalada de `@clerk/nextjs`.
- `AppNav` mantiene `variant: "sidebar" | "bottom"`; ítems: `/home`, `/library` (also `/games`), `/log` (botón central), `/stats`, `/friends` (key `people`, also `/players`).

- [ ] **Step 1: Actualizar el e2e primero** en `app-layout.spec.ts`: el test de navegación pasa a hacer clic en "People" (URL `/en/friends`, h1 "Friends", `aria-current` en People) y llega a Settings por el menú del avatar (`getByRole("button", { name: /account|open user menu/i })` → enlace "Settings"); añadir test "el botón Log lleva a /en/log"; el test de 5 ítems sigue exigiendo 5 enlaces visibles y sin recorte en en/es/fr (nombre de Stats por idioma sin cambios).
- [ ] **Step 2:** Implementar `AppNav`: en `bottom`, `grid-cols-5` con el ítem Log renderizado como botón elevado (círculo/cuadrado redondeado `size-14`, `bg-primary text-primary-foreground`, `-mt-4`, icono `Plus`, `aria-label` = `Nav.logMatch`, `aria-current="page"` en `/log`); en `sidebar`, Log como enlace con estilo primario destacado. Ícono People = `Users`.
- [ ] **Step 3:** Crear `AccountMenu`; en `AppShell` sustituir los dos `<UserButton />` por `<AccountMenu />`; el `main` pasa a `pb-[calc(5rem+env(safe-area-inset-bottom))]` en móvil (barra + inset) y `md:pb-10`.
- [ ] **Step 4:** `npm run typecheck && npm run lint` → sin errores.
- [ ] **Step 5: Commit** `feat(nav): barra con botón Log, People y Settings en el menú del avatar`.

### Task 5: Página /log

**Files:**
- Create: `src/app/[locale]/(app)/log/page.tsx`
- Modify: `src/features/catalog/components/game-card.tsx` (prop opcional `href?: string`, por defecto `/games/${game.id}`)
- Modify: `src/i18n/routing.ts` o `pathnames` solo si el proyecto declara rutas tipadas allí (comprobar; `Link` de `@/i18n/navigation` rechaza rutas no declaradas)

**Interfaces:**
- Consumes: `searchLibrary(parseLibraryFilters({}))` → `LibraryEntry[]` (`entry.game: GameSummary`), `GameCard`, `EmptyState`.
- Produces: `GameCard` acepta `href?: string`; `/log` lista la biblioteca con cada tarjeta apuntando a `/games/${id}/plays/new`.

- [ ] **Step 1: Test e2e** en `tests/e2e/app-layout.spec.ts` (o `app-plays.spec.ts`): con un usuario con biblioteca, `/en/log` muestra h1 y al elegir un juego navega a `/en/games/<id>/plays/new`; con biblioteca vacía muestra el estado vacío y el enlace a `/games`. (Se ejecuta en Task 6.)
- [ ] **Step 2:** Implementar la página (patrón de `library/page.tsx`: `assertLocale`, `setRequestLocale`, `getTranslations("Log")`); lista con `<ul>` de `GameCard href=…`; vacío con `EmptyState` + `buttonVariants` enlazando a `/games`.
- [ ] **Step 3:** Añadir la prop `href` a `GameCard` sin cambiar su comportamiento por defecto (los usos existentes no se tocan).
- [ ] **Step 4:** `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(log): página para elegir el juego de una nueva partida`.

### Task 6: Cierre de la tanda (verificación)

- [ ] **Step 1:** Run: `npm run typecheck && npm run lint && npm test` → todo verde.
- [ ] **Step 2:** Run: `npm run e2e -- tests/e2e/app-layout.spec.ts tests/e2e/public-pages.spec.ts tests/e2e/app-stats.spec.ts` → verde (incluye axe en oscuro). Añadir una pasada axe en `/en/home` con `colorScheme: "light"` para cubrir el logo en claro (Review Focus).
- [ ] **Step 3:** Run: `npm run e2e` completo → sin regresiones. Si falla algún e2e por cambios de nav, corregir el selector, no el comportamiento.
- [ ] **Step 4:** Capturas con `playwright.screenshots.config.ts` en móvil (oscuro y claro) y revisar contra el artefacto; mostrar al usuario antes de pasar a la tanda 2.
- [ ] **Step 5:** Actualizar `docs/DECISIONS.md` con una ADR corta (rediseño, nav, logo por tema) y commit `docs: ADR rediseño Amika tanda 1`.
