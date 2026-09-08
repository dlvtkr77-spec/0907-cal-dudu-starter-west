import React, { useState, useEffect } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate, OperationLog } from '../types';
import { OperationManager } from '../utils/operations';
import { DatabaseManager } from '../utils/database';
import { TIME_SLOTS } from '../utils/constants';
import { supabaseRPC } from '../utils/supabaseRPC';
import {
  countAdminRequestStatuses,
  filterAdminRequests,
  getFirstReceivedRequestId,
  getEarliestCandidateTime,
  sortAdminRequests,
  type AdminStatusFilter,
} from '../utils/adminPriority';
import {
  getOperationActionLabel,
  getOperationErrorStage,
  sortOperationLogsNewestFirst,
} from '../utils/operationLogDisplay';

interface AdminPageProps {
  db: DatabaseManager;
  mode: 'local' | 'supabase';
  userId?: string;
}

type AdminSection = 'requests' | 'slots' | 'logs';
const getAdminSectionFromPath = (): AdminSection => {
  if (window.location.pathname === '/admin/slots') return 'slots';
  if (window.location.pathname === '/admin/logs') return 'logs';
  return 'requests';
};

const getUrgencyLabel = (candidates: Candidate[], slots: Record<string, Slot>) => {
  const earliest = getEarliestCandidateTime(candidates, slots);
  if (!Number.isFinite(earliest)) return null;

  const days = Math.ceil((earliest - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: '시간 경과', color: '#dc3545' };
  if (days === 0) return { text: '오늘', color: '#dc3545' };
  if (days === 1) return { text: 'D-1', color: '#dc3545' };
  if (days <= 3) return { text: `D-${days}`, color: '#fd7e14' };
  return { text: `D-${days}`, color: '#6c757d' };
};

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
  const [statusFilter, setStatusFilter] = useState<AdminStatusFilter>('received');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [section, setSection] = useState<AdminSection>(getAdminSectionFromPath);

  const om = new OperationManager(db);

  const navigateToSection = (nextSection: AdminSection) => {
    window.history.pushState({}, '', `/admin/${nextSection}`);
    setSection(nextSection);
    setError('');
    setSuccess('');
  };

  useEffect(() => {
    if (window.location.pathname === '/admin') {
      window.history.replaceState({}, '', '/admin/requests');
    }
    const handlePopState = () => setSection(getAdminSectionFromPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    const adminRequests = sortAdminRequests(om.getAdminRequests(), state.slots);
    setSlots(state.slots);
    setRequests(adminRequests);
    setSelectedRequest(adminRequests.find(item => item.request.status === 'cancellation_requested')?.request.id ?? getFirstReceivedRequestId(adminRequests));
    setSelectedSlotForConfirm(null);
    setLogs(state.logs || []);
    setLastUpdatedAt(new Date());
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
        note: r.note,
      }));

      const candidates = result.candidates.map((c: any) => ({
        id: c.id,
        requestId: c.request_id,
        slotId: c.slot_id,
        priority: c.priority,
        version: c.version,
        queueSeq: c.queue_seq,
      }));

      const adminRequests = sortAdminRequests(
        requests.map((req: Request) => {
          const reqCandidates = candidates.filter((c: Candidate) => c.requestId === req.id);
          return {
            request: req,
            candidates: reqCandidates.sort((a, b) => a.priority - b.priority),
            decision: { isValid: true },
          };
        }),
        slotsMap
      );

      setRequests(adminRequests);
      setSelectedRequest(adminRequests.find(item => item.request.status === 'cancellation_requested')?.request.id ?? getFirstReceivedRequestId(adminRequests));
      setSelectedSlotForConfirm(null);

      const logsResult = await supabaseRPC.getLogs();
      if (logsResult.success) {
        setLogs(
          logsResult.logs.map((l: any) => ({
            id: l.id,
            operationId: l.operation_id,
            timestamp: l.timestamp,
            action: l.action,
            requestId: l.request_id || '',
            adminId: l.admin_id,
            slotId: l.slot_id,
            status: l.status,
            errorStage: l.error_stage,
            error: l.error_message,
          }))
        );
      }
      setLastUpdatedAt(new Date());
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

  const handleRefreshRequests = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'supabase') await loadSupabaseData();
      else loadData();
    } finally {
      setLoading(false);
    }
  };

  const handleResolveCancellation = async (approve: boolean) => {
    if (!selectedRequest) return;
    const action = approve ? '승인' : '거절';
    if (!window.confirm(`이 취소 요청을 ${action}하시겠습니까?`)) return;
    setLoading(true); setError(''); setSuccess('');
    const operationId = `cancel-${approve ? 'approve' : 'reject'}-${selectedRequest}`;
    try {
      const result = mode === 'supabase'
        ? await supabaseRPC.resolveCancellation(selectedRequest, approve, operationId)
        : await om.resolveCancellation(selectedRequest, adminId, approve, operationId);
      if (!result.success) { setError(result.error || `취소 ${action} 실패`); return; }
      if (mode === 'supabase') await loadSupabaseData(); else loadData();
      setSuccess(`취소 요청을 ${action}했습니다.`);
    } finally { setLoading(false); }
  };

  const requestCounts = countAdminRequestStatuses(requests);
  const visibleRequests = filterAdminRequests(requests, statusFilter);
  const currentRequest = selectedRequest ? requests.find(r => r.request.id === selectedRequest) : null;

  const statusFilters: Array<{ value: AdminStatusFilter; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'received', label: '접수됨' },
    { value: 'needs_reselection', label: '재선택 필요' },
    { value: 'confirmed', label: '확정됨' },
    { value: 'cancellation_requested', label: '취소 요청' },
    { value: 'cancelled', label: '취소됨' },
  ];

  return (
    <div className="admin-page page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">관리자 업무함</span><h2>{section === 'requests' ? '예약 요청 관리' : section === 'slots' ? '슬롯 현황' : '실행 기록'}</h2><p>{section === 'requests' ? '접수 순서와 희망 시간을 확인한 뒤 수동으로 확정합니다.' : section === 'slots' ? '14일간의 전체 예약 가능 여부를 확인합니다.' : '저장 작업의 성공과 실패 위치를 확인합니다.'}</p></div>
        <button className="btn btn-danger" onClick={handleResetAll} disabled={loading}>
          전체 데이터 초기화
        </button>
      </div>

      <nav className="section-nav" aria-label="관리자 메뉴">
        {([['requests', '신청 관리'], ['slots', '슬롯 현황'], ['logs', '실행 기록']] as const).map(([value, label]) => (
          <button key={value} type="button" className={section === value ? 'active' : ''} aria-current={section === value ? 'page' : undefined} onClick={() => navigateToSection(value)}>{label}</button>
        ))}
      </nav>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {section === 'requests' && <>
      <section className="admin-metrics" aria-label="예약 요청 요약">
        <div><span>확인 대기</span><strong>{requestCounts.received}</strong></div>
        <div><span>재선택 필요</span><strong>{requestCounts.needs_reselection}</strong></div>
        <div><span>확정 완료</span><strong>{requestCounts.confirmed}</strong></div>
        <div><span>취소 요청</span><strong>{requestCounts.cancellation_requested}</strong></div>
      </section>

      <div className="grid admin-workspace">
        {/* 요청 목록 */}
        <div>
          <div className="admin-list-heading">
            <div>
              <h3>신청 목록 <span className="count-label">총 {requests.length}건</span></h3>
              {lastUpdatedAt && (
                <span>마지막 확인: {lastUpdatedAt.toLocaleTimeString()}</span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRefreshRequests}
              disabled={loading}
            >
              {loading ? '확인 중...' : '신청 목록 새로고침'}
            </button>
          </div>
          <div className="admin-status-filters" aria-label="신청 상태 필터">
            {statusFilters.map(filter => (
              <button
                key={filter.value}
                type="button"
                className={`btn ${statusFilter === filter.value ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={statusFilter === filter.value}
                onClick={() => {
                  setStatusFilter(filter.value);
                  setSelectedRequest(null);
                  setSelectedSlotForConfirm(null);
                }}
              >
                {filter.label} {requestCounts[filter.value]}
              </button>
            ))}
          </div>
          <div className="admin-request-list">
            <ul className="list" style={{ margin: 0 }}>
              {visibleRequests.map((item, idx) => {
                const urgency = ['confirmed', 'cancelled'].includes(item.request.status)
                  ? null
                  : getUrgencyLabel(item.candidates, slots);
                return (
                <li
                  key={item.request.id}
                  className={`admin-request-item ${selectedRequest === item.request.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedRequest(item.request.id);
                    setSelectedSlotForConfirm(null);
                  }}
                  style={{
                    cursor: 'pointer',
                    marginBottom: '0',
                    borderRadius: '0',
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
                      {item.request.status === 'confirmed' ? '확정됨'
                        : item.request.status === 'cancellation_requested' ? '취소 요청'
                        : item.request.status === 'cancelled' ? '취소됨'
                        : item.request.status === 'needs_reselection'
                          ? '재선택필요'
                          : '예약 확인중'}
                    </span>
                    {urgency && (
                      <strong style={{ marginLeft: '8px', color: urgency.color, fontSize: '12px' }}>
                        확인 {urgency.text}
                      </strong>
                    )}
                  </div>
                </li>
                );
              })}
              {visibleRequests.length === 0 && (
                <li style={{ color: '#666', cursor: 'default' }}>해당 상태의 신청이 없습니다.</li>
              )}
            </ul>
          </div>
        </div>

        {/* 요청 상세 */}
        <div>
          <h3>요청 상세</h3>
          {currentRequest ? (
            <div className="admin-detail-card">
              <div className="form-group">
                <label>고객 코드</label>
                <input type="text" value={currentRequest.request.customerId} disabled />
              </div>

              <div className="form-group">
                <label>상태</label>
                <input
                  type="text"
                  value={
                    currentRequest.request.status === 'confirmed' ? '확정됨'
                      : currentRequest.request.status === 'cancellation_requested' ? '취소 요청'
                      : currentRequest.request.status === 'cancelled' ? '취소됨'
                      : currentRequest.request.status === 'needs_reselection'
                        ? '재선택필요'
                        : '접수됨'
                  }
                  disabled
                />
              </div>

              <div className="form-group">
                <label>고객 메모</label>
                <div className={`admin-note ${currentRequest.request.note ? '' : 'empty'}`}>{currentRequest.request.note || '남긴 메모가 없습니다.'}</div>
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
                        className={`admin-candidate ${selectedSlotForConfirm === c.slotId ? 'selected' : ''} ${!isAvailable ? 'closed' : ''}`}
                        onClick={() => {
                          if (isAvailable && currentRequest.request.status !== 'confirmed') {
                            setSelectedSlotForConfirm(c.slotId);
                          }
                        }}
                        style={{
                          cursor: isAvailable && currentRequest.request.status !== 'confirmed' ? 'pointer' : 'default',
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

              {['confirmed', 'cancellation_requested', 'cancelled'].includes(currentRequest.request.status) && currentRequest.request.confirmedSlotId && (
                <div className="alert alert-success">
                  <strong>확정 완료</strong>
                  <br />
                  {slots[currentRequest.request.confirmedSlotId]?.date}{' '}
                  {TIME_SLOTS.find(t => t.label === slots[currentRequest.request.confirmedSlotId!]?.timeLabel)?.displayLabel}
                  <br />
                  {new Date(currentRequest.request.confirmedAt!).toLocaleString()}
                </div>
              )}

              {['received', 'needs_reselection'].includes(currentRequest.request.status) && (
                <button
                  className="btn btn-success"
                  onClick={handleConfirm}
                  disabled={!selectedSlotForConfirm || loading}
                  style={{ marginTop: '10px', width: '100%' }}
                >
                  {loading ? '확정 중...' : '선택한 희망 시간으로 확정'}
                </button>
              )}
              {currentRequest.request.status === 'cancellation_requested' && (
                <div className="button-row cancellation-actions">
                  <button className="btn btn-danger" onClick={() => handleResolveCancellation(true)} disabled={loading}>취소 승인</button>
                  <button className="btn btn-secondary" onClick={() => handleResolveCancellation(false)} disabled={loading}>취소 거절</button>
                </div>
              )}
              {currentRequest.request.status !== 'cancelled' && <button
                className="btn btn-danger"
                onClick={handleDeleteRequest}
                disabled={loading}
                style={{ marginTop: '10px', width: '100%' }}
              >
                이 접수건 삭제
              </button>}
            </div>
          ) : (
            <div className="admin-empty-detail">
              목록에서 요청을 선택하세요
            </div>
          )}
        </div>
      </div>
      </>}

      {/* 슬롯 현황 */}
      {section === 'slots' && <section className="route-panel">
        <div className="section-heading"><div><span className="step-label">전체 42슬롯</span><h3>날짜별 예약 가능 여부</h3></div><button type="button" className="btn btn-secondary" onClick={handleRefreshRequests} disabled={loading}>{loading ? '확인 중...' : '새로고침'}</button></div>
        <SlotTable slots={slots} selectedSlots={[]} onToggle={() => {}} mode="view" />
      </section>}

      {/* 실행 기록 */}
      {section === 'logs' && <section className="route-panel">
        <div className="section-heading"><div><span className="step-label">최근 20건</span><h3>저장 작업 감사 기록</h3></div><button type="button" className="btn btn-secondary" onClick={handleRefreshRequests} disabled={loading}>{loading ? '확인 중...' : '새로고침'}</button></div>
        <div className="table-container">
          <table className="slots-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>행위</th>
                <th>고객</th>
                <th>슬롯</th>
                <th>결과</th>
                <th>오류 위치</th>
                <th>오류</th>
                <th>작업 ID</th>
              </tr>
            </thead>
            <tbody>
              {sortOperationLogsNewestFirst(logs)
                .slice(0, 20)
                .map(log => {
                  const relatedRequest = requests.find(item => item.request.id === log.requestId);
                  const slot = log.slotId ? slots[log.slotId] : undefined;
                  const slotLabel = slot
                    ? `${slot.date} ${TIME_SLOTS.find(item => item.label === slot.timeLabel)?.displayLabel || slot.timeLabel}`
                    : log.slotId || '-';
                  const errorStage = getOperationErrorStage(log);

                  return (
                  <tr key={log.id} style={{ fontSize: '12px' }}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{getOperationActionLabel(log.action)}</td>
                    <td title={log.requestId || undefined}>{relatedRequest?.request.customerId || '-'}</td>
                    <td>{slotLabel}</td>
                    <td>
                      <span style={{ color: log.status === 'success' ? '#28a745' : '#dc3545' }}>
                        {log.status === 'success' ? '성공' : '실패'}
                      </span>
                    </td>
                    <td>{errorStage}</td>
                    <td style={{ color: '#dc3545' }}>{log.error || '-'}</td>
                    <td title={log.operationId || log.id} style={{ fontFamily: 'monospace' }}>
                      {(log.operationId || log.id).slice(0, 12)}...
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
};
