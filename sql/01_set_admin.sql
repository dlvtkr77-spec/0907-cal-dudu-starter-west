-- admin@test.com 사용자를 관리자 계정으로 지정합니다.
-- Supabase Dashboard > SQL Editor에서 한 번 실행한 뒤 앱에서 다시 로그인하세요.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@test.com') THEN
    RAISE EXCEPTION 'admin@test.com 사용자를 Authentication > Users에서 먼저 생성하세요.';
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  WHERE email = 'admin@test.com';
END;
$$;

SELECT
  email,
  raw_app_meta_data ->> 'role' AS role
FROM auth.users
WHERE email = 'admin@test.com';
