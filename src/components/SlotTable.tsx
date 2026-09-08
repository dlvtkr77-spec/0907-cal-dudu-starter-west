import React, { useEffect, useState } from 'react';
import type { Slot } from '../types';
import { TIME_SLOTS, getAllDates } from '../utils/constants';

interface SlotTableProps {
  slots: Record<string, Slot>;
  selectedSlots: string[];
  onToggle: (slotId: string) => void;
  maxSelect?: number;
  mode: 'view' | 'select';
}

export const SlotTable: React.FC<SlotTableProps> = ({
  slots,
  selectedSlots,
  onToggle,
  maxSelect = 3,
  mode = 'view',
}) => {
  const dates = getAllDates();
  const [activeDate, setActiveDate] = useState(dates[0] || '');

  useEffect(() => {
    if (!dates.includes(activeDate)) setActiveDate(dates[0] || '');
  }, [dates.join('|')]);
  const formatDate = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Seoul',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };

  const getDateParts = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    return {
      day,
      month: `${month}월`,
      weekday: new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(value),
      isWeekend: value.getUTCDay() === 0 || value.getUTCDay() === 6,
    };
  };

  if (mode === 'select') {
    const activeDateParts = activeDate ? getDateParts(activeDate) : null;

    return (
      <div className="date-time-picker">
        <section className="calendar-panel" aria-label="날짜 선택">
          <div className="calendar-month"><strong>2026년 9월</strong><span>한국 시간</span></div>
          <div className="calendar-weekdays" aria-hidden="true">
            {['일', '월', '화', '수', '목', '금', '토'].map(day => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: 3 }).map((_, index) => <span key={`blank-${index}`} />)}
            {dates.map(date => {
              const parts = getDateParts(date);
              const availableCount = TIME_SLOTS.filter(time => slots[`${date}:${time.label}`]?.status !== 'confirmed').length;
              const selectedCount = selectedSlots.filter(slotId => slotId.startsWith(`${date}:`)).length;
              return (
                <button
                  key={date}
                  type="button"
                  className={`${activeDate === date ? 'active' : ''} ${parts.isWeekend ? 'weekend' : ''}`}
                  onClick={() => setActiveDate(date)}
                  disabled={availableCount === 0}
                  aria-pressed={activeDate === date}
                  aria-label={`${formatDate(date)}, ${availableCount}개 시간 가능${selectedCount ? `, ${selectedCount}개 선택됨` : ''}`}
                >
                  <span>{parts.day}</span>
                  {selectedCount > 0 && <small>{selectedCount}</small>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="time-panel" aria-label="시간 선택">
          {activeDateParts ? (
            <>
              <div className="selected-date-heading">
                <strong>9월 {activeDateParts.day}일 {activeDateParts.weekday}요일</strong>
                <span>희망 시간을 선택하세요</span>
              </div>
              <div className="time-options">
                {TIME_SLOTS.map(timeSlot => {
                  const slotId = `${activeDate}:${timeSlot.label}`;
                  const slot = slots[slotId];
                  const isSelected = selectedSlots.includes(slotId);
                  const isConfirmed = slot?.status === 'confirmed';
                  return (
                    <button
                      key={slotId}
                      type="button"
                      className={`${isSelected ? 'selected' : ''} ${isConfirmed ? 'closed' : ''}`}
                      onClick={() => onToggle(slotId)}
                      disabled={isConfirmed || (!isSelected && selectedSlots.length >= maxSelect)}
                      aria-pressed={isSelected}
                    >
                      <span>{timeSlot.displayLabel}</span>
                      <small>{isSelected ? `${selectedSlots.indexOf(slotId) + 1}순위` : isConfirmed ? '마감' : '선택 가능'}</small>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="empty-table">조건에 맞는 날짜가 없습니다.</div>
          )}
        </section>
      </div>
    );
  }

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
          {dates.map((date, dateIndex) => {
            const dateParts = getDateParts(date);
            return (
            <tr key={date} className={`${dateParts.isWeekend ? 'weekend-row' : ''} ${dateIndex > 0 && dateIndex % 7 === 0 ? 'new-week' : ''}`}>
              <th scope="row" className="date-cell" title={formatDate(date)}>
                <span className="calendar-date"><strong>{dateParts.day}</strong><span>{dateParts.weekday}</span></span>
                <small>{dateParts.month}</small>
              </th>
              {TIME_SLOTS.map(timeSlot => {
                const slotId = `${date}:${timeSlot.label}`;
                const slot = slots[slotId];
                const isSelected = selectedSlots.includes(slotId);
                return (
                  <td key={slotId} className={isSelected ? 'selected-cell' : ''}>
                    {mode === 'view' ? (
                      <span className={`slot-status ${slot?.status || 'available'}`}>
                        {slot?.status === 'confirmed' ? '마감' : '가능'}
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          );})}
          {dates.length === 0 && (
            <tr><td colSpan={TIME_SLOTS.length + 1} className="empty-table">조건에 맞는 날짜가 없습니다.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
