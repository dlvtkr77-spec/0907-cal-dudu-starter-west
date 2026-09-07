import { describe, expect, it } from 'vitest';
import { getCustomerStatusGuide } from '../src/utils/customerStatus';

describe('customer status guide', () => {
  it('접수 상태에서는 관리자 확인 대기와 추가 행동이 없음을 안내한다', () => {
    const guide = getCustomerStatusGuide('received');

    expect(guide.heading).toContain('기다리고');
    expect(guide.nextAction).toContain('추가로 할 일은 없습니다');
  });

  it('재선택 상태에서는 새로운 후보 제출을 안내한다', () => {
    const guide = getCustomerStatusGuide('needs_reselection');

    expect(guide.heading).toContain('선택');
    expect(guide.nextAction).toContain('재선택하기');
  });

  it('확정 상태에서는 확정 날짜와 시간 확인을 안내한다', () => {
    const guide = getCustomerStatusGuide('confirmed');

    expect(guide.heading).toContain('확정');
    expect(guide.nextAction).toContain('날짜와 시간');
  });
});
