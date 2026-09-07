import type { OperationLog } from '../types';

export type OperationErrorStage = '완료' | '입력 검사' | '현재 상태 조회' | '저장 처리';

const CURRENT_STATE_ERRORS = [
  'already confirmed',
  'slot confirmed',
  'request not found',
  'slot not found',
  'not in current candidates',
];

const INPUT_ERRORS = [
  'invalid',
  'not admin',
  'not authorized',
  'not authenticated',
  'pending request',
];

export const getOperationErrorStage = (log: OperationLog): OperationErrorStage => {
  if (log.errorStage === 'completed') return '완료';
  if (log.errorStage === 'input_validation') return '입력 검사';
  if (log.errorStage === 'current_state') return '현재 상태 조회';
  if (log.errorStage === 'save') return '저장 처리';
  if (log.status === 'success') return '완료';

  const error = (log.error || '').toLowerCase();
  if (CURRENT_STATE_ERRORS.some(message => error.includes(message))) return '현재 상태 조회';
  if (INPUT_ERRORS.some(message => error.includes(message))) return '입력 검사';
  return '저장 처리';
};

export const getOperationActionLabel = (action: OperationLog['action']) => ({
  submit: '신청 접수',
  confirm: '예약 확정',
  reselect: '후보 재선택',
}[action]);

export const sortOperationLogsNewestFirst = (logs: OperationLog[]) =>
  [...logs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
