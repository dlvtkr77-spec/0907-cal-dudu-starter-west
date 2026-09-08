import { supabase } from './supabaseClient';

export const supabaseRPC = {
  async requestCancellation(requestId: string, operationId: string) {
    if (!supabase) return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };
    try {
      const { data, error } = await supabase.rpc('request_cancellation', { p_request_id: requestId, p_operation_id: operationId });
      if (error) return { success: false, error: error.message };
      return data;
    } catch (err) { return { success: false, error: String(err) }; }
  },

  async resolveCancellation(requestId: string, approve: boolean, operationId: string) {
    if (!supabase) return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };
    try {
      const { data, error } = await supabase.rpc('resolve_cancellation', { p_request_id: requestId, p_approve: approve, p_operation_id: operationId });
      if (error) return { success: false, error: error.message };
      return data;
    } catch (err) { return { success: false, error: String(err) }; }
  },

  async submitRequest(customerId: string, slotIds: string[], operationId: string, note = '') {
    if (!supabase) {
      return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };
    }

    try {
      const { data, error } = await supabase.rpc('submit_request_with_note', {
        p_customer_id: customerId,
        p_slot_ids: slotIds,
        p_operation_id: operationId,
        p_note: note,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return data;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  async confirmRequest(requestId: string, slotId: string, adminId: string, operationId: string) {
    if (!supabase) {
      return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };
    }

    try {
      const { data, error } = await supabase.rpc('confirm_request', {
        p_request_id: requestId,
        p_slot_id: slotId,
        p_admin_id: adminId,
        p_operation_id: operationId,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return data;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  async resubmitRequest(customerId: string, requestId: string, slotIds: string[], operationId: string) {
    if (!supabase) {
      return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };
    }

    try {
      const { data, error } = await supabase.rpc('resubmit_request', {
        p_customer_id: customerId,
        p_request_id: requestId,
        p_slot_ids: slotIds,
        p_operation_id: operationId,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return data;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  async getSlots() {
    if (!supabase) {
      return { success: false, slots: [] };
    }

    try {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .order('date')
        .order('time_label');

      if (error) {
        return { success: false, slots: [], error: error.message };
      }

      return { success: true, slots: data || [] };
    } catch (err) {
      return { success: false, slots: [], error: String(err) };
    }
  },

  async getCustomerRequests(customerId: string) {
    if (!supabase) {
      return { success: false, requests: [], candidates: [] };
    }

    try {
      const { data: requests, error: reqError } = await supabase
        .from('requests')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at');

      if (reqError) {
        return { success: false, requests: [], candidates: [], error: reqError.message };
      }

      if (!requests || requests.length === 0) {
        return { success: true, requests: [], candidates: [] };
      }

      const { data: candidates, error: candError } = await supabase
        .from('candidates')
        .select('*')
        .in('request_id', requests.map((r: any) => r.id));

      if (candError) {
        return { success: false, requests: requests || [], candidates: [], error: candError.message };
      }

      return { success: true, requests: requests || [], candidates: candidates || [] };
    } catch (err) {
      return { success: false, requests: [], candidates: [], error: String(err) };
    }
  },

  async getAllRequests() {
    if (!supabase) {
      return { success: false, requests: [], candidates: [] };
    }

    try {
      const { data: requests, error: reqError } = await supabase
        .from('requests')
        .select('*')
        .order('created_at');

      if (reqError) {
        return { success: false, requests: [], candidates: [], error: reqError.message };
      }

      const { data: candidates, error: candError } = await supabase
        .from('candidates')
        .select('*')
        .order('queue_seq');

      if (candError) {
        return { success: false, requests: requests || [], candidates: [], error: candError.message };
      }

      return { success: true, requests: requests || [], candidates: candidates || [] };
    } catch (err) {
      return { success: false, requests: [], candidates: [], error: String(err) };
    }
  },

  async getLogs() {
    if (!supabase) {
      return { success: false, logs: [] };
    }

    try {
      const { data, error } = await supabase
        .from('operation_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        return { success: false, logs: [], error: error.message };
      }

      return { success: true, logs: data || [] };
    } catch (err) {
      return { success: false, logs: [], error: String(err) };
    }
  },

  async deleteRequest(requestId: string) {
    if (!supabase) return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };

    try {
      const { data, error } = await supabase.rpc('admin_delete_request', {
        p_request_id: requestId,
      });
      if (error) return { success: false, error: error.message };
      return data;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  async resetAllData() {
    if (!supabase) return { success: false, error: '데이터베이스 연결이 설정되지 않았습니다.' };

    try {
      const { data, error } = await supabase.rpc('admin_reset_all_data');
      if (error) return { success: false, error: error.message };
      return data;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};
