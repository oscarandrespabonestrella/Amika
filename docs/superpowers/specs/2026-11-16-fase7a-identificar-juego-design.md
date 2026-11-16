# Fase 7a — Identificar un juego por foto, en el dispositivo (diseño)

> 2026-11-16 · Estado: pendiente de aprobación del usuario · Parte de la Fase 7 (IA). La lectura de hojas de puntuación pasa a **7b** y no se toca aquí.

## 1. Intención
Hacer una foto de la caja (o escanear su código) y obtener el juego correcto de nuestro catálogo, **sin enviar la foto a ningún servicio** y sin APIs de pago. El usuario siempre confirma a mano.

## 2. Decisiones del usuario
- Todo el reconocimiento ocurre **en el dispositivo**: OCR (Tesseract.js), códigos de barras/QR, hash perceptual para comparar portadas y, solo si no bastara, OpenCV.js/WebAssembly.
- Resultados **ordenados por coincidencia** y **confirmación manual**.
- No implementar modelos complejos si las técnicas simples bastan.
- Mismo stack (Next/TypeScript/Supabase): nada de Rust ni otros lenguajes o frameworks. Bibliotecas abiertas, procesamiento local, servicios gratuitos o baratos.
- Cualquier IA externa futura: **opcional, desactivada por defecto y con autorización antes de generar costes**.
- Alcance de esta entrega: **etapas A y B** (OCR + código de barras + hash de imagen). Los códigos de barras aprendidos son **privados por usuario**.
- Implementar progresivamente, con pruebas, sin duplicar código y consultando antes de cambios de arquitectura importantes.

## 3. Lo que ya existe (se reutiliza)
`search_games` (similitud, sin acentos) · búsqueda externa en BGG por texto (`external-search`) e importación atómica · cámara con `<input capture>` y fotos privadas por juego · rate limit de la búsqueda externa. No hay códigos de barras, hashes, dependencias de visión ni CSP.

## 4. Límites conocidos (condicionan el diseño)
1. El catálogo es **bajo demanda**: la búsqueda visual solo encuentra juegos ya importados; para uno nuevo el texto del OCR también se busca en BGG (se envía el texto, jamás la foto).
2. BGG **no publica códigos de barras**: se aprenden (el usuario confirma una vez y queda guardado).
3. Las portadas son **enlaces**, no copias (decisión previa). Comparar visualmente exige un hash de cada portada: ver §6.
4. Tesseract y OpenCV pesan varios MB: carga diferida solo al usar la función.
5. Un hash perceptual compara bien portadas frontales y planas; con perspectiva, reflejos o fondo funciona mal. Es una señal **débil** que se pondera menos que el código o el título.

## 5. Enfoques considerados
| Enfoque | Ventaja | Coste |
|---|---|---|
| **A**: OCR + código de barras + búsqueda por texto | Barato, preciso en títulos grandes y códigos | No reconoce cajas sin texto legible |
| **A+B**: añade hash perceptual de imagen | Reconoce cajas sin texto legible o con foto frontal | Tabla de hashes y tocar la decisión de portadas; señal débil |
| **A+B+C**: añade OpenCV.js | Mejor con perspectiva | ~10 MB WASM, complejidad; **no se hace salvo que A+B fallen en la medición** |

**Elegido por el usuario: A+B.** C queda descartada hasta medir.

## 6. Diseño
**Flujo (cliente):** foto → reducir a ≤1280 px en un `canvas` → en paralelo: (1) leer código de barras; (2) OCR; (3) hash de imagen → candidatos → fusión por juego → lista ordenada con el motivo de cada coincidencia («código», «título», «imagen») → el usuario confirma.

- **Código de barras** (`BarcodeDetector` nativo; respaldo `zxing-wasm`): validar dígito de control (EAN-8/13, UPC-A); búsqueda exacta en `game_barcodes` → puntuación máxima. Al confirmar un juego tras leer un código desconocido, se **aprende** (privado).
- **OCR** (`tesseract.js`, datos de idioma **alojados por nosotros** en `public/`, solo el idioma de la interfaz + inglés): se limpian las líneas (confianza mínima, longitud, quedarse con las más grandes) y cada línea consulta `search_games` y la búsqueda externa en BGG. Puntuación = similitud × confianza del OCR.
- **Hash de imagen**: dHash/pHash de 64 bits calculado en el navegador (TypeScript puro, sin biblioteca). La BD compara por distancia de Hamming (`bit_count`). Solo se guardan **hashes**, nunca imágenes: de las fotos propias del usuario (privado) y de las portadas de catálogo (global).
- **Portadas**: al importar un juego, el servidor descarga *de forma transitoria* la imagen enlazada, calcula su hash y la descarta (no se guarda). Es una **decisión mía a confirmar** porque matiza «enlazada, no copiada»; si no se acepta, B se limita a las fotos del propio usuario.
- **Fusión**: por juego; puntuación combinada con pesos (código ≫ título > imagen); sin umbral mágico oculto: se muestran las cinco mejores con su motivo.
- **Privacidad**: la foto no sale del dispositivo. A la red solo van textos del OCR y hashes; la interfaz lo dice.
- **Punto de extensión**: interfaz `GameRecognizer { id; requiresConsent; recognize(input) }` y un registro. Hoy solo hay reconocedores locales; ninguno externo. Un reconocedor que `requiresConsent` no se ejecuta sin una autorización explícita del usuario y un interruptor de entorno, apagado por defecto.
- **Modelo de datos** (migración 0016): `game_barcodes(user_id, gtin, game_id)` único por (`user_id`,`gtin`), RLS solo del dueño, tope por usuario; `game_image_hashes(game_id, owner_id nullable, source 'cover'|'user_photo', hash bigint)`, RLS: las fotos propias solo del dueño y las portadas legibles por autenticados si ven el juego; función `match_game_images(hash, limit)` `security invoker` por distancia de Hamming.
- **Interfaz**: botón «Identificar por foto» en el listado de juegos y la búsqueda (cámara o archivo), pantalla de resultados con progreso, motivo de coincidencia y «No es ninguno: buscar a mano». Accesible por teclado y legible en móvil; sin la función si el navegador no admite WASM.
- **Rendimiento y límites**: carga diferida; trabajadores que se cierran al terminar; tiempo máximo de 20 s con mensaje; tamaño máximo de foto.

## 7. Metas, no metas y anti-metas
- **Metas**: la foto nunca sale del dispositivo; confirmación manual siempre; funciona en móvil; coste cero.
- **No metas**: reconocer varios juegos en una foto; leer hojas de puntuación (7b); códigos compartidos entre usuarios; OpenCV.js (salvo medición); IA externa.
- **Anti-metas**: un acierto falso presentado como seguro; un reconocimiento que bloquee la interfaz; cargar MB de WASM para quien no usa la función.

## 8. Medición (condición para dejar B)
Un conjunto pequeño de **fotos reales de cajas aportadas por el usuario** (unas 15–20) y un script (no en CI) que informa, por técnica, cuántas veces el juego correcto queda en el top 1 y el top 5. Si el hash de imagen no aporta nada medible sobre A, se retira antes de fusionar. Los tests automáticos usan imágenes sintéticas (texto grande y EAN-13 generados en el test).

## 9. Pruebas
Unitarias: dígito de control, limpieza de texto del OCR, hash y distancia de Hamming (invariancias básicas), fusión de candidatos. RLS/SQL: aislamiento de `game_barcodes` y de los hashes propios, topes, función de Hamming. E2E: flujo con imagen sintética (título grande y código), confirmación, aprendizaje del código, resultado vacío, navegador sin soporte; axe claro/oscuro y móvil.

## 10. Roadmap
Fase 7 se divide: **7a** identificar juego (este documento) · **7b** lectura de hojas/puntuaciones (pendiente; puede reutilizar el OCR, aunque el manuscrito rinde mal) · IA externa opcional (apagada, solo con autorización). La tarea de **cabeceras de seguridad/CSP** (pendiente) se hace junto con 7a porque WASM y los trabajadores exigen `wasm-unsafe-eval` y `worker-src`.

## 11. Riesgos y decisiones por confirmar
- **Descarga transitoria de portadas para hashearlas** (§6): toca la decisión previa y los términos de BGG (uso no comercial, atribución). Alternativa: solo fotos propias.
- **CSP**: relajarla para WASM debe hacerse sin romper Clerk; se probará con E2E.
- **Precisión**: el hash puede aportar poco; por eso la medición (§8).
- **Peso** de Tesseract y sus datos de idioma: se mide en la implementación y se documenta.
