# Fase 7a-3 — Reconocer contra los 500 mejores de BoardGameGeek (paquete de vectores precalculado): diseño

> 2026-11-17 · Estado: aprobado por el usuario en la conversación (diseño presentado y «puedes continuar»). Sigue a la 7a-2 (ADR-037).

## Por qué
Probando la 7a-2 en el móvil, el usuario vio que la cámara solo reconoce los juegos que ya están en su catálogo, y en su cuenta solo están los 15 juegos de prueba. La idea era comparar con una **base de datos de juegos de mesa**, no con los juegos de prueba. Nadie importará un juego antes de enseñárselo a la cámara.

## Objetivo
Al apuntar la cámara a la caja de cualquiera de los **500 mejores juegos del ranking de BGG**, aunque no esté en el catálogo, sale «Parece X» con su confianza honesta y un botón **Añadir al catálogo y abrir**.

## Fuera de alcance (anti-metas)
Más de 500 juegos; distinguir ediciones/reimpresiones de una misma portada; la 7b (puntuar por foto, aplazada); procesar fotogramas en el servidor; que una respuesta errónea se presente como segura (el criterio de la 7a-2 se mantiene: 0 errores en «alta/media»).

## Restricciones heredadas
Todo en el dispositivo; la función sigue **apagada por defecto y por dispositivo**; el aviso de tamaño va antes de cualquier descarga; ningún fotograma sale del dispositivo; sin CDN en tiempo de ejecución; vectores y modelo deben ser compatibles (mismo CLIP, misma preparación de imagen que el worker); i18n en/es/fr con claves idénticas; nunca `import { cn } from "cn"`.

## Enfoques considerados
- **A. Paquete de vectores precalculado (elegido por el usuario).** Se calculan una vez los 500 vectores y se sirven como un fichero (~1 MB). Cada móvil solo descarga eso.
- **B. Importar 500 juegos al catálogo y que cada dispositivo calcule.** Más simple, pero cada móvil bajaría y procesaría 500 portadas (minutos y datos) y se llenaría el catálogo global de juegos que nadie pidió. Descartado.

## Diseño

### 1. Fuente de la lista
`boardgame_ranks.csv` (volcado oficial de BGG, descargado por el usuario a `C:\Users\andre\Documents\amika-eval\`; fuera del repo). Columnas: `ID, Name, Year, Rank, Average, Bayes average, Users rated, URL, Thumbnail`. Se toman las filas con `Rank` 1..500 (descartando filas sin id o sin ranking). El CSV solo trae miniaturas de 64 px: las portadas completas se piden a la API de BGG (`thing`, lotes de 20, con el token y pausas entre peticiones).

### 2. Generación (script de un solo uso, en la máquina del desarrollador)
`scripts/build-reference-pack.mts <csv> [--count 500]`:
- Lee el CSV, pide nombre/portada a BGG por lotes (reutiliza el cliente BGG: reintentos con cola 202, límite de ritmo, token), reanudable (caché de respuestas en una carpeta temporal).
- Descarga cada portada con `fetchCoverBytes` + `coverJpeg` (mismo guardián anti-SSRF y mismo recorte a 512 px que el endpoint de portadas) y calcula su vector con **el mismo CLIP y el mismo preprocesado** que el worker (el test de paridad de la 7a-2 ya fija ese contrato).
- Escribe: `src/features/recognition/pack/pack-manifest.json` (versión, modelo, dimensión, y por juego: `bggId`, nombre, año, rank, `coverUrl`) y `public/reference-pack/vectors-<hash8>.bin` (Float32 normalizado, `count × 512`; ~1 MB). El manifiesto nombra su fichero de vectores, así que no pueden desajustarse.
- Informa de los juegos sin portada o con error (se omiten, no se inventan vectores).
- Ambos ficheros se versionan en git: el despliegue es reproducible sin tocar BGG. Se regenera cuando se quiera actualizar el ranking.

### 3. En el dispositivo
- Al activar (o al abrir la cámara con una versión de paquete nueva) se descarga `vectors-<hash8>.bin` desde nuestro origen y se guarda en IndexedDB con `kind: "pack"` e id `bgg:<bggId>`. El aviso previo pasa a decir «modelo 85 MB + paquete de 500 juegos ~1 MB».
- El manifiesto se carga con `import()` dinámico (no entra en el JS inicial de ninguna ruta).
- **Convivencia con el catálogo:** `RecognitionGame` incorpora `bggId`; si un juego del catálogo coincide con uno del paquete, **gana el del catálogo** y la entrada del paquete no se usa. La purga de `buildReferences` nunca toca entradas del paquete ni se confunde con ellas; el paquete se reemplaza entero al cambiar de versión. «Desactivar y borrar datos» también lo elimina.
- Los vectores aprendidos solo existen para juegos del catálogo (confirmar un juego del paquete lo añade antes al catálogo).

### 4. Resultado y verificación ORB
- Un candidato del paquete se muestra como «Parece X · n.º {rank} de BGG» con **Añadir al catálogo y abrir**: importa de BGG por id (acción existente `importGameAction`, con su cuota y su estado «no disponible» sin token) y navega a la ficha; el vector confirmado se guarda como aprendido del juego ya importado.
- Para ORB, la portada del candidato del paquete se obtiene con un endpoint nuevo `GET /api/covers/pack/[bggId]`: exige sesión, solo acepta ids que estén en el manifiesto (cualquier otro → 404 idéntico), usa `coverUrl` **del manifiesto** (nunca de la petición) y pasa por el mismo guardián y recorte que el endpoint actual.
- La lógica de decisión (`decide`, umbrales, voto) no cambia.

### 5. Medición (puerta de calidad)
Se amplía `scripts/eval-recognition.mts` para usar el paquete como referencias y repetir la prueba con las 15 fotos del usuario. Informa, por foto, si el juego está en el top 500. Con más portadas parecidas puede haber más confusiones, así que el criterio es **0 equivocadas en «alta/media»**; se informa cuántas reconoce. Los juegos de las 15 fotos que no estén en el top 500 deben acabar en «no estoy seguro», nunca en una respuesta segura.

### 6. Pruebas
Unitarias: lector del CSV (filas rotas, rank 0, comillas), formato binario del paquete (ida y vuelta, longitud errónea, NaN), fusión paquete+catálogo (el catálogo gana, la purga respeta el paquete), manifiesto→endpoint (id fuera del manifiesto, URL no permitida), instalación del paquete (cancelar/fallar no deja restos; sin activar no hay ninguna petición). E2E: con el paquete real y la cámara falsa, una portada del paquete que no está en el catálogo sale como «Parece X» con el botón de añadir; el JS inicial no contiene el paquete; sin activar, cero peticiones al paquete.

### 7. Documentación
ADR-038 (paquete frente a importar; formato; límite de 500; criterio de calidad), SECURITY §17 (endpoint del paquete, licencia: vectores derivados de portadas de BGG, uso personal y no comercial, atribución), ROADMAP.

## Decisiones mías (a revisar)
- 500 = `Rank` 1..500 del ranking general (no por categoría), tal como pidió el usuario.
- El paquete se versiona en git (~1 MB) en vez de generarse en cada build, para no depender de BGG ni del token al desplegar.
- Los vectores aprendidos solo para juegos del catálogo, para no inventar identidades locales.
- Lo que queda al constructor: nombres de ficheros internos, tamaño de lote exacto y pausas, forma del texto del aviso en es/fr.

## Pendiente del usuario (fuera del código)
Poner `BGG_API_TOKEN` en Vercel y redesplegar: sin él, «Añadir al catálogo» y el buscador de BGG salen como no disponibles en producción.
