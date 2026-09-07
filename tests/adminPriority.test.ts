import { describe, expect, it } from 'vitest';
import type { Candidate, Request, Slot } from '../src/types';
import {
  countAdminRequestStatuses,
  filterAdminRequests,
  getFirstReceivedRequestId,
  sortAdminRequests,
} from '../src/utils/adminPriority';

const slots: Record<string, Slot> = {
  early: { id: 'early', date: '2026-09-09', timeLabel: 'am', status: 'available' },
  late: { id: 'late', date: '2026-09-10', timeLabel: 'am', status: 'available' },
};

const item = (id: string, status: Request['status'], slotId: string) => ({
  request: {
    id,
    customerId: id,
    version: 1,
    createdAt: '2026-09-07T00:00:00.000Z',
    status,
  },
  candidates: [{
    id: `candidate-${id}`,
    requestId: id,
    slotId,
    priority: 1,
    version: 1,
    queueSeq: 1,
  } satisfies Candidate],
  decision: {},
});

describe('sortAdminRequests', () => {
  it('접수됨, 재선택 필요, 확정됨 순으로 표시한다', () => {
    const sorted = sortAdminRequests([
      item('confirmed', 'confirmed', 'early'),
      item('reselect', 'needs_reselection', 'early'),
      item('received', 'received', 'late'),
    ], slots);

    expect(sorted.map(entry => entry.request.status)).toEqual([
      'received',
      'needs_reselection',
      'confirmed',
    ]);
  });

  it('상태가 같으면 가장 가까운 희망 슬롯을 먼저 표시한다', () => {
    const sorted = sortAdminRequests([
      item('late', 'received', 'late'),
      item('early', 'received', 'early'),
    ], slots);

    expect(sorted.map(entry => entry.request.id)).toEqual(['early', 'late']);
  });
});

describe('admin request status filter', () => {
  const items = [
    item('received', 'received', 'early'),
    item('reselect', 'needs_reselection', 'early'),
    item('confirmed', 'confirmed', 'late'),
  ];

  it('선택한 상태의 신청만 표시한다', () => {
    expect(filterAdminRequests(items, 'received').map(entry => entry.request.id))
      .toEqual(['received']);
    expect(filterAdminRequests(items, 'all')).toHaveLength(3);
  });

  it('상태별 건수를 계산한다', () => {
    expect(countAdminRequestStatuses(items)).toEqual({
      all: 3,
      received: 1,
      needs_reselection: 1,
      confirmed: 1,
    });
  });

  it('정렬된 목록에서 가장 먼저 처리할 접수건을 선택한다', () => {
    const sorted = sortAdminRequests([
      item('confirmed', 'confirmed', 'early'),
      item('late', 'received', 'late'),
      item('early', 'received', 'early'),
    ], slots);

    expect(getFirstReceivedRequestId(sorted)).toBe('early');
    expect(getFirstReceivedRequestId([item('confirmed', 'confirmed', 'early')])).toBeNull();
  });
});
