-- Permanent demo key for the landing page — NOT tied to user's email,
-- so personal key rotations won't break the public demo.
INSERT INTO api_keys (owner_name, owner_email, key_hash, is_active)
VALUES (
  'landing-page-demo',
  'demo@internal.wearemachina.com',
  '4ddde98a1e674a0367c49667f6a7bdeaf8c0e940f666bda03e60e8a62451b520',
  true
)
ON CONFLICT (owner_email) WHERE is_active = true
DO UPDATE SET key_hash = EXCLUDED.key_hash;
