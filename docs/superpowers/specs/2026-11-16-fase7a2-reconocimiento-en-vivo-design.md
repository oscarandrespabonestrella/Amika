# Fase 7a-2 — Reconocimiento de juegos en vivo con la cámara (diseño)

> 2026-11-16 · Estado: pendiente de aprobación del usuario · Sustituye las señales de OCR y de hash de imagen de la 7a (ADR-036); conserva el código de barras. La lectura de hojas de puntuación sigue siendo la 7b.

## 1. Intención

Abrir la cámara del móvil o del ordenador, **sin disparar foto**, apuntar a la caja y que la aplicación diga «Parece _Wingspan_» con una confianza honesta; el usuario confirma. Todo en el dispositivo y gratis.

## 2. Por qué cambia (medición con fotos reales del usuario, ADR-036 y su adenda)

Con 15 fotos de frentes de caja contra 65 portadas: OCR + hash acertaron 1–3 de 15; **CLIP (modelo abierto) 13/15** a la primera; OpenCV.js (ORB + RANSAC) 10/15 y, cuando acierta, con una evidencia abrumadora (274 frente a 10 coincidencias): sirve de verificador. Los fallos comunes son probablemente ediciones distintas de la portada de BGG.

## 3. Decisiones del usuario

- Dirección: **CLIP + OpenCV.js como verificador; retirar OCR y hash de imagen** (aprobado el 2026-11-16).
- **CLIP ViT-B/32 cuantizado (~85 MB)** como modelo (13/15 en la medición).
- **Opcional y apagado de serie** (decisión del usuario, 2026-11-16): al ser un sistema pesado, no se activa solo. Cada usuario lo activa, en cada dispositivo, desde Ajustes o desde la sección de Juegos; al activarlo se muestra el aviso de la descarga única (~85 MB) y, una vez descargado, la función queda disponible. Se puede desactivar y borrar lo descargado.
- Escala: ~50 juegos al empezar y ~1 al mes; **reconocer en vivo con la cámara**, sin tomar foto.
- Heredadas: nada de la imagen sale del dispositivo; sin IA externa de pago ni que reciba imágenes; mismo stack (sin Rust ni otros lenguajes); bibliotecas abiertas, procesamiento local, coste cero; cualquier IA externa futura, opcional, apagada y con consentimiento (la interfaz `GameRecognizer` de la 7a se conserva).

## 4. Diseño

**Activación opcional (por dispositivo).** De serie la función está apagada: no se descarga el modelo, no se carga ningún motor y en Juegos solo aparece una tarjeta «Reconocer juegos con la cámara» con el botón «Activar». Al pulsarlo se explica qué es y se avisa claramente: «Se descargarán unos 85 MB una sola vez (conviene usar wifi). Quedan guardados en este dispositivo». Solo al confirmar empieza la descarga, con barra de progreso, posibilidad de cancelar y de reintentar; después se calculan los vectores de las portadas del catálogo (también con progreso) y la función queda **activa y lista** en ese dispositivo (también en Ajustes, donde se puede **desactivar y borrar** el modelo y los vectores guardados, para recuperar espacio). El estado «activada» se guarda en el propio dispositivo (el modelo también vive allí), no en el servidor.

**Flujo en vivo (navegador).** Botón «Reconocer con la cámara» → `getUserMedia` (cámara trasera) → un fotograma cada ~500 ms, **solo si el anterior ya terminó** → un Web Worker calcula el vector (512 números) con CLIP → similitud coseno contra los vectores de referencia → **votación** sobre los últimos fotogramas (se «fija» un candidato cuando es el primero en al menos 3 de 5 y gana con margen) → se muestra «Parece X» con su confianza y un botón para abrirlo. Si hay dudas entre los 2–3 mejores, **OpenCV.js los verifica** (coincidencia de características ORB + homografía): muchas coincidencias suben la confianza. El **código de barras** se lee en paralelo (`BarcodeDetector`, o `zxing-wasm` de respaldo) y, si es uno aprendido, manda. Existe también «elegir una foto» con el mismo motor.

**Referencias.** Los juegos de tu catálogo con portada. El navegador pide cada portada a un **endpoint propio** (`GET /api/covers/[gameId]`: con sesión, solo juegos visibles, con la descarga protegida contra SSRF que ya existe y la imagen reducida a 512 px), calcula su vector una vez y lo guarda en **IndexedDB** (junto a la URL de la portada, para invalidarlo si cambia). Para ~50 juegos son ~15 s la primera vez en cada dispositivo, con barra de progreso; después, instantáneo. Al **confirmar** un candidato se guarda también el vector del fotograma como referencia extra de ese juego (aprende tu edición concreta).

**Confianza honesta.** «Alta» solo con código aprendido o con verificación ORB fuerte; «Media» con similitud y margen sobre los umbrales **calibrados con las 15 fotos**; «Baja» el resto; nunca «seguro»; no se fija candidato si el primero y el segundo están muy cerca. Siempre confirmación manual.

**Modelo y motores autoalojados.** El modelo ONNX (CLIP) y los `.wasm` de ONNX Runtime salen de **nuestro** servidor (`env.remoteHost` y `wasmPaths` de Transformers.js, sin Hugging Face ni CDN en tiempo de ejecución) y quedan en la caché del navegador tras la primera descarga (~85 MB). Alojamiento: en desarrollo y E2E, `public/models/` (copia local, fuera de git); en producción, un bucket público de Supabase Storage (a decidir en la implementación por el límite de tamaño del despliegue). OpenCV.js (~10 MB) se carga solo cuando hay que verificar. Todo con carga diferida: nada de esto entra en el JavaScript inicial.

**Privacidad.** Los fotogramas no salen del dispositivo (ni se suben ni van a una API); a la red solo van las peticiones de portadas (de juegos que ya ves) y la descarga única del modelo.

**Retirada (migración 0017).** Se eliminan el OCR (`tesseract.js` y los datos de idioma), el hash de 64 bits (cliente y servidor), la tabla `game_image_hashes` y sus funciones (`match_game_images`, `save_photo_hash`, `upsert_cover_hash`, `hex_to_hash`), el gancho de hash al importar y el script de relleno. Se conservan `game_barcodes`, la descarga protegida de portadas (ahora la usa el endpoint) y `zxing-wasm`.

## 5. Metas, no metas y anti-metas

- **Metas:** reconocer en vivo; fiable (al menos 12 de 15 a la primera en la medición y ningún «Alta» equivocado); gratis; privado; funciona en móvil.
- **No metas:** reconocer varios juegos a la vez; reconocer fuera del catálogo (un juego nuevo se añade por BGG o por nombre); compartir vectores entre usuarios o dispositivos; WebGPU; modelos propios entrenados.
- **Anti-metas:** presentar una coincidencia dudosa como segura; consumir batería con la cámara abierta sin límite; bloquear la interfaz con el cálculo; descargar 85 MB a quien no usa la función.

## 6. Riesgos y decisiones por confirmar

- **Rendimiento en móvil sin medir** (aquí solo se mide en escritorio): CLIP cuantizado con WASM de un hilo puede tardar ~0,3–1,5 s por fotograma; la votación y la cadencia de ~2 fps lo absorben, y habrá un indicador de tiempo por fotograma. Si fuera lento, el plan B es DINOv2-small (23 MB, 11/15).
- **Descarga de 85 MB** la primera vez (con progreso, reintentable, en caché después). Con datos móviles el usuario debe saberlo antes de empezar.
- **Alojamiento del modelo en producción** (Supabase Storage frente a `public/`): límites de tamaño por confirmar al desplegar.
- **Ediciones distintas** de la portada de BGG no se reconocen hasta confirmarlas una vez (la referencia extra lo resuelve).
- **CSP y aislamiento de origen cruzado:** ONNX Runtime multihilo lo exige; se usa un solo hilo y la CSP actual (`'wasm-unsafe-eval'`, `worker-src blob:`) basta; se comprueba en E2E.
- **Licencias:** CLIP (MIT), conversión ONNX de Xenova (Apache-2.0), Transformers.js y ONNX Runtime Web (Apache-2.0 y MIT), OpenCV.js (Apache-2.0): se anotan en la documentación.
