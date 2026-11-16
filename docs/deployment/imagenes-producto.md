# Imágenes de producto (volumen persistente)

Decisión del usuario 9 (issue #23): las imágenes de producto se guardan en el disco del VPS, en un **volumen persistente de Coolify**, con compresión y límite de tamaño. UploadThing queda retirado. Todo pasa por la interfaz `StorageProvider` para poder cambiar a OCI Object Storage más adelante sin tocar el código de negocio.

## Cómo funciona

| Pieza | Archivo |
|-------|---------|
| Interfaz `StorageProvider` (`put`, `get`, `delete`, `url`, `keyFromUrl`) y reglas de claves | `pos-system-client/src/lib/storage/storage-provider.ts` |
| Implementación en disco (`LocalDiskStorage`) | `pos-system-client/src/lib/storage/local-disk-storage.ts` |
| Selección por entorno (`getStorage()`) | `pos-system-client/src/lib/storage/index.ts` |
| Validación (magic bytes) y compresión con `sharp` | `pos-system-client/src/lib/images/product-image.ts` |
| Subida (solo ADMIN) | `POST /api/images` → `src/lib/images/upload-product-image.ts` |
| Servir imágenes | `GET /api/images/<orgId>/products/<uuid>.webp` |

- **Subida:** multipart con un campo `file`. Exige `Content-Length` (411 si falta) y corta la lectura del cuerpo al superar el límite. Solo un miembro ADMIN activo (cookie + sesión persistida + membresía). Tipos permitidos por contenido real: JPEG, PNG y WebP (SVG, GIF, HEIC… se rechazan con 415). Límite de entrada `MAX_IMAGE_UPLOAD_MB` (5 MB por defecto, 413 si se supera). Límite de 40 MP para evitar bombas de descompresión.
- **Procesado:** se aplica la orientación EXIF, se quitan metadatos, se redimensiona a un máximo de 1600 px y se guarda en **WebP** por debajo de 400 KB (baja la calidad 80→50 si hace falta).
- **Claves:** las genera el servidor: `<organizationId>/products/<uuid>.webp`. El cliente nunca elige la ruta; las claves se validan con una lista blanca de caracteres (sin `..`, `/` inicial ni `\`) y la implementación de disco comprueba además que la ruta final queda dentro de `UPLOADS_DIR`.
- **Aislamiento:** un producto solo puede referenciar imágenes de su organización, y el borrado solo actúa sobre claves de esa organización.
- **Borrado:** al cambiar o quitar la imagen de un producto (después de guardar en BD) y al borrar el producto definitivamente. El borrado suave conserva la imagen.
- **Lectura:** las imágenes son públicas por URL (UUID no adivinable), con `Cache-Control: public, max-age=31536000, immutable`, `ETag`, `nosniff` y CSP `default-src 'none'`. Una clave nunca se sobrescribe; cambiar la imagen crea una clave nueva.

## Variables de entorno (client)

| Variable | Valor en Coolify | Notas |
|----------|------------------|-------|
| `UPLOADS_DIR` | `/app/uploads` | **Obligatoria en producción.** En local, si está vacía, se usa `pos-system-client/.uploads` (ignorado por git). |
| `MAX_IMAGE_UPLOAD_MB` | `5` | Opcional. |
| `STORAGE_DRIVER` | (vacío) | Opcional; solo existe `local`. |

`UPLOADTHING_TOKEN` ya no se usa: bórrala de Coolify si existe.

## Volumen en Coolify

En el recurso del client: **Persistent Storage → Add → Volume Mount**

- Nombre: `pos-uploads` (cualquiera).
- Destination path (en el contenedor): `/app/uploads`.

El contenedor corre como `root`, así que no hace falta ajustar permisos. Si el runner pasa a `USER node`, el Dockerfile debe crear `/app/uploads` y hacer `chown node:node` antes del `USER`. Con `docker compose` local el volumen `uploads` ya está declarado en `docker-compose.yml`.

Espacio: cada imagen ocupa ≤ 400 KB; 1.000 productos con imagen son ≤ 400 MB. Vigilar el disco del VPS. Sin backups del volumen por ahora (decisión: sin backups mientras sea demo/MVP).

## Pasar a OCI Object Storage (futuro)

1. Crear `OciObjectStorage implements StorageProvider` en `src/lib/storage/`.
2. Seleccionarla en `getStorage()` con `STORAGE_DRIVER=oci`.
3. `url()` puede seguir devolviendo `/api/images/<key>` (proxy con caché) o una URL pública/PAR del bucket; en ese caso, añadir el host a `images.remotePatterns` de `next.config.ts`.
4. Copiar los archivos del volumen al bucket con la misma clave.

## Pruebas

```bash
cd pos-system-client
pnpm --ignore-workspace test:images
```
