-- 선택 메모를 신청과 같은 트랜잭션에서 저장합니다.
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_note_length_check;
ALTER TABLE public.requests ADD CONSTRAINT requests_note_length_check CHECK (note IS NULL OR char_length(note) <= 500);

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.submit_request_with_note(p_customer_id TEXT, p_slot_ids TEXT[], p_operation_id TEXT, p_note TEXT)
RETURNS JSONB SECURITY DEFINER SET search_path = '' LANGUAGE plpgsql AS $$
DECLARE v_request_id UUID; v_queue_seq INTEGER; i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  IF p_customer_id <> auth.uid()::text THEN RETURN jsonb_build_object('success', false, 'error', 'Not owner'); END IF;
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'Operation ID required'); END IF;
  IF char_length(COALESCE(p_note, '')) > 500 THEN RETURN jsonb_build_object('success', false, 'error', 'Note must be 500 characters or fewer'); END IF;
  SELECT request_id INTO v_request_id FROM public.operation_logs WHERE operation_id = p_operation_id AND action = 'submit' AND status = 'success' LIMIT 1;
  IF v_request_id IS NOT NULL THEN RETURN jsonb_build_object('success', true, 'requestId', v_request_id::text); END IF;
  IF EXISTS (SELECT 1 FROM public.requests WHERE customer_id = auth.uid()::text AND status IN ('received', 'needs_reselection', 'cancellation_requested')) THEN RETURN jsonb_build_object('success', false, 'error', 'Customer already has a pending request'); END IF;
  IF COALESCE(array_length(p_slot_ids, 1), 0) NOT BETWEEN 1 AND 3 THEN RETURN jsonb_build_object('success', false, 'error', 'Select 1-3 slots'); END IF;
  IF (SELECT count(DISTINCT value) FROM unnest(p_slot_ids) AS value) <> array_length(p_slot_ids, 1) THEN RETURN jsonb_build_object('success', false, 'error', 'Duplicate slots'); END IF;
  IF (SELECT count(*) FROM public.slots WHERE id = ANY(p_slot_ids)) <> array_length(p_slot_ids, 1) THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid slot'); END IF;
  IF EXISTS (SELECT 1 FROM public.slots WHERE id = ANY(p_slot_ids) AND status = 'confirmed') THEN RETURN jsonb_build_object('success', false, 'error', 'Some slots are closed'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.slots s WHERE s.id = ANY(p_slot_ids)
      AND (s.date || ' ' || CASE s.time_label WHEN 'am' THEN '09:00' WHEN 'pm' THEN '13:00' ELSE '18:00' END || ' Asia/Seoul')::timestamptz <= now()
  ) THEN RETURN jsonb_build_object('success', false, 'error', 'Some slots have already started'); END IF;
  INSERT INTO public.requests(customer_id, version, status, note) VALUES (auth.uid()::text, 1, 'received', NULLIF(btrim(COALESCE(p_note, '')), '')) RETURNING id INTO v_request_id;
  SELECT COALESCE(max(queue_seq), 0) + 1 INTO v_queue_seq FROM public.candidates;
  FOR i IN 1..array_length(p_slot_ids, 1) LOOP INSERT INTO public.candidates(request_id, slot_id, priority, version, queue_seq) VALUES (v_request_id, p_slot_ids[i], i, 1, v_queue_seq + i - 1); END LOOP;
  INSERT INTO public.operation_logs(operation_id, action, request_id, status, error_stage) VALUES (p_operation_id, 'submit', v_request_id, 'success', 'completed');
  RETURN jsonb_build_object('success', true, 'requestId', v_request_id::text);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('success', false, 'error', 'Duplicate operation or pending request'); WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM); END;
$$;

CREATE OR REPLACE FUNCTION public.submit_request_with_note(p_customer_id TEXT, p_slot_ids TEXT[], p_operation_id TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB SECURITY INVOKER SET search_path = '' LANGUAGE sql AS $$ SELECT private.submit_request_with_note(p_customer_id, p_slot_ids, p_operation_id, p_note) $$;
REVOKE ALL ON FUNCTION private.submit_request_with_note(TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_request_with_note(TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.submit_request_with_note(TEXT, TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_request_with_note(TEXT, TEXT[], TEXT, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
