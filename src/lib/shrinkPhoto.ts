// Phone photos come in at 2-5 MB. Resize to 2000px on the long side as a JPEG
// before uploading: much faster on cellular and lighter on the phone's memory
// (iOS can reload the page under memory pressure after using the camera). Drawn
// through an <img> so the photo's EXIF rotation is applied. Falls back to the
// original file if anything fails.
// `alwaysJpeg` turns any picture the browser can open (PNG, GIF, WebP, AVIF, BMP,
// HEIC on iPhones) into a JPEG even when it's already small, so it shows
// everywhere it's used later, including PDFs built on the server.
export async function shrinkPhoto(file: File, maxPx = 2000, opts?: { alwaysJpeg?: boolean }): Promise<File> {
  const always = !!opts?.alwaysJpeg
  // Some phones and Windows give HEIC files no type; let the browser try them.
  if (!file.type.startsWith('image/') && !(always && /\.(heic|heif|avif|bmp|tiff?)$/i.test(file.name))) return file
  if (file.type === 'image/gif' && !always) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = url
    })
    const w0 = img.naturalWidth || 1
    const h0 = img.naturalHeight || 1
    const scale = Math.min(1, maxPx / Math.max(w0, h0))
    const isJpeg = file.type === 'image/jpeg'
    if (scale === 1 && file.size < 1_500_000 && (!always || isJpeg)) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w0 * scale)
    canvas.height = Math.round(h0 * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // JPEG has no transparency: see-through parts of a PNG come out white, not black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || ((!always || isJpeg) && blob.size >= file.size)) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
