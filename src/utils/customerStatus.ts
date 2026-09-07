import type { Request } from '../types';

export interface CustomerStatusGuide {
  heading: string;
  description: string;
  nextAction: string;
}

export function getCustomerStatusGuide(status: Request['status']): CustomerStatusGuide {
  if (status === 'confirmed') {
    return {
      heading: '예약이 확정되었습니다',
      description: '관리자가 희망 후보 중 하나를 확정했습니다.',
      nextAction: '아래 확정 날짜와 시간을 확인해주세요.',
    };
  }

  if (status === 'needs_reselection') {
    return {
      heading: '새로운 희망 시간 선택이 필요합니다',
      description: '기존에 신청한 후보를 더 이상 확정할 수 없습니다.',
      nextAction: '재선택하기 버튼을 눌러 새로운 후보를 제출해주세요.',
    };
  }

  return {
    heading: '관리자 확인을 기다리고 있습니다',
    description: '신청은 정상 접수되었으며 아직 예약이 확정된 상태는 아닙니다.',
    nextAction: '지금 추가로 할 일은 없습니다. 관리자가 희망 후보 중 하나를 확정합니다.',
  };
}
