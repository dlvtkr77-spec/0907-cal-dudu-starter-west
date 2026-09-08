import React, { useState, useEffect } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate } from '../types';
import { OperationManager } from '../utils/operations';
import { DatabaseManager } from '../utils/database';
import { decideRequestStatus } from '../utils/decide';
import { TIME_SLOTS } from '../utils/constants';
import { supabaseRPC } from '../utils/supabaseRPC';
import { getCustomerStatusGuide } from '../utils/customerStatus';

interface CustomerPageProps {
  db: DatabaseManager;
  mode: 'local' | 'supabase';
  userId?: string;
  loginId?: string;
}

type CustomerStage = 'select' | 'confirm' | 'view' | 'reselect';

const getCustomerStageFromPath = (): CustomerStage => {
  if (window.location.pathname === '/customer/confirm') return 'confirm';
  if (window.location.pathname === '/customer/requests') return 'view';
  return 'select';
};

export const CustomerPage: React.FC<CustomerPageProps> = ({ db, mode, userId, loginId }) => {
  const [customerId, setCustomerId] = useState<string>('C01');
  const [stage, setStage] = useState<CustomerStage>(getCustomerStageFromPath);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [customerRequests, setCustomerRequests] = useState<
    Array<{ request: Request; candidates: Candidate[]; decision: any }>
  >([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');

  const om = new OperationManager(db);

  const navigateToStage = (nextStage: CustomerStage, replace = false) => {
    const path = nextStage === 'confirm'
      ? '/customer/confirm'
      : nextStage === 'view'
        ? '/customer/requests'
        : '/customer/book';
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setStage(nextStage);
    setError('');
  };

  useEffect(() => {
    const handlePopState = () => setStage(getCustomerStageFromPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 초기 로드
  useEffect(() => {
    if (mode === 'supabase' && userId) {
      loadSupabaseData();
    } else {
      loadData();
    }
  }, [customerId, mode, userId]);

  const loadData = () => {
    const state = db.getState();
    setSlots(state.slots);
    const status = om.getCustomerStatus(customerId);
    setCustomerRequests(status);
    setError('');
    setSuccess('');

    // 첫 로드인지 확인
    if (status.length === 0) {
      navigateToStage('select', true);
      setSelectedSlots([]);
    } else {
      const latest = status[status.length - 1];
      if (latest.request.status === 'needs_reselection') {
        navigateToStage('reselect', true);
      } else if (latest.request.status === 'confirmed') {
        navigateToStage('view', true);
      } else {
        navigateToStage('view', true);
      }
    }
  };

  const handleSlotToggle = (slotId: string) => {
    if (!selectedSlots.includes(slotId) && selectedSlots.length >= 3) {
      setError('희망 시간은 최대 3개까지 선택할 수 있습니다. 기존 선택을 제거한 뒤 다시 선택하세요.');
      return;
    }
    setSelectedSlots(prev => {
      if (prev.includes(slotId)) {
        return prev.filter(s => s !== slotId);
      } else if (prev.length < 3) {
        return [...prev, slotId];
      }
      return prev;
    });
    setError('');
  };

  const handleSubmit = async () => {
    if (selectedSlots.length === 0) {
      setError('최소 1개 이상의 슬롯을 선택하세요');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'supabase') {
        const latestSlots = await supabaseRPC.getSlots();
        if (!latestSlots.success) {
          setError(`선택 시간 확인 실패: ${latestSlots.error}`);
          return;
        }
        const closedIds = new Set(
          latestSlots.slots.filter((slot: any) => slot.status === 'confirmed').map((slot: any) => slot.id)
        );
        const closedSelected = selectedSlots.filter(slotId => closedIds.has(slotId));
        if (closedSelected.length > 0) {
          setError(`선택한 시간이 방금 마감되었습니다: ${closedSelected.map(formatSlot).join(', ')}. 다시 선택하세요.`);
          navigateToStage('select');
          return;
        }
      } else {
        const currentSlots = db.getState().slots;
        const closedSelected = selectedSlots.filter(slotId => currentSlots[slotId]?.status === 'confirmed');
        if (closedSelected.length > 0) {
          setError(`선택한 시간이 방금 마감되었습니다: ${closedSelected.map(formatSlot).join(', ')}. 다시 선택하세요.`);
          navigateToStage('select');
          return;
        }
      }

      const operationCustomerId = mode === 'supabase' ? (loginId || userId) : customerId;
      const operationId = `submit-${operationCustomerId}-${Date.now()}`;

      if (mode === 'supabase' && userId) {
        const result = await supabaseRPC.submitRequest(userId, selectedSlots, operationId, note);
        if (result.success) {
          setSuccess('신청이 완료되었습니다!');
          setSelectedSlots([]);
          setNote('');
          navigateToStage('view');
          setTimeout(() => loadSupabaseData(), 500);
        } else {
          setError(result.error || '신청 실패');
        }
      } else {
        const result = await om.submitRequest(customerId, selectedSlots, operationId, note);
        if (result.success) {
          setSuccess('신청이 완료되었습니다!');
          setSelectedSlots([]);
          setNote('');
          navigateToStage('view');
          setTimeout(() => loadData(), 500);
        } else {
          setError(result.error || '신청 실패');
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSupabaseData = async () => {
    try {
      setError('');
      const result = await supabaseRPC.getCustomerRequests(userId!);
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

      const customerRequestsView = requests.map((req: Request) => {
        const reqCandidates = candidates.filter((c: Candidate) => c.requestId === req.id);
        return {
          request: req,
          candidates: reqCandidates.sort((a, b) => a.priority - b.priority),
          decision: decideRequestStatus(req, reqCandidates, slotsMap),
        };
      });

      setCustomerRequests(customerRequestsView);
      if (customerRequestsView.length === 0) {
        navigateToStage('select', true);
      } else {
        const latest = customerRequestsView[customerRequestsView.length - 1];
        navigateToStage(latest.request.status === 'needs_reselection' ? 'reselect' : 'view', true);
      }
    } catch (err) {
      setError(`오류: ${String(err)}`);
    }
  };

  const handleReselect = async () => {
    if (selectedSlots.length === 0) {
      setError('최소 1개 이상의 슬롯을 선택하세요');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const latest = customerRequests[customerRequests.length - 1];
      const operationId = `reselect-${latest.request.id}-${Date.now()}`;

      if (mode === 'supabase' && userId) {
        const result = await supabaseRPC.resubmitRequest(
          userId,
          latest.request.id,
          selectedSlots,
          operationId
        );

        if (result.success) {
          setSuccess('재선택이 완료되었습니다!');
          setSelectedSlots([]);
          navigateToStage('view');
          setTimeout(() => loadSupabaseData(), 500);
        } else {
          setError(result.error || '재선택 실패');
        }
      } else {
        const result = await om.resubmitRequest(
          customerId,
          latest.request.id,
          selectedSlots,
          operationId
        );

        if (result.success) {
          setSuccess('재선택이 완료되었습니다!');
          setSelectedSlots([]);
          navigateToStage('view');
          setTimeout(() => loadData(), 500);
        } else {
          setError(result.error || '재선택 실패');
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    navigateToStage(customerRequests.length === 0 ? 'select' : 'view');
    setError('');
  };

  const refreshCustomerData = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'supabase' && userId) {
        await loadSupabaseData();
      } else {
        loadData();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRequestCancellation = async (requestId: string) => {
    if (!window.confirm('확정 예약의 취소를 요청하시겠습니까? 관리자가 승인하기 전까지 예약은 유지됩니다.')) return;
    setLoading(true); setError(''); setSuccess('');
    const operationId = `cancel-request-${requestId}`;
    try {
      const result = mode === 'supabase'
        ? await supabaseRPC.requestCancellation(requestId, operationId)
        : await om.requestCancellation(customerId, requestId, operationId);
      if (!result.success) { setError(result.error || '취소 요청 실패'); return; }
      if (mode === 'supabase') await loadSupabaseData(); else loadData();
      setSuccess('취소 요청이 접수되었습니다. 관리자 승인을 기다려주세요.');
    } finally { setLoading(false); }
  };

  // 슬롯 상태가 변경되었는지 확인
  const checkSlotAvailability = () => {
    if (stage === 'confirm' && customerRequests.length > 0) {
      const latest = customerRequests[customerRequests.length - 1];
      const currentState = db.getState();
      const decision = decideRequestStatus(latest.request, currentState.candidates, currentState.slots);

      if (decision.status !== 'ok') {
        setError('선택한 슬롯의 상태가 변경되었습니다. 다시 선택해주세요.');
        navigateToStage('reselect');
        setSelectedSlots([]);
        return false;
      }
    }
    return true;
  };

  const formatSlot = (slotId: string) => {
    const slot = slots[slotId];
    if (!slot) return slotId;
    const time = TIME_SLOTS.find(item => item.label === slot.timeLabel)?.displayLabel || slot.timeLabel;
    return `${slot.date} · ${time}`;
  };

  const renderSelection = (removable = false) => (
    <ol className="selection-list">
      {selectedSlots.map((slotId, idx) => (
        <li key={slotId}>
          <span className="priority-number">{idx + 1}</span>
          <span><strong>{formatSlot(slotId)}</strong><small>{idx === 0 ? '가장 선호하는 시간' : `${idx + 1}순위 희망`}</small></span>
          {removable && (
            <span className="selection-actions">
              <button type="button" className="text-button" disabled={idx === 0} onClick={() => moveSelection(idx, -1)}>위로</button>
              <button type="button" className="text-button" disabled={idx === selectedSlots.length - 1} onClick={() => moveSelection(idx, 1)}>아래로</button>
              <button type="button" className="text-button" onClick={() => handleSlotToggle(slotId)}>제거</button>
            </span>
          )}
        </li>
      ))}
      {selectedSlots.length === 0 && <li className="empty-selection">날짜와 시간을 선택하면 여기에 순서대로 표시됩니다.</li>}
    </ol>
  );

  const moveSelection = (index: number, direction: -1 | 1) => {
    setSelectedSlots(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  };

  const step = stage === 'select' || stage === 'reselect' ? 1 : stage === 'confirm' ? 2 : 3;

  return (
    <div className="customer-page page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">{stage === 'view' ? '내 예약' : '예약 신청'}</span><h2>{stage === 'view' ? '신청 현황을 확인하세요' : stage === 'confirm' ? '신청 내용을 확인하세요' : stage === 'reselect' ? '새로운 희망 시간을 선택하세요' : '상담 희망 시간을 선택하세요'}</h2><p>{stage === 'view' ? '최신 처리 상태와 이전 희망 시간 이력을 확인할 수 있습니다.' : '최대 3개까지, 선택한 순서대로 우선순위가 정해집니다.'}</p></div>
      </div>
      <ol className="booking-steps" aria-label="예약 진행 단계">
        {['시간 선택', '신청 확인', '처리 상태'].map((label, index) => (
          <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} aria-current={step === index + 1 ? 'step' : undefined}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
      <nav className="section-nav" aria-label="고객 메뉴">
        <button type="button" className={stage !== 'view' ? 'active' : ''} onClick={() => {
          const latest = customerRequests[customerRequests.length - 1]?.request;
          if (latest?.status === 'received') {
            navigateToStage('view');
            setError('현재 신청이 예약 확인중입니다. 확정 또는 재선택 안내를 기다려주세요.');
            return;
          }
          navigateToStage(latest?.status === 'needs_reselection' ? 'reselect' : 'select');
        }}>예약하기</button>
        <button type="button" className={stage === 'view' ? 'active' : ''} onClick={() => navigateToStage('view')}>내 신청</button>
      </nav>
      <div className="form-group identity-field">
        <label htmlFor="customer-id">고객 아이디</label>
        {mode === 'supabase' ? (
          <input id="customer-id" type="text" value={loginId || ''} readOnly />
        ) : (
          <input
            id="customer-id"
            type="text"
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            placeholder="C01"
            disabled={stage === 'confirm'}
          />
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {stage === 'select' && (
        <div className="booking-layout">
          <aside className="booking-summary">
            <span className="eyebrow">선택 요약</span>
            <h3>{selectedSlots.length > 0 ? `${selectedSlots.length}개 시간 선택` : '희망 시간'}</h3>
            <p>접수 후 관리자가 가능한 후보 하나를 확정합니다.</p>
            {renderSelection(true)}
            <button className="btn btn-primary btn-block" onClick={() => navigateToStage('confirm')} disabled={selectedSlots.length === 0 || loading}>다음: 신청 내용 확인</button>
          </aside>
          <section className="booking-picker" aria-labelledby="slot-picker-title">
            <div className="section-heading"><div><span className="step-label">1단계</span><h3 id="slot-picker-title">날짜와 시간 선택</h3></div><strong>{selectedSlots.length}/3 선택</strong></div>
            <p className="helper-text">가능한 칸을 누르세요. 같은 시간에 여러 고객이 희망을 제출할 수 있습니다.</p>
            <SlotTable
            slots={slots}
            selectedSlots={selectedSlots}
            onToggle={handleSlotToggle}
            mode="select"
            maxSelect={3}
            />
          </section>
        </div>
      )}

      {stage === 'confirm' && checkSlotAvailability() && (
        <section className="confirm-card">
          <span className="step-label">2단계</span><h3>신청 내용을 확인하세요</h3>
          <p className="helper-text">제출 즉시 확정되지 않습니다. 관리자가 확인할 때까지 ‘예약 확인중’ 상태입니다.</p>
          <div className="availability-note"><strong>마지막 확인</strong><span>신청 버튼을 누르면 선택한 시간이 아직 가능한지 다시 확인합니다.</span></div>
          {renderSelection()}
          <div className="form-group booking-note">
            <label htmlFor="booking-note">관리자에게 남길 메모 <span>선택</span></label>
            <textarea id="booking-note" value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={4} placeholder="예약 시 참고할 내용을 입력하세요." />
            <small>{note.length}/500</small>
          </div>
          <div className="button-row">
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? '접수 중...' : '이대로 예약 신청'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={loading}
            >
              돌아가기
            </button>
          </div>
        </section>
      )}

      {stage === 'view' && customerRequests.length > 0 && (
        <div>
          <h3>{stage === 'view' ? '내 신청 현황' : '내 신청 목록'}</h3>
          {stage === 'view' && (() => {
            const latestRequest = customerRequests[customerRequests.length - 1].request;
            const guide = getCustomerStatusGuide(latestRequest.status);

            return (
              <section className={`status-guide status-${latestRequest.status}`} aria-live="polite">
                <span className="status-kicker">{latestRequest.status === 'received' ? '예약 확인중' : latestRequest.status === 'confirmed' ? '예약 확정' : latestRequest.status === 'cancellation_requested' ? '취소 확인중' : latestRequest.status === 'cancelled' ? '취소 완료' : '조치 필요'}</span>
                <h4>{guide.heading}</h4>
                <p>{guide.description}</p>
                <p><strong>지금 할 일:</strong> {guide.nextAction}</p>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={refreshCustomerData}
                  disabled={loading}
                >
                  {loading ? '확인 중...' : '현재 상태 다시 확인'}
                </button>
              </section>
            );
          })()}
          {customerRequests.map((item, idx) => (
            <article key={item.request.id} className="request-card">
              <h4>신청 #{item.request.version} (접수일: {new Date(item.request.createdAt).toLocaleString()})</h4>

              <div className="form-group">
                <label>상태</label>
                <div className="customer-status-surface">
                  {item.request.status === 'confirmed' && (
                    <span className="slot-status confirmed">확정됨</span>
                  )}
                  {item.request.status === 'received' && (
                    <span className="slot-status pending">예약 확인중</span>
                  )}
                  {item.request.status === 'needs_reselection' && (
                    <span className="alert alert-warning">재선택 필요</span>
                  )}
                  {item.request.status === 'cancellation_requested' && <span className="slot-status pending">취소 확인중</span>}
                  {item.request.status === 'cancelled' && <span className="slot-status confirmed">취소됨</span>}
                </div>
              </div>

              <div className="form-group">
                <label>선택한 슬롯 (우선순위 순)</label>
                <ul className="list">
                  {item.candidates.map((c, cidx) => {
                    const slot = slots[c.slotId];
                    const isAvailable = slot?.status === 'available';
                    const isConfirmedChoice = c.slotId === item.request.confirmedSlotId
                      && ['confirmed', 'cancellation_requested'].includes(item.request.status);
                    const isCancelledChoice = c.slotId === item.request.confirmedSlotId
                      && item.request.status === 'cancelled';
                    return (
                      <li key={c.id} className={`customer-candidate ${isConfirmedChoice ? 'confirmed-choice' : isCancelledChoice ? 'cancelled-choice' : isAvailable ? 'available' : 'closed'}`}>
                        <span>
                          {cidx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                          {' '}
                          <span className="candidate-state">
                            {isConfirmedChoice ? '(확정 시간)' : isCancelledChoice ? '(취소된 시간)' : isAvailable ? '(가능)' : '(마감)'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {['confirmed', 'cancellation_requested', 'cancelled'].includes(item.request.status) && (
                <div className="alert alert-success">
                  <strong>{item.request.status === 'cancelled' ? '취소된 예약' : item.request.status === 'cancellation_requested' ? '취소 승인 전 예약' : '확정됨!'}</strong>{' '}{slots[item.request.confirmedSlotId!]?.date}{' '}
                  {TIME_SLOTS.find(t => t.label === slots[item.request.confirmedSlotId!]?.timeLabel)?.displayLabel}에
                  확정되었습니다.
                </div>
              )}

              {stage === 'view' && item.request.status === 'confirmed' && (
                <button type="button" className="btn btn-danger" disabled={loading} onClick={() => handleRequestCancellation(item.request.id)}>예약 취소 요청</button>
              )}

              {stage === 'view' && item.request.status === 'needs_reselection' && idx === customerRequests.length - 1 && (
                <button
                  className="btn btn-warning"
                  onClick={() => {
                    navigateToStage('reselect');
                    setSelectedSlots([]);
                  }}
                  style={{ background: '#ffc107', marginTop: '10px' }}
                >
                  재선택하기
                </button>
              )}
            </article>
          ))}

          {stage === 'view' && ['confirmed', 'cancelled'].includes(customerRequests[customerRequests.length - 1].request.status) && (
            <button
              className="btn btn-primary"
              onClick={() => {
                navigateToStage('select');
                setSelectedSlots([]);
              }}
              style={{ marginTop: '20px' }}
            >
              새로 신청하기
            </button>
          )}
        </div>
      )}

      {stage === 'view' && customerRequests.length === 0 && (
        <section className="route-panel empty-state">
          <span className="eyebrow">신청 내역 없음</span>
          <h3>아직 접수한 예약이 없습니다</h3>
          <p className="helper-text">예약하기 메뉴에서 희망 시간을 먼저 선택해주세요.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigateToStage('select')}>예약하러 가기</button>
        </section>
      )}

      {stage === 'reselect' && customerRequests.length > 0 && (
        <div>
          <h3>슬롯 재선택</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            이전 신청의 슬롯이 모두 마감되었습니다. 다시 선택해주세요.
          </p>
          <SlotTable
            slots={slots}
            selectedSlots={selectedSlots}
            onToggle={handleSlotToggle}
            mode="select"
            maxSelect={3}
          />

          <div style={{ marginBottom: '20px' }}>
            <h4>새로 선택한 슬롯 ({selectedSlots.length}/3)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      {idx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                    </span>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleSlotToggle(slotId)}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      제거
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={handleReselect}
              disabled={selectedSlots.length === 0 || loading}
            >
              {loading ? '처리 중...' : '재선택 제출'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                navigateToStage('view');
                setSelectedSlots([]);
              }}
              disabled={loading}
            >
              돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
