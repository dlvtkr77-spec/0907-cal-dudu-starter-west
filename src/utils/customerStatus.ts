import type { Request } from '../types';

export interface CustomerStatusGuide {
  heading: string;
  description: string;
  nextAction: string;
}

export function getCustomerStatusGuide(status: Request['status']): CustomerStatusGuide {
  if (status === 'cancellation_requested') {
    return { heading: '취소 요청을 확인하고 있습니다', description: '관리자가 취소 요청을 검토 중이며 아직 예약은 확정 상태입니다.', nextAction: '승인 또는 거절 결과를 기다려주세요.' };
  }
  if (status === 'cancelled') {
    return { heading: '예약이 취소되었습니다', description: '취소가 승인되어 해당 시간이 다시 열렸습니다.', nextAction: '필요하면 새로운 예약을 신청할 수 있습니다.' };
  }
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
