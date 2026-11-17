-- Site audit photos in any common format. The bucket took JPEG, PNG, WebP and
-- HEIC/HEIF only, so a GIF, BMP, TIFF or AVIF the browser couldn't turn into a
-- JPEG first was refused at upload. Storage's resizer reads all of these, which is
-- how the emailed PDF and the app show them.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'image/gif', 'image/bmp', 'image/tiff', 'image/avif'
]
where id = 'site-audit-photos';
