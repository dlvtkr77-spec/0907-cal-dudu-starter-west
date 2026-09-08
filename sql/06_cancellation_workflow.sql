-- 고객 취소 요청 -> 관리자 승인/거절. 기존 확정 이력은 보존합니다.

ALTER TABLE public.confirmations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE public.requests ADD CONSTRAINT requests_status_check
  CHECK (status IN ('received', 'needs_reselection', 'confirmed', 'cancellation_requested', 'cancelled'));

ALTER TABLE public.operation_logs DROP CONSTRAINT IF EXISTS operation_logs_action_check;
ALTER TABLE public.operation_logs ADD CONSTRAINT operation_logs_action_check
  CHECK (action IN ('submit', 'confirm', 'reselect', 'request_cancel', 'approve_cancel', 'reject_cancel'));

DROP INDEX IF EXISTS public.idx_requests_pending;
CREATE UNIQUE INDEX idx_requests_pending ON public.requests(customer_id)
  WHERE status IN ('received', 'needs_reselection', 'cancellation_requested');

DROP INDEX IF EXISTS public.idx_confirmations_request;
DROP INDEX IF EXISTS public.idx_confirmations_slot;
CREATE UNIQUE INDEX idx_confirmations_request ON public.confirmations(request_id)
  WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX idx_confirmations_slot ON public.confirmations(slot_id)
  WHERE cancelled_at IS NULL;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.request_cancellation(
  p_request_id UUID,
  p_operation_id TEXT
) RETURNS JSONB
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_request public.requests%ROWTYPE;
  v_start_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operation ID required');
  END IF;
  IF EXISTS (SELECT 1 FROM public.operation_logs WHERE operation_id = p_operation_id AND action = 'request_cancel' AND status = 'success') THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT * INTO v_request FROM public.requests
  WHERE id = p_request_id AND customer_id = auth.uid()::text FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found or not owner'); END IF;
  IF v_request.status <> 'confirmed' OR v_request.confirmed_slot_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only confirmed reservation can be cancelled');
  END IF;

  SELECT (s.date || ' ' || CASE s.time_label WHEN 'am' THEN '09:00' WHEN 'pm' THEN '13:00' ELSE '18:00' END || ' Asia/Seoul')::timestamptz
  INTO v_start_at FROM public.slots s WHERE s.id = v_request.confirmed_slot_id;
  IF v_start_at <= now() THEN RETURN jsonb_build_object('success', false, 'error', 'Past reservation cannot be cancelled'); END IF;

  UPDATE public.requests SET status = 'cancellation_requested', updated_at = now() WHERE id = p_request_id;
  INSERT INTO public.operation_logs(operation_id, action, request_id, slot_id, status, error_stage)
  VALUES (p_operation_id, 'request_cancel', p_request_id, v_request.confirmed_slot_id, 'success', 'completed');
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION private.resolve_cancellation(
  p_request_id UUID,
  p_approve BOOLEAN,
  p_operation_id TEXT
) RETURNS JSONB
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_request public.requests%ROWTYPE;
  v_action TEXT := CASE WHEN p_approve THEN 'approve_cancel' ELSE 'reject_cancel' END;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operation ID required');
  END IF;
  IF EXISTS (SELECT 1 FROM public.operation_logs WHERE operation_id = p_operation_id AND action = v_action AND status = 'success') THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT * INTO v_request FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'cancellation_requested' OR v_request.confirmed_slot_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cancellation request not found');
  END IF;

  IF p_approve THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.slots
      WHERE id = v_request.confirmed_slot_id AND status = 'confirmed' AND confirmed_by = v_request.customer_id
    ) THEN RETURN jsonb_build_object('success', false, 'error', 'Confirmed slot state mismatch'); END IF;
    UPDATE public.confirmations SET cancelled_at = now()
    WHERE request_id = p_request_id AND cancelled_at IS NULL;
    UPDATE public.slots SET status = 'available', confirmed_by = NULL, confirmed_at = NULL, updated_at = now()
    WHERE id = v_request.confirmed_slot_id AND status = 'confirmed' AND confirmed_by = v_request.customer_id;
    UPDATE public.requests SET status = 'cancelled', updated_at = now() WHERE id = p_request_id;
  ELSE
    UPDATE public.requests SET status = 'confirmed', updated_at = now() WHERE id = p_request_id;
  END IF;

  INSERT INTO public.operation_logs(operation_id, action, request_id, slot_id, admin_id, status, error_stage)
  VALUES (p_operation_id, v_action, p_request_id, v_request.confirmed_slot_id, auth.uid()::text, 'success', 'completed');
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_cancellation(p_request_id UUID, p_operation_id TEXT)
RETURNS JSONB SECURITY INVOKER SET search_path = '' LANGUAGE sql
AS $$ SELECT private.request_cancellation(p_request_id, p_operation_id) $$;

CREATE OR REPLACE FUNCTION public.resolve_cancellation(p_request_id UUID, p_approve BOOLEAN, p_operation_id TEXT)
RETURNS JSONB SECURITY INVOKER SET search_path = '' LANGUAGE sql
AS $$ SELECT private.resolve_cancellation(p_request_id, p_approve, p_operation_id) $$;

REVOKE ALL ON FUNCTION private.request_cancellation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.resolve_cancellation(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_cancellation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_cancellation(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.request_cancellation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION private.resolve_cancellation(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_cancellation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_cancellation(UUID, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
