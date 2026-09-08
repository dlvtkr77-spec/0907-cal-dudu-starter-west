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

export const CustomerPage: React.FC<CustomerPageProps> = ({ db, mode, userId, loginId }) => {
  const [customerId, setCustomerId] = useState<string>('C01');
  const [stage, setStage] = useState<'select' | 'confirm' | 'view' | 'reselect'>('select');
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [customerRequests, setCustomerRequests] = useState<
    Array<{ request: Request; candidates: Candidate[]; decision: any }>
  >([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<'all' | 'weekday' | 'weekend' | 'available'>('all');

  const om = new OperationManager(db);

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
      setStage('select');
      setSelectedSlots([]);
    } else {
      const latest = status[status.length - 1];
      if (latest.request.status === 'needs_reselection') {
        setStage('reselect');
      } else if (latest.request.status === 'confirmed') {
        setStage('view');
      } else {
        setStage('view');
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
          setStage('select');
          return;
        }
      } else {
        const currentSlots = db.getState().slots;
        const closedSelected = selectedSlots.filter(slotId => currentSlots[slotId]?.status === 'confirmed');
        if (closedSelected.length > 0) {
          setError(`선택한 시간이 방금 마감되었습니다: ${closedSelected.map(formatSlot).join(', ')}. 다시 선택하세요.`);
          setStage('select');
          return;
        }
      }

      const operationCustomerId = mode === 'supabase' ? (loginId || userId) : customerId;
      const operationId = `submit-${operationCustomerId}-${Date.now()}`;

      if (mode === 'supabase' && userId) {
        const result = await supabaseRPC.submitRequest(userId, selectedSlots, operationId);
        if (result.success) {
          setSuccess('신청이 완료되었습니다!');
          setSelectedSlots([]);
          setStage('view');
          setTimeout(() => loadSupabaseData(), 500);
        } else {
          setError(result.error || '신청 실패');
        }
      } else {
        const result = await om.submitRequest(customerId, selectedSlots, operationId);
        if (result.success) {
          setSuccess('신청이 완료되었습니다!');
          setSelectedSlots([]);
          setStage('view');
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
        setStage('select');
      } else {
        const latest = customerRequestsView[customerRequestsView.length - 1];
        setStage(latest.request.status === 'needs_reselection' ? 'reselect' : 'view');
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
          setStage('view');
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
          setStage('view');
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
    setStage(customerRequests.length === 0 ? 'select' : 'view');
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

  // 슬롯 상태가 변경되었는지 확인
  const checkSlotAvailability = () => {
    if (stage === 'confirm' && customerRequests.length > 0) {
      const latest = customerRequests[customerRequests.length - 1];
      const currentState = db.getState();
      const decision = decideRequestStatus(latest.request, currentState.candidates, currentState.slots);

      if (decision.status !== 'ok') {
        setError('선택한 슬롯의 상태가 변경되었습니다. 다시 선택해주세요.');
        setStage('reselect');
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
        <div><span className="eyebrow">예약 신청</span><h2>상담 희망 시간을 선택하세요</h2><p>최대 3개까지, 선택한 순서대로 우선순위가 정해집니다.</p></div>
      </div>
      <ol className="booking-steps" aria-label="예약 진행 단계">
        {['시간 선택', '신청 확인', '처리 상태'].map((label, index) => (
          <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} aria-current={step === index + 1 ? 'step' : undefined}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
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
            <button className="btn btn-primary btn-block" onClick={() => setStage('confirm')} disabled={selectedSlots.length === 0 || loading}>다음: 신청 내용 확인</button>
          </aside>
          <section className="booking-picker" aria-labelledby="slot-picker-title">
            <div className="section-heading"><div><span className="step-label">1단계</span><h3 id="slot-picker-title">날짜와 시간 선택</h3></div><strong>{selectedSlots.length}/3 선택</strong></div>
            <p className="helper-text">가능한 칸을 누르세요. 같은 시간에 여러 고객이 희망을 제출할 수 있습니다.</p>
            <div className="date-filters" aria-label="날짜 빠른 필터">
              {([
                ['all', '전체'], ['weekday', '평일'], ['weekend', '주말'], ['available', '가능한 날짜만'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" className={dateFilter === value ? 'active' : ''} aria-pressed={dateFilter === value} onClick={() => setDateFilter(value)}>{label}</button>
              ))}
            </div>
            <SlotTable
            slots={slots}
            selectedSlots={selectedSlots}
            onToggle={handleSlotToggle}
            mode="select"
            maxSelect={3}
            dateFilter={dateFilter}
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

      {customerRequests.length > 0 && (
        <div>
          <h3>{stage === 'view' ? '내 신청 현황' : '내 신청 목록'}</h3>
          {stage === 'view' && (() => {
            const latestRequest = customerRequests[customerRequests.length - 1].request;
            const guide = getCustomerStatusGuide(latestRequest.status);

            return (
              <section className={`status-guide status-${latestRequest.status}`} aria-live="polite">
                <span className="status-kicker">{latestRequest.status === 'received' ? '예약 확인중' : latestRequest.status === 'confirmed' ? '예약 확정' : '조치 필요'}</span>
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
                <div style={{ padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
                  {item.request.status === 'confirmed' && (
                    <span className="slot-status confirmed">확정됨</span>
                  )}
                  {item.request.status === 'received' && (
                    <span className="slot-status pending">예약 확인중</span>
                  )}
                  {item.request.status === 'needs_reselection' && (
                    <span className="alert alert-warning">재선택 필요</span>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>선택한 슬롯 (우선순위 순)</label>
                <ul className="list">
                  {item.candidates.map((c, cidx) => {
                    const slot = slots[c.slotId];
                    const isAvailable = slot?.status === 'available';
                    return (
                      <li key={c.id}>
                        <span>
                          {cidx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                          {' '}
                          <span style={{ marginLeft: '10px', fontSize: '12px', color: isAvailable ? '#28a745' : '#dc3545' }}>
                            {isAvailable ? '(가능)' : '(마감)'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {item.request.status === 'confirmed' && (
                <div className="alert alert-success">
                  <strong>확정됨!</strong> {slots[item.request.confirmedSlotId!]?.date}{' '}
                  {TIME_SLOTS.find(t => t.label === slots[item.request.confirmedSlotId!]?.timeLabel)?.displayLabel}에
                  확정되었습니다.
                </div>
              )}

              {stage === 'view' && item.request.status === 'needs_reselection' && idx === customerRequests.length - 1 && (
                <button
                  className="btn btn-warning"
                  onClick={() => {
                    setStage('reselect');
                    setSelectedSlots([]);
                  }}
                  style={{ background: '#ffc107', marginTop: '10px' }}
                >
                  재선택하기
                </button>
              )}
            </article>
          ))}

          {stage === 'view' && customerRequests[customerRequests.length - 1].request.status === 'confirmed' && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setStage('select');
                setSelectedSlots([]);
              }}
              style={{ marginTop: '20px' }}
            >
              새로 신청하기
            </button>
          )}
        </div>
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
                setStage('view');
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
