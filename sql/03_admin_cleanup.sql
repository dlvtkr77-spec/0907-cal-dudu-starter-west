-- 어드민 페이지의 접수건 삭제 및 전체 초기화 RPC

CREATE OR REPLACE FUNCTION public.admin_delete_request(p_request_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_confirmed_slot_id TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT confirmed_slot_id
  INTO v_confirmed_slot_id
  FROM public.requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  DELETE FROM public.confirmations WHERE request_id = p_request_id;
  DELETE FROM public.operation_logs WHERE request_id = p_request_id;
  DELETE FROM public.candidates WHERE request_id = p_request_id;
  DELETE FROM public.requests WHERE id = p_request_id;

  IF v_confirmed_slot_id IS NOT NULL THEN
    UPDATE public.slots
    SET status = 'available',
        confirmed_by = NULL,
        confirmed_at = NULL,
        updated_at = NOW()
    WHERE id = v_confirmed_slot_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_data()
RETURNS JSONB
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  DELETE FROM public.confirmations;
  DELETE FROM public.operation_logs;
  DELETE FROM public.candidates;
  DELETE FROM public.requests;

  UPDATE public.slots
  SET status = 'available',
      confirmed_by = NULL,
      confirmed_at = NULL,
      updated_at = NOW();

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_request(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reset_all_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_data() TO authenticated;
