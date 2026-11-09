-- Keep avatar and banner objects within the same 25 MB limit enforced by Veyra.
UPDATE storage.buckets
SET file_size_limit = 26214400
WHERE id IN ('avatars', 'banners');
