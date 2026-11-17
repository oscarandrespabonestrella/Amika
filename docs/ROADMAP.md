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
| 7 | IA local | **7a** identificar juego por foto en el dispositivo (código de barras; OCR e hash retirados en 7a-2; `docs/superpowers/specs/2026-11-16-fase7a-identificar-juego-design.md`) · **7a-2** reconocimiento **en vivo con la cámara** (CLIP + ORB, opcional, apagado de serie; `docs/superpowers/specs/2026-11-16-fase7a2-reconocimiento-en-vivo-design.md`) · **7a-3** reconocer contra los **500 mejores de BGG** (paquete de vectores precalculado, `docs/superpowers/specs/2026-11-17-fase7a3-paquete-top500-design.md`) · **7b** lectura de hojas (**aplazada por decisión del usuario**: requiere mejor reconocimiento de imagen) · IA externa opcional, apagada por defecto |
| 8 | Comunidad | **8a** amigos por enlace y partidas compartidas en directo, vincular nombres a usuarios y «Jugadas en otros sitios» (ADR-040; `docs/superpowers/specs/2026-11-17-fase8a-partidas-compartidas-design.md`; **hecha, pendiente de probar en el móvil con dos cuentas**) · **8b** grupos y estadísticas por grupo (pendiente) · **8c** admin avanzado (pendiente) |
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

## Estado de la Fase 2 (actualizado 2026-11-15)
| Entrega | Estado |
|---|---|
| Migraciones 0002–0004 (catálogo, búsqueda, fotos, importación atómica) | Hecho y aplicado en dev; 47 tests de RLS/SQL |
| Fuente BGG (`GameSource`, cliente, lector XML) | Escrita y probada con respuestas de ejemplo (41 tests); **sin verificar contra la API real: falta el token** |
| Búsqueda local, filtros, ficha, juegos propios, perfil (nombre visible) | Hecho; 65 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |
| Fotos propias con cámara | Hecho (subida, borrado, tope 10, EXIF eliminado) |
| Importar un juego real de BGG de extremo a extremo | **Pendiente del token** |
| Borrado de datos al eliminar cuenta (webhook) | Código y tests unitarios hechos; **falta registrar el webhook en Clerk** |

## Estado de la Fase 3 (actualizado 2026-11-15)
| Entrega | Estado |
|---|---|
| Migración 0005 (`library_items`, `search_library`) | Hecho y aplicado en dev; 15 tests de RLS |
| Añadir/quitar juegos como «lo tengo» o «lo tuve»; favorito, valoración 1–10, notas | Hecho |
| Pantalla «Biblioteca» con filtros (estado, favoritos) y búsqueda sin acentos | Hecho |
| Resumen en Inicio | Hecho |
| Editar y borrar juegos propios (con limpieza de sus fotos) | Hecho |
| Lista de deseos, etiquetas personales | **Fuera de alcance por decisión** |
| Pruebas | 171 unitarias, 62 RLS/SQL, 93 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |

## Fase 5 — reparto (2026-11-16)
Diseño en `docs/superpowers/specs/2026-11-16-fase5-partidas-puntuacion-design.md`. Tres entregas con revisión tras cada una: **5a** motor + hojas + editor, **5b** partidas, **5c** compartir y fiabilidad (publicar, 👍/avisos, verificada, orden por Wilson, moderación, topes). Fotos de partida y puntuación por imagen: Fase 7.

## Estado de la Fase 7a (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Identificar un juego por foto **en el dispositivo**: OCR (Tesseract.js), código de barras (`BarcodeDetector` nativo con `zxing-wasm` de respaldo) y hash de imagen; la foto no sale del dispositivo (a la red solo van ≤ 3 líneas de texto, un código y un hash de 64 bits) | Hecho |
| Migración 0016: `game_barcodes` (privados por usuario), `game_image_hashes` (portadas del catálogo y fotos propias) y `match_game_images` | Hecho y aplicada en dev; 20 tests de RLS nuevos |
| Hash de portadas al importar (descarga transitoria, solo hosts de BGG, sin guardar la imagen) y script de relleno | Hecho |
| Resultados ordenados con el motivo («Código», «Título», «Imagen») y confianza (nunca «seguro»); confirmación manual; el código y la foto confirmados se aprenden | Hecho |
| Punto de extensión `GameRecognizer` (IA externa opcional: apagada, exige consentimiento explícito; ninguna implementada) | Hecho |
| Cabeceras de seguridad y CSP compatible con WebAssembly | Hecho; **CSP en modo informe** hasta activar `CSP_ENFORCE=1` (ver SECURITY §16) |
| Medición con fotos reales (`npm run recognition:eval`) | **Hecha (2026-11-16, 15 fotos del usuario): resultado flojo**: título 2/15, imagen 1/15, combinado 3/15 en el top 5; código de barras sin medir (las fotos son del frente). Ver ADR-036 |
| Verificar el adaptador de BGG con el token real | **Hecho**: búsqueda y ficha funcionan con la API real (la búsqueda tarda ~5 s) |
| Pruebas | 507 unitarias, 217 RLS/SQL, 259 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |

## Estado de la Fase 7a-3 (actualizado 2026-11-17)
| Entrega | Estado |
|---|---|
| Motivo: la prueba en el móvil mostró que la cámara solo conocía los 15 juegos de prueba del catálogo; debía comparar con una base de datos de juegos | Resuelto con un paquete precalculado (ADR-038) |
| Paquete de los **500 mejores de BGG**: 500 vectores CLIP (1 024 000 bytes) + manifiesto, generados con `npm run recognition:pack` desde `boardgames_ranks.csv` y la API de BGG; versionado en git | Hecho |
| En el dispositivo: se descarga con la activación (aviso «~86 MB»: 85 modelo + 1 paquete), IndexedDB, el catálogo gana, la purga no lo toca, «Desactivar y borrar» lo elimina | Hecho |
| Resultado «Parece X · n.º N en BGG» con **Añadir al catálogo y abrir** (importa de BGG con su cuota y abre la ficha); ORB con `GET /api/covers/pack/[bggId]` | Hecho |
| Calibración con las 15 fotos (510 referencias): 10/15 reconocidas (todas «alta»), 5/15 «no estoy seguro», **0 equivocadas**; «caja desconocida» (la foto sin su propio juego): 15/15 sin respuesta confiada | Hecha; ver ADR-038 |
| Corrección de confianza: la similitud de CLIP sola nunca pasa de «baja» («media» exige ORB ≥ 30) | Hecha (ADR-038, nota en ADR-037) |
| Pruebas | 656 unitarias, 206 de integración (RLS/SQL), 263 E2E (7 nuevas: 2 del endpoint de portadas del paquete y 5 del reconocimiento con el paquete, con la portada real de Brass: Birmingham ante la cámara falsa) |
| **Rendimiento en el móvil** | **Sin medir** (pendiente de que el usuario lo pruebe) |
| Para que «Añadir al catálogo» y el buscador de BGG funcionen en producción | El usuario debe poner `BGG_API_TOKEN` en Vercel y redesplegar |
| Antes de `CSP_ENFORCE=1` | Resolver que OpenCV.js usa `eval` (SECURITY §17) |

## Estado de la Fase 7a-2 (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Reconocimiento en vivo con la cámara en el dispositivo: CLIP ViT-B/32 (modelo de 85 MB, Web Worker) como recuperador, ORB + RANSAC (OpenCV.js) como verificador, código de barras aprendido; la imagen no sale del dispositivo (verificado por E2E: ninguna petición no-GET lleva una imagen) | Hecho |
| **Opcional, apagado de serie y por dispositivo**: tarjeta de activación con el aviso de ~85 MB antes de descargar nada; sección en Ajustes para desactivar y borrar la descarga | Hecho |
| Elegir una foto de la galería usa el mismo motor | Hecho |
| Punto de entrada: `GET /api/covers/[gameId]` (portada acotada, solo si el juego es visible) | Hecho |
| Calibración con las 15 fotos del usuario (65 referencias): 10/15 reconocidas (todas «alta»), 5/15 «no estoy seguro», **0 equivocadas**; CLIP solo 11/15 | Hecha; ver ADR-037 (incluye la desviación de la puerta del plan) |
| Migración 0017: se eliminan `game_image_hashes` y sus funciones; se retiran OCR (Tesseract), dHash, el hash al importar y el script de relleno | Hecho y aplicada en dev (con aprobación) |
| Pruebas | 595 unitarias, 206 de integración (RLS/SQL), 243 E2E (7 nuevas de reconocimiento en vivo con cámara falsa) |
| **Rendimiento en el móvil** | **Sin medir**: pendiente de que el usuario lo pruebe en su teléfono |
| Antes de `CSP_ENFORCE=1` | Resolver que OpenCV.js usa `eval` (SECURITY §17 y ADR-037) |

## Estado de la Fase 6b (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Migración 0015: seis funciones SQL de solo lectura (`security invoker`) que agregan por `player_id`: por juego, personales y cara a cara | Hecho y aplicado en dev; 18 tests de RLS nuevos |
| Estadísticas por juego en la ficha: tarjetas (partidas, duración media, última), tabla por jugador (partidas, victorias, %, media, mejor), victorias por jugador y puntuación en cada partida | Hecho |
| Desglose por categoría (puntos medios, calculados con el motor, para la versión de hoja más usada) | Hecho |
| Página «Estadísticas» (nueva entrada de navegación): mi historial, juegos más jugados y cara a cara; sin «soy yo» explica y enlaza a Mis jugadores | Hecho |
| Gráficos: shadcn Chart sobre Recharts 3; paleta `--chart-1..5` validada (ADR-035); máximo 5 series; cada gráfico con su tabla equivalente | Hecho |
| Pruebas | 394 unitarias, 197 RLS/SQL, 235 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |

## Estado de la Fase 6a (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Migración 0014: lista de jugadores, `player_id` en los participantes (datos migrados, ensayada en transacción revertida), `save_play` y `merge_players` | Hecho y aplicado en dev; 26 tests de RLS nuevos |
| Selector de jugador (combobox con búsqueda, «Añadir …», sin repetir jugador en una partida) y formulario de partida con la lista | Hecho |
| Página «Mis jugadores» (renombrar, fusionar, borrar si no tiene partidas, «soy yo»), enlazada desde Ajustes y el formulario | Hecho |
| Pruebas | 374 unitarias, 179 RLS/SQL, 209 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |
| **6b** (estadísticas y gráficos con shadcn Chart/Recharts) | Hecho: ver más abajo |

## Estado de la Fase 5c (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Migraciones 0011–0013: publicar (solo catálogo, 5 al día), votos, ranking de Wilson, funciones de administrador, borrado de cuenta con hojas anónimas, permisos por columna, topes sin carrera | Hecho y aplicado en dev; 29 tests de RLS nuevos (153 en total) |
| Sección «Hojas de la comunidad» en la página de hojas, vista de solo lectura con copiar, publicar/despublicar, selector de hoja agrupado con la mejor por defecto | Hecho |
| Aviso 👍 / «total incorrecto» (con motivo) tras una partida con la hoja de otro; verificar/desactivar y ver avisos (administrador) | Hecho |
| Pruebas | 353 unitarias, 153 RLS/SQL, 191 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |

## Estado de la Fase 5b (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Cálculo puro (`features/plays/compute.ts`): puestos con empates, totales, jugadores sin datos; esquemas de entrada estrictos | Hecho |
| Migración 0010 (partidas, participantes, puntuaciones, expansiones, `save_play`, RLS, topes) | Hecho y aplicado en dev; 23 tests de RLS |
| Servicios y acciones (totales siempre recalculados en el servidor); borrar una hoja con partidas da «hoja en uso» | Hecho |
| Formulario de partida con totales en vivo, sección «Partidas» en la ficha del juego, editar y borrar | Hecho (se registra solo desde la ficha) |
| Pruebas | 341 unitarias, 124 RLS/SQL, 166 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |

## Estado de la Fase 5a (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Motor puro (`features/scoring/engine`): 8 tipos de categoría, validación, evaluación sin `eval`, nunca lanza | Hecho; 7 Wonders (62 pts) y Wingspan (77 pts) reproducidos en tests. Los fixtures de tests son solo ejemplos: el motor es genérico y cada usuario crea la hoja de su juego |
| Migraciones 0007–0009 (hojas, versiones, RLS, control de concurrencia, versiones sin borrado suelto) | Hecho y aplicado en dev; 19 tests de RLS |
| Lista de hojas por juego, copiar, borrar, entrada desde la ficha | Hecho |
| Editor de formulario con vista previa en vivo, versiones, conflicto entre pestañas | Hecho |
| Publicar, votos, verificada | **Fase 5c** |
| Pruebas | 309 unitarias, 101 RLS/SQL, 142 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |

## Estado de la Fase 4 (actualizado 2026-11-16)
| Entrega | Estado |
|---|---|
| Migración 0006 (recursos, reglas, imágenes, FAQ + sugerencias) | Hecho y aplicado en dev; 20 tests de RLS |
| Reglas (enlaces por idioma + resumen propio), vídeos, FAQ, galería en la ficha | Hecho (es/en/fr, con respaldo en inglés) |
| Editor de administrador en la ficha | Hecho |
| Sugerir preguntas, revisión (aprobar/rechazar), retirar | Hecho |
| Añadir al catálogo una expansión que falta | Hecho en la interfaz; **requiere el token de BGG** (sin verificar) |
| Pruebas | 223 unitarias, 82 RLS/SQL, 120 E2E (escritorio + móvil, es/en/fr, axe claro/oscuro) |
| Conceder el rol de administrador a tu cuenta | **Pendiente de ti**: `npm run admin:grant -- tu@correo` |
