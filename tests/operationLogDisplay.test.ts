import { describe, expect, it } from 'vitest';
import type { OperationLog } from '../src/types';
import {
  getOperationActionLabel,
  getOperationErrorStage,
  sortOperationLogsNewestFirst,
} from '../src/utils/operationLogDisplay';

const log = (status: OperationLog['status'], error?: string): OperationLog => ({
  id: 'operation-1',
  timestamp: '2026-09-07T00:00:00.000Z',
  action: 'confirm',
  requestId: 'request-1',
  status,
  error,
});

describe('operation log display', () => {
  it('성공 기록을 완료로 표시한다', () => {
    expect(getOperationErrorStage(log('success'))).toBe('완료');
  });

  it('입력과 권한 오류를 입력 검사로 분류한다', () => {
    expect(getOperationErrorStage(log('failed', 'Not admin'))).toBe('입력 검사');
    expect(getOperationErrorStage(log('failed', 'Invalid slot count'))).toBe('입력 검사');
  });

  it('변경된 신청과 슬롯 오류를 현재 상태 조회로 분류한다', () => {
    expect(getOperationErrorStage(log('failed', 'Slot already confirmed'))).toBe('현재 상태 조회');
  });

  it('그 밖의 DB 오류를 저장 처리로 분류한다', () => {
    expect(getOperationErrorStage(log('failed', 'duplicate key value'))).toBe('저장 처리');
  });

  it('행위를 한국어로 표시한다', () => {
    expect(getOperationActionLabel('confirm')).toBe('예약 확정');
  });

  it('가장 최근 실행 기록을 먼저 표시한다', () => {
    const older = log('success');
    const newer = { ...log('failed'), id: 'operation-2', timestamp: '2026-09-07T01:00:00.000Z' };

    expect(sortOperationLogsNewestFirst([older, newer]).map(item => item.id))
      .toEqual(['operation-2', 'operation-1']);
  });
});
