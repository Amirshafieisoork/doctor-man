-- Close direct public access to private lab images.
-- Backend service_role / private service proxy access bypasses Storage RLS.
-- No files, buckets, records, or table grants are removed.
DROP POLICY IF EXISTS lab_images_all_access ON storage.objects;
