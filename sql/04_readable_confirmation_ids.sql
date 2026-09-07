-- 확정 기록에 사람이 읽기 쉬운 고객/관리자 로그인 아이디를 함께 저장합니다.
-- request_id와 admin_id(UUID 문자열)는 관계 및 권한 확인을 위해 유지합니다.

ALTER TABLE public.confirmations
ADD COLUMN IF NOT EXISTS customer_login_id TEXT,
ADD COLUMN IF NOT EXISTS admin_login_id TEXT;

-- 기존 확정 기록을 현재 사용자/신청 정보로 채웁니다.
UPDATE public.confirmations AS c
SET customer_login_id = r.customer_login_id
FROM public.requests AS r
WHERE c.request_id = r.id
  AND c.customer_login_id IS NULL;

UPDATE public.confirmations AS c
SET admin_login_id = split_part(u.email, '@', 1)
FROM auth.users AS u
WHERE c.admin_id = u.id::text
  AND c.admin_login_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_confirmation_login_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_admin_email TEXT;
BEGIN
  SELECT r.customer_login_id
  INTO NEW.customer_login_id
  FROM public.requests AS r
  WHERE r.id = NEW.request_id;

  v_admin_email := auth.jwt() ->> 'email';
  IF v_admin_email IS NOT NULL AND v_admin_email <> '' THEN
    NEW.admin_login_id := split_part(lower(v_admin_email), '@', 1);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_confirmation_login_ids ON public.confirmations;
CREATE TRIGGER set_confirmation_login_ids
BEFORE INSERT ON public.confirmations
FOR EACH ROW
EXECUTE FUNCTION public.set_confirmation_login_ids();

REVOKE ALL ON FUNCTION public.set_confirmation_login_ids() FROM PUBLIC;

SELECT
  id,
  customer_login_id,
  admin_login_id,
  slot_id,
  confirmed_at,
  request_id,
  admin_id
FROM public.confirmations
ORDER BY confirmed_at;
