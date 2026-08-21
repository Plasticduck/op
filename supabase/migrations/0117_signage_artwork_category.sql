-- Tag standalone library artwork with a product category so each catalog tile can
-- show a gallery of the signs in that category. Null = uncategorized (Other Items).
alter table public.signage_artwork add column if not exists sign_category text;
