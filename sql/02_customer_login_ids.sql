-- 신청 테이블에 사람이 읽기 쉬운 로그인 아이디를 함께 저장합니다.
-- customer_id(UUID 문자열)는 RLS와 소유자 검증용이므로 그대로 유지합니다.

ALTER TABLE public.requests
ADD COLUMN IF NOT EXISTS customer_login_id TEXT;

-- 기존 신청도 Authentication 사용자의 이메일 앞부분으로 채웁니다.
UPDATE public.requests AS r
SET customer_login_id = split_part(u.email, '@', 1)
FROM auth.users AS u
WHERE r.customer_id = u.id::text
  AND r.customer_login_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_request_customer_login_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := auth.jwt() ->> 'email';

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated user email is required';
  END IF;

  NEW.customer_login_id := split_part(lower(v_email), '@', 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_request_customer_login_id ON public.requests;
CREATE TRIGGER set_request_customer_login_id
BEFORE INSERT ON public.requests
FOR EACH ROW
EXECUTE FUNCTION public.set_request_customer_login_id();

REVOKE ALL ON FUNCTION public.set_request_customer_login_id() FROM PUBLIC;

SELECT id, customer_id, customer_login_id, status, created_at
FROM public.requests
ORDER BY created_at;
