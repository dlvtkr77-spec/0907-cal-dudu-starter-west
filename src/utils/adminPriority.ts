import type { Candidate, Request, Slot } from '../types';
import { TIME_SLOTS } from './constants';

export interface AdminRequestItem {
  request: Request;
  candidates: Candidate[];
  decision: any;
}

export type AdminStatusFilter = 'all' | Request['status'];

export const filterAdminRequests = (
  items: AdminRequestItem[],
  status: AdminStatusFilter
) => status === 'all' ? items : items.filter(item => item.request.status === status);

export const countAdminRequestStatuses = (items: AdminRequestItem[]) => ({
  all: items.length,
  received: items.filter(item => item.request.status === 'received').length,
  needs_reselection: items.filter(item => item.request.status === 'needs_reselection').length,
  confirmed: items.filter(item => item.request.status === 'confirmed').length,
  cancellation_requested: items.filter(item => item.request.status === 'cancellation_requested').length,
  cancelled: items.filter(item => item.request.status === 'cancelled').length,
});

export const getFirstReceivedRequestId = (items: AdminRequestItem[]) =>
  items.find(item => item.request.status === 'received')?.request.id ?? null;

const STATUS_PRIORITY: Record<Request['status'], number> = {
  cancellation_requested: 0,
  received: 1,
  needs_reselection: 2,
  confirmed: 3,
  cancelled: 4,
};

export const getEarliestCandidateTime = (
  candidates: Candidate[],
  slots: Record<string, Slot>
) => {
  const times = candidates.flatMap(candidate => {
    const slot = slots[candidate.slotId];
    const hour = TIME_SLOTS.find(item => item.label === slot?.timeLabel)?.hour;
    if (!slot || hour === undefined) return [];
    return [new Date(`${slot.date}T${String(hour).padStart(2, '0')}:00:00+09:00`).getTime()];
  });

  return times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY;
};

export const sortAdminRequests = (
  items: AdminRequestItem[],
  slots: Record<string, Slot>
) => [...items].sort((a, b) => {
  const statusDifference = STATUS_PRIORITY[a.request.status] - STATUS_PRIORITY[b.request.status];
  if (statusDifference !== 0) return statusDifference;

  const candidateDifference =
    getEarliestCandidateTime(a.candidates, slots) -
    getEarliestCandidateTime(b.candidates, slots);
  if (candidateDifference !== 0) return candidateDifference;

  return new Date(a.request.createdAt).getTime() - new Date(b.request.createdAt).getTime();
});
