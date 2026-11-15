/**
 * Browser-only. Decodes any image the browser understands, scales it down and
 * re-encodes it as JPEG. Re-encoding also drops EXIF metadata (GPS location,
 * camera serial…), which matters for photos taken at home.
 */
export async function resizeToJpeg(
  file: Blob,
  maxSide = 1600,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("could not encode image")),
        "image/jpeg",
        quality,
      ),
    );
  } finally {
    bitmap.close();
  }
}
