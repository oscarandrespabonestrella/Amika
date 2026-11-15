# Amika — Especificación de producto

> Estado: Fase 0 (borrador para aprobación) · Fecha: 2026-11-15
> Ver también: [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [ROADMAP](ROADMAP.md) · [DECISIONS](DECISIONS.md)

## 1. Visión
Plataforma web para organizar, descubrir, registrar y analizar la actividad en torno a juegos de mesa: colección personal, catálogo global, ficha completa por juego (Game Center), registro de partidas con puntuación flexible y estadísticas.

Arranque con ~10 personas; arquitectura preparada para uso público masivo.

## 2. Principios
1. Arquitectura profesional desde el inicio, sin sobreingeniería.
2. Mobile-first, responsive real, accesible (WCAG 2.2 AA razonable).
3. Online-first (sin offline en MVP).
4. Catálogo global compartido; datos privados aislados por usuario (RLS).
5. i18n extensible: UI en inglés (por defecto), español y francés; más idiomas después sin cambiar la lógica.
6. Costes iniciales mínimos (planes gratuitos).
7. Seguridad y privacidad desde el diseño (RGPD).

## 3. Decisiones confirmadas
| Decisión | Detalle |
|---|---|
| Diseño **Adaptive** | Claro, oscuro y automático (sigue al SO). Preferencia manual persistida. Sin flash en la carga. |
| Acceso **Registration** | Registro público libre, email + contraseña, verificación de email, login/logout, reset de contraseña, anti-abuso, preparado para OAuth. Implementado con **Clerk** (decisión del usuario, ADR-014). |
| Proyecto | Personal, **sin monetización** (compatible con la licencia no comercial de BGG). |
| Catálogo | **Bajo demanda**: el usuario añade juegos por búsqueda manual (foto en Fase 7); el sistema importa cada juego la primera vez que se necesita. Juegos no encontrados: entrada propia privada. |
| Partidas | MVP: solo del creador; los demás jugadores son nombres libres. Compartir con usuarios en Fase 8. |
| Reglas | Inglés + los idiomas en que existan. |

## 4. Personas
- **Jugador/a de grupo**: registra partidas con amigos, ve quién gana más.
- **Coleccionista**: gestiona biblioteca, wishlist, notas, valoraciones.
- **Admin del catálogo**: mantiene juegos, expansiones y contenido de Game Center.

## 5. Alcance por fases
| Fase | Contenido | MVP |
|---|---|---|
| 1 | Fundamentos: stack, diseño, temas, i18n, auth, RLS | Sí |
| 2 | Perfiles, catálogo global, búsqueda, fichas | Sí |
| 3 | Biblioteca personal | Sí |
| 4 | Game Center | Después del MVP |
| 5 | Partidas y motor de puntuación | Sí (versión simple) |
| 6 | Estadísticas | Después |
| 7 | IA | Después |
| 8 | Comunidad y admin avanzado | Después |
| 9 | Producción | Antes de abrir al público |

**Fuera de alcance del MVP**: offline completo, IA, social (amigos, feed, comentarios), moderación, PWA instalable avanzada.

## 6. Requisitos funcionales (resumen)
- **Usuarios**: perfil, nombre visible, avatar, idioma, tema, privacidad, configuración de cuenta.
- **Biblioteca**: añadir/quitar, favorito, poseído, wishlist, notas, valoración, filtros. Separada del catálogo.
- **Catálogo**: nombre, nombre original, descripción, portada, editorial, diseñador, jugadores, duración, edad, categorías, mecánicas, año, idiomas, expansiones, IDs externos.
- **Game Center**: info, reglas (idioma original + traducciones), FAQ, vídeos YouTube embebidos, galería, expansiones, estadísticas. Solo enlaces a fuentes oficiales para manuales con copyright.
- **Partidas**: juego, fecha, participantes (usuarios o invitados), puntuaciones, ganador, duración, expansiones, notas, fotos, datos específicos. Individuales y compartidas, con permisos estrictos.
- **Motor de puntuación**: configuración por juego, versionada e inmutable una vez publicada.
- **Estadísticas**: por usuario, juego y grupo; victorias, %, medias, evolución, comparativas.
- **Admin**: catálogo, contenido, traducciones, usuarios; permisos verificados siempre en servidor.

## 7. Requisitos no funcionales
- **Rendimiento**: LCP < 2,5 s en móvil de gama media; Server Components por defecto.
- **Accesibilidad**: teclado, lector de pantalla, contraste AA en ambos temas, objetivos táctiles ≥ 44 px.
- **Estados**: carga, error, vacío y éxito en cada vista.
- **Calidad**: TypeScript strict, sin `any` injustificado, tests unitarios/integración/E2E.
- **Privacidad**: exportación y borrado de datos personales (ver SECURITY).

## 8. Trazabilidad de las directrices
| Sección de directrices | Dónde se cubre |
|---|---|
| 3 Decisiones | §3 de este documento; ADR-005/006 en DECISIONS |
| 4 Plataformas/UX | §7; ARCHITECTURE §8 |
| 5 Stack | ARCHITECTURE §2; DECISIONS |
| 6 Arquitectura | ARCHITECTURE §3–5 |
| 7 Módulos | §6; DATABASE |
| 8 i18n | ARCHITECTURE §7; DATABASE (traducciones) |
| 9 Datos/seguridad | DATABASE; SECURITY |
| 10 Online-first | ARCHITECTURE §6 |
| 11 Sistema de diseño | ARCHITECTURE §8 |
| 12–13 Calidad/tests | ARCHITECTURE §9; ROADMAP |
| 14 Estructura | ARCHITECTURE §3 |
| 15 Fases | ROADMAP |

## 9. Cuestiones abiertas
Ver ROADMAP §"Riesgos y decisiones pendientes".
