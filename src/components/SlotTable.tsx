import React from 'react';
import type { Slot } from '../types';
import { TIME_SLOTS, getAllDates } from '../utils/constants';

interface SlotTableProps {
  slots: Record<string, Slot>;
  selectedSlots: string[];
  onToggle: (slotId: string) => void;
  maxSelect?: number;
  mode: 'view' | 'select';
  dateFilter?: 'all' | 'weekday' | 'weekend' | 'available';
}

export const SlotTable: React.FC<SlotTableProps> = ({
  slots,
  selectedSlots,
  onToggle,
  maxSelect = 3,
  mode = 'view',
  dateFilter = 'all',
}) => {
  const dates = getAllDates().filter(date => {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dateFilter === 'weekday') return weekday >= 1 && weekday <= 5;
    if (dateFilter === 'weekend') return weekday === 0 || weekday === 6;
    if (dateFilter === 'available') {
      return TIME_SLOTS.some(time => slots[`${date}:${time.label}`]?.status !== 'confirmed');
    }
    return true;
  });
  const formatDate = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Seoul',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };

  return (
    <div className="table-container">
      <table className="slots-table">
        <thead>
          <tr>
            <th className="date-column">날짜</th>
            {TIME_SLOTS.map(slot => (
              <th key={slot.label} style={{ width: '140px' }}>
                {slot.displayLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map(date => (
            <tr key={date}>
              <th scope="row" className="date-cell">
                <span>{formatDate(date)}</span>
                <small>{date}</small>
              </th>
              {TIME_SLOTS.map(timeSlot => {
                const slotId = `${date}:${timeSlot.label}`;
                const slot = slots[slotId];
                const isSelected = selectedSlots.includes(slotId);
                const isConfirmed = slot?.status === 'confirmed';

                return (
                  <td key={slotId} className={isSelected ? 'selected-cell' : ''}>
                    {mode === 'view' ? (
                      <span className={`slot-status ${slot?.status || 'available'}`}>
                        {slot?.status === 'confirmed' ? '마감' : '가능'}
                      </span>
                    ) : (
                      <label className={`slot-choice ${isSelected ? 'selected' : ''} ${isConfirmed ? 'closed' : ''}`}>
                        <input
                          type="checkbox"
                          className="slot-checkbox"
                          checked={isSelected}
                          onChange={() => onToggle(slotId)}
                          disabled={isConfirmed || (!isSelected && selectedSlots.length >= maxSelect)}
                          aria-label={`${formatDate(date)} ${timeSlot.displayLabel} ${isConfirmed ? '마감' : '선택'}`}
                        />
                        <span>
                          {isSelected ? `${selectedSlots.indexOf(slotId) + 1}순위` : isConfirmed ? '마감' : '선택'}
                        </span>
                      </label>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {dates.length === 0 && (
            <tr><td colSpan={TIME_SLOTS.length + 1} className="empty-table">조건에 맞는 날짜가 없습니다.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
