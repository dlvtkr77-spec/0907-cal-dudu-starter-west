-- 확정 실패도 오류 단계와 함께 실행 기록에 남깁니다.

ALTER TABLE public.operation_logs
ADD COLUMN IF NOT EXISTS error_stage TEXT;

CREATE OR REPLACE FUNCTION public.record_confirm_failure(
  p_operation_id TEXT,
  p_request_id UUID,
  p_slot_id TEXT,
  p_admin_id TEXT,
  p_error_stage TEXT,
  p_error_message TEXT
)
RETURNS VOID
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.operation_logs (
    operation_id,
    action,
    request_id,
    slot_id,
    admin_id,
    status,
    error_stage,
    error_message
  )
  VALUES (
    p_operation_id,
    'confirm',
    p_request_id,
    p_slot_id,
    p_admin_id,
    'failed',
    p_error_stage,
    p_error_message
  )
  ON CONFLICT (operation_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_confirm_failure(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.confirm_request(
  p_request_id UUID,
  p_slot_id TEXT,
  p_admin_id TEXT,
  p_operation_id TEXT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_request_id UUID;
  v_request_status TEXT;
  v_slot_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'input_validation', 'Not authenticated'
    );
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'input_validation', 'Not admin'
    );
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT request_id
  INTO v_existing_request_id
  FROM public.operation_logs
  WHERE operation_id = p_operation_id
    AND status = 'success'
    AND action = 'confirm'
  LIMIT 1;

  IF v_existing_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'affectedRequests', ARRAY[]::UUID[]);
  END IF;

  SELECT status
  INTO v_request_status
  FROM public.requests
  WHERE id = p_request_id;

  IF v_request_status IS NULL THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'current_state', 'Request not found'
    );
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_request_status = 'confirmed' THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'current_state', 'already confirmed'
    );
    RETURN jsonb_build_object('success', false, 'error', 'already confirmed');
  END IF;

  SELECT status
  INTO v_slot_status
  FROM public.slots
  WHERE id = p_slot_id;

  IF v_slot_status IS NULL THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'current_state', 'Slot not found'
    );
    RETURN jsonb_build_object('success', false, 'error', 'Slot not found');
  END IF;

  IF v_slot_status = 'confirmed' THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'current_state', 'Slot already confirmed'
    );
    RETURN jsonb_build_object('success', false, 'error', 'Slot already confirmed');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.candidates AS c
    INNER JOIN public.requests AS r ON r.id = c.request_id
    WHERE c.request_id = p_request_id
      AND c.slot_id = p_slot_id
      AND c.version = r.version
  ) THEN
    PERFORM public.record_confirm_failure(
      p_operation_id, p_request_id, p_slot_id, p_admin_id,
      'input_validation', 'Not in current candidates'
    );
    RETURN jsonb_build_object('success', false, 'error', 'Not in current candidates');
  END IF;

  BEGIN
    UPDATE public.slots
    SET status = 'confirmed',
        confirmed_by = (SELECT customer_id FROM public.requests WHERE id = p_request_id),
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_slot_id
      AND status = 'available';

    IF NOT FOUND THEN
      PERFORM public.record_confirm_failure(
        p_operation_id, p_request_id, p_slot_id, p_admin_id,
        'current_state', 'Slot already confirmed'
      );
      RETURN jsonb_build_object('success', false, 'error', 'Slot already confirmed');
    END IF;

    UPDATE public.requests
    SET status = 'confirmed',
        confirmed_slot_id = p_slot_id,
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id;

    INSERT INTO public.confirmations (request_id, slot_id, admin_id)
    VALUES (p_request_id, p_slot_id, p_admin_id);

    UPDATE public.requests AS affected
    SET status = 'needs_reselection', updated_at = NOW()
    WHERE affected.status IN ('received', 'needs_reselection')
      AND affected.id <> p_request_id
      AND EXISTS (
        SELECT 1
        FROM public.candidates AS c
        WHERE c.request_id = affected.id
          AND c.slot_id = p_slot_id
          AND c.version = affected.version
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.candidates AS c2
        INNER JOIN public.slots AS s ON s.id = c2.slot_id
        WHERE c2.request_id = affected.id
          AND c2.version = affected.version
          AND s.status = 'available'
      );

    INSERT INTO public.operation_logs (
      operation_id, action, request_id, slot_id, admin_id, status, error_stage
    )
    VALUES (
      p_operation_id, 'confirm', p_request_id, p_slot_id, p_admin_id, 'success', 'completed'
    );

    RETURN jsonb_build_object('success', true, 'affectedRequests', ARRAY[]::UUID[]);
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM public.record_confirm_failure(
        p_operation_id, p_request_id, p_slot_id, p_admin_id,
        'save', 'Duplicate'
      );
      RETURN jsonb_build_object('success', false, 'error', 'Duplicate');
    WHEN OTHERS THEN
      PERFORM public.record_confirm_failure(
        p_operation_id, p_request_id, p_slot_id, p_admin_id,
        'save', SQLERRM
      );
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_request(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_request(UUID, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
