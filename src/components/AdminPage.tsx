import React, { useState, useEffect } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate, OperationLog } from '../types';
import { OperationManager } from '../utils/operations';
import { DatabaseManager } from '../utils/database';
import { TIME_SLOTS } from '../utils/constants';
import { supabaseRPC } from '../utils/supabaseRPC';

interface AdminPageProps {
  db: DatabaseManager;
  mode: 'local' | 'supabase';
  userId?: string;
}

export const AdminPage: React.FC<AdminPageProps> = ({ db, mode, userId }) => {
  const [adminId] = useState<string>(userId || 'ADMIN001');
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [requests, setRequests] = useState<
    Array<{ request: Request; candidates: Candidate[]; decision: any }>
  >([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [selectedSlotForConfirm, setSelectedSlotForConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const om = new OperationManager(db);

  // 초기 로드
  useEffect(() => {
    if (mode === 'supabase') {
      loadSupabaseData();
    } else {
      loadData();
    }
  }, [mode]);

  const loadData = () => {
    const state = db.getState();
    setSlots(state.slots);
    setRequests(om.getAdminRequests());
    setLogs(state.logs || []);
    setError('');
    setSuccess('');
  };

  const loadSupabaseData = async () => {
    try {
      setError('');
      const result = await supabaseRPC.getAllRequests();
      if (!result.success) {
        setError(`데이터 조회 실패: ${result.error}`);
        return;
      }

      const slotsResult = await supabaseRPC.getSlots();
      if (!slotsResult.success) {
        setError(`슬롯 조회 실패: ${slotsResult.error}`);
        return;
      }

      const slotsMap: Record<string, Slot> = {};
      slotsResult.slots.forEach((s: any) => {
        slotsMap[s.id] = {
          id: s.id,
          date: s.date,
          timeLabel: s.time_label,
          status: s.status,
          confirmedAt: s.confirmed_at,
          confirmedBy: s.confirmed_by,
        };
      });
      setSlots(slotsMap);

      const requests = result.requests.map((r: any) => ({
        id: r.id,
        customerId: r.customer_login_id || r.customer_id,
        version: r.version,
        createdAt: r.created_at,
        status: r.status,
        confirmedSlotId: r.confirmed_slot_id,
        confirmedAt: r.confirmed_at,
      }));

      const candidates = result.candidates.map((c: any) => ({
        id: c.id,
        requestId: c.request_id,
        slotId: c.slot_id,
        priority: c.priority,
        version: c.version,
        queueSeq: c.queue_seq,
      }));

      const adminRequests = requests
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((req: Request) => {
          const reqCandidates = candidates.filter((c: Candidate) => c.requestId === req.id);
          return {
            request: req,
            candidates: reqCandidates.sort((a, b) => a.priority - b.priority),
            decision: { isValid: true },
          };
        });

      setRequests(adminRequests);

      const logsResult = await supabaseRPC.getLogs();
      if (logsResult.success) {
        setLogs(
          logsResult.logs.map((l: any) => ({
            id: l.id,
            timestamp: l.timestamp,
            action: l.action,
            requestId: l.request_id,
            adminId: l.admin_id,
            slotId: l.slot_id,
            status: l.status,
            error: l.error_message,
          }))
        );
      }
    } catch (err) {
      setError(`오류: ${String(err)}`);
    }
  };

  const handleConfirm = async () => {
    if (!selectedRequest || !selectedSlotForConfirm) {
      setError('요청과 슬롯을 선택하세요');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const operationId = `confirm-${selectedRequest}-${selectedSlotForConfirm}-${Date.now()}`;

      if (mode === 'supabase') {
        const result = await supabaseRPC.confirmRequest(
          selectedRequest,
          selectedSlotForConfirm,
          adminId,
          operationId
        );

        if (result.success) {
          setSuccess(`확정되었습니다!`);
          setSelectedRequest(null);
          setSelectedSlotForConfirm(null);
          setTimeout(() => loadSupabaseData(), 500);
        } else {
          setError(result.error || '확정 실패');
        }
      } else {
        const result = await om.confirmRequest(
          selectedRequest,
          selectedSlotForConfirm,
          adminId,
          operationId
        );

        if (result.success) {
          setSuccess(`확정되었습니다! 영향받은 요청: ${result.affectedRequests?.length || 0}건`);
          setSelectedRequest(null);
          setSelectedSlotForConfirm(null);
          setTimeout(() => loadData(), 500);
        } else {
          setError(result.error || '확정 실패');
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRequest = async () => {
    if (!selectedRequest || !window.confirm('선택한 접수건을 삭제하시겠습니까? 확정된 슬롯은 다시 활성화됩니다.')) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = mode === 'supabase'
        ? await supabaseRPC.deleteRequest(selectedRequest)
        : { success: db.deleteRequest(selectedRequest) };

      if (!result.success) {
        setError(('error' in result && result.error) || '접수건 삭제 실패');
        return;
      }

      setSelectedRequest(null);
      setSelectedSlotForConfirm(null);
      setSuccess('접수건을 삭제했습니다.');
      if (mode === 'supabase') await loadSupabaseData();
      else loadData();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResetAll = async () => {
    if (!window.confirm('모든 접수·후보·확정·실행 기록을 삭제하고 전체 슬롯을 초기화하시겠습니까?')) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    try {
      if (mode === 'supabase') {
        const result = await supabaseRPC.resetAllData();
        if (!result.success) {
          setError(result.error || '전체 초기화 실패');
          return;
        }
        await loadSupabaseData();
      } else {
        db.reset();
        loadData();
      }

      setSelectedRequest(null);
      setSelectedSlotForConfirm(null);
      setSuccess('전체 예약 데이터를 초기화했습니다.');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const currentRequest = selectedRequest ? requests.find(r => r.request.id === selectedRequest) : null;

  return (
    <div className="admin-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <h2>어드민 패널</h2>
        <button className="btn btn-danger" onClick={handleResetAll} disabled={loading}>
          전체 데이터 초기화
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="grid">
        {/* 요청 목록 */}
        <div>
          <h3>신청 목록 (총 {requests.length}건)</h3>
          <div style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
            <ul className="list" style={{ margin: 0 }}>
              {requests.map((item, idx) => (
                <li
                  key={item.request.id}
                  onClick={() => {
                    setSelectedRequest(item.request.id);
                    setSelectedSlotForConfirm(null);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: selectedRequest === item.request.id ? '#e7f3ff' : 'white',
                    borderColor: selectedRequest === item.request.id ? '#007bff' : '#ddd',
                    marginBottom: '0',
                    borderRadius: '0',
                    borderBottom: '1px solid #ddd',
                  }}
                >
                  <div>
                    <strong>#{idx + 1}</strong> {item.request.customerId} (v
                    {item.request.version})
                    <br />
                    <span style={{ fontSize: '12px', color: '#666' }}>
                      {new Date(item.request.createdAt).toLocaleString()}
                    </span>
                    <br />
                    <span className={`slot-status ${item.request.status === 'confirmed' ? 'confirmed' : 'available'}`}>
                      {item.request.status === 'confirmed'
                        ? '확정됨'
                        : item.request.status === 'needs_reselection'
                          ? '재선택필요'
                          : '접수됨'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 요청 상세 */}
        <div>
          <h3>요청 상세</h3>
          {currentRequest ? (
            <div style={{ padding: '16px', background: 'white', border: '1px solid #ddd', borderRadius: '4px' }}>
              <div className="form-group">
                <label>고객 코드</label>
                <input type="text" value={currentRequest.request.customerId} disabled />
              </div>

              <div className="form-group">
                <label>상태</label>
                <input
                  type="text"
                  value={
                    currentRequest.request.status === 'confirmed'
                      ? '확정됨'
                      : currentRequest.request.status === 'needs_reselection'
                        ? '재선택필요'
                        : '접수됨'
                  }
                  disabled
                />
              </div>

              <div className="form-group">
                <label>희망 슬롯 (우선순위 순)</label>
                <ul className="list">
                  {currentRequest.candidates.map((c, idx) => {
                    const slot = slots[c.slotId];
                    const isAvailable = slot?.status === 'available';
                    return (
                      <li
                        key={c.id}
                        onClick={() => {
                          if (isAvailable && currentRequest.request.status !== 'confirmed') {
                            setSelectedSlotForConfirm(c.slotId);
                          }
                        }}
                        style={{
                          cursor: isAvailable && currentRequest.request.status !== 'confirmed' ? 'pointer' : 'default',
                          background:
                            selectedSlotForConfirm === c.slotId
                              ? '#d4edda'
                              : isAvailable
                                ? 'white'
                                : '#f8d7da',
                          borderColor: selectedSlotForConfirm === c.slotId ? '#28a745' : '#ddd',
                        }}
                      >
                        <span>
                          {idx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                          {' '}
                          <span style={{ marginLeft: '10px', fontSize: '12px' }}>
                            {isAvailable ? '(가능)' : '(마감)'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {currentRequest.request.status === 'confirmed' && currentRequest.request.confirmedSlotId && (
                <div className="alert alert-success">
                  <strong>확정 완료</strong>
                  <br />
                  {slots[currentRequest.request.confirmedSlotId]?.date}{' '}
                  {TIME_SLOTS.find(t => t.label === slots[currentRequest.request.confirmedSlotId!]?.timeLabel)?.displayLabel}
                  <br />
                  {new Date(currentRequest.request.confirmedAt!).toLocaleString()}
                </div>
              )}

              {currentRequest.request.status !== 'confirmed' && (
                <button
                  className="btn btn-success"
                  onClick={handleConfirm}
                  disabled={!selectedSlotForConfirm || loading}
                  style={{ marginTop: '10px', width: '100%' }}
                >
                  {loading ? '처리 중...' : '확정'}
                </button>
              )}
              <button
                className="btn btn-danger"
                onClick={handleDeleteRequest}
                disabled={loading}
                style={{ marginTop: '10px', width: '100%' }}
              >
                이 접수건 삭제
              </button>
            </div>
          ) : (
            <div style={{ padding: '16px', background: '#f0f0f0', borderRadius: '4px', color: '#666' }}>
              목록에서 요청을 선택하세요
            </div>
          )}
        </div>
      </div>

      {/* 슬롯 현황 */}
      <div style={{ marginTop: '40px' }}>
        <h3>슬롯 현황 (표시용)</h3>
        <SlotTable slots={slots} selectedSlots={[]} onToggle={() => {}} mode="view" />
      </div>

      {/* 실행 기록 */}
      <div style={{ marginTop: '40px' }}>
        <h3>실행 기록 (최근 20건)</h3>
        <div className="table-container">
          <table className="slots-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>행위</th>
                <th>요청ID</th>
                <th>슬롯</th>
                <th>결과</th>
                <th>오류</th>
              </tr>
            </thead>
            <tbody>
              {logs
                .slice()
                .reverse()
                .slice(0, 20)
                .map(log => (
                  <tr key={log.id} style={{ fontSize: '12px' }}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.action}</td>
                    <td style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                      {log.requestId.substring(0, 8)}...
                    </td>
                    <td>{log.slotId ? log.slotId : '-'}</td>
                    <td>
                      <span style={{ color: log.status === 'success' ? '#28a745' : '#dc3545' }}>
                        {log.status === 'success' ? '성공' : '실패'}
                      </span>
                    </td>
                    <td style={{ color: '#dc3545' }}>{log.error ? log.error.substring(0, 30) : '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
