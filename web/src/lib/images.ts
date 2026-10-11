import { ref, uploadBytes } from 'firebase/storage'
import { storage } from './firebase'

/** Downscale + re-encode in the browser: keeps uploads small on mobile networks and strips EXIF (incl. GPS). */
export async function compressImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not process image'))), 'image/jpeg', quality))
}
export async function uploadImage(path: string, file: File) {
  const blob = await compressImage(file)
  await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' })
  return path
}
export const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
