'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';

interface TimeSlot {
  start: string; // "HH:mm"
  end: string;
}

type WeekdayTimeSlots = Record<string, TimeSlot[]>;
type DateOverrides = Record<string, TimeSlot[]>;

interface BusyEvent {
  start: string;
  end: string;
  userId: string;
  summary?: string;
}

interface CalendarGridProps {
  weekdayTimeSlots: WeekdayTimeSlots;
  dateOverrides: DateOverrides;
  excludeHolidays: boolean;
  onChangeWeekday: (slots: WeekdayTimeSlots) => void;
  onChangeDateOverrides: (overrides: DateOverrides) => void;
  onChangeExcludeHolidays: (value: boolean) => void;
  participantIds?: string[];
  duration?: number; // minutes — fragments shorter than this are hidden
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const START_HOUR = 8;
const END_HOUR = 21;
const HOUR_HEIGHT = 48; // px per hour
const TOTAL_HOURS = END_HOUR - START_HOUR;

function getGridDates(weekOffset = 0): Date[] {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMon + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Convert time string "HH:mm" or ISO to minutes from START_HOUR */
function timeToY(timeStr: string, refDate?: Date): number {
  let hours: number, minutes: number;
  if (timeStr.includes('T')) {
    const d = new Date(timeStr);
    hours = d.getHours();
    minutes = d.getMinutes();
  } else {
    [hours, minutes] = timeStr.split(':').map(Number);
  }
  const totalMin = (hours - START_HOUR) * 60 + minutes;
  return (totalMin / 60) * HOUR_HEIGHT;
}

export function CalendarGrid({
  weekdayTimeSlots,
  dateOverrides,
  excludeHolidays,
  onChangeWeekday,
  onChangeDateOverrides,
  onChangeExcludeHolidays,
  participantIds = [],
  duration = 30,
}: CalendarGridProps) {
  const [busyEvents, setBusyEvents] = useState<BusyEvent[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const gridDates = getGridDates(weekOffset);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  useEffect(() => {
    async function fetchEvents() {
      const dates = gridDates;
      const params = new URLSearchParams({
        startDate: toLocalDateStr(dates[0]),
        endDate: toLocalDateStr(dates[dates.length - 1]),
      });
      if (participantIds.length > 0) params.set('userIds', participantIds.join(','));
      try {
        const res = await fetch(`/api/calendar/events?${params}`);
        if (res.ok) {
          const data = await res.json();
          setBusyEvents(data.events ?? []);
        }
      } catch { /* ignore */ }
    }
    fetchEvents();
  }, [participantIds, weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Events for a given date
  const getEventsForDate = useCallback((date: Date): BusyEvent[] => {
    return busyEvents.filter((e) => {
      const eDate = new Date(e.start);
      return isSameDay(eDate, date);
    });
  }, [busyEvents]);

  // Drag state for availability selection
  const [dragging, setDragging] = useState(false);
  const [dragDay, setDragDay] = useState<string | null>(null);
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [dragEndY, setDragEndY] = useState<number | null>(null);

  const yToTime = (y: number): string => {
    const clampedY = Math.max(0, Math.min(y, TOTAL_HOURS * HOUR_HEIGHT));
    const totalMin = Math.round((clampedY / HOUR_HEIGHT) * 60 / 30) * 30; // snap to 30min
    const hours = START_HOUR + Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const handleColumnMouseDown = (dayKey: string, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragging(true);
    setDragDay(dayKey);
    setDragStartY(y);
    setDragEndY(y);
  };

  const handleColumnMouseMove = (dayKey: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (dragging && dayKey === dragDay) {
      const rect = e.currentTarget.getBoundingClientRect();
      setDragEndY(e.clientY - rect.top);
    }
  };

  const handleMouseUp = () => {
    if (dragging && dragDay !== null && dragStartY !== null && dragEndY !== null) {
      const startTime = yToTime(Math.min(dragStartY, dragEndY));
      const endTime = yToTime(Math.max(dragStartY, dragEndY) + HOUR_HEIGHT / 2); // add half hour min

      if (startTime < endTime) {
        const existing = weekdayTimeSlots[dragDay] ?? [];
        const merged = mergeSlots([...existing, { start: startTime, end: endTime }]);
        onChangeWeekday({ ...weekdayTimeSlots, [dragDay]: merged });
      }
    }
    setDragging(false);
    setDragDay(null);
    setDragStartY(null);
    setDragEndY(null);
  };

  const removeAvailabilitySlot = (dayKey: string, slot: TimeSlot) => {
    const existing = weekdayTimeSlots[dayKey] ?? [];
    onChangeWeekday({
      ...weekdayTimeSlots,
      [dayKey]: existing.filter((s) => s.start !== slot.start || s.end !== slot.end),
    });
  };

  const monthLabel = (() => {
    const m = gridDates[3]; // mid-week
    return `${m.getFullYear()}年${m.getMonth() + 1}月`;
  })();

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setWeekOffset(0)}
          className="px-3 py-1 text-sm rounded-md border border-blue-400 text-blue-600 hover:bg-blue-50"
        >
          今日
        </button>
        <button
          type="button"
          onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
          disabled={weekOffset === 0}
          className="px-2 py-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
        >
          &lt;
        </button>
        <button
          type="button"
          onClick={() => setWeekOffset((w) => w + 1)}
          className="px-2 py-1 text-gray-500 hover:text-gray-700"
        >
          &gt;
        </button>
        <span className="text-base font-medium text-gray-800">{monthLabel}</span>
      </div>

      {/* Calendar */}
      <div className="flex border border-gray-200 rounded-lg overflow-hidden" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {/* Time axis */}
        <div className="w-12 flex-shrink-0 border-r border-gray-200 bg-white">
          <div className="h-14" /> {/* header spacer */}
          <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
            {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 text-right pr-2 text-xs text-gray-400 -translate-y-1/2"
                style={{ top: i * HOUR_HEIGHT }}
              >
                {String(START_HOUR + i).padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {/* Day columns */}
        {gridDates.map((date, dateIdx) => {
          const dayKey = date.getDay().toString();
          const isToday = isSameDay(date, today);
          const isPast = date < today;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const dayEvents = getEventsForDate(date);
          const availSlots = weekdayTimeSlots[dayKey] ?? [];

          return (
            <div
              key={dateIdx}
              className={`flex-1 min-w-0 ${dateIdx > 0 ? 'border-l border-gray-200' : ''}`}
            >
              {/* Day header */}
              <div className={`h-14 flex flex-col items-center justify-center border-b border-gray-200 ${isPast ? 'bg-gray-50' : 'bg-white'}`}>
                <span className={`text-xs ${isWeekend ? 'text-gray-400' : isToday ? 'text-blue-600' : 'text-gray-500'}`}>
                  {DAY_LABELS[date.getDay()]}
                </span>
                <span className={`text-sm font-medium leading-6 ${
                  isToday
                    ? 'bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center'
                    : isPast ? 'text-gray-300' : 'text-gray-800'
                }`}>
                  {date.getDate()}
                </span>
              </div>

              {/* Time body */}
              <div
                className={`relative select-none ${isPast ? 'bg-gray-50' : 'bg-white'}`}
                style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
                onMouseDown={(e) => !isPast && handleColumnMouseDown(dayKey, e)}
                onMouseMove={(e) => !isPast && handleColumnMouseMove(dayKey, e)}
              >
                {/* Hour lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`line-${i}`}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                ))}

                {/* Availability blocks (subtract busy times) */}
                {!isPast && (() => {
                  // Convert busy events to {start, end} in "HH:mm" for this date
                  const busyRanges = dayEvents.map((ev) => {
                    const s = new Date(ev.start);
                    const e = new Date(ev.end);
                    return {
                      start: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
                      end: `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`,
                    };
                  }).sort((a, b) => a.start.localeCompare(b.start));

                  // Now clip for current time if today
                  const nowStr = isToday
                    ? (() => { const n = new Date(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; })()
                    : '00:00';

                  // Split each avail slot by busy ranges
                  const fragments: { start: string; end: string }[] = [];
                  for (const slot of availSlots) {
                    let cursor = slot.start < nowStr && isToday ? nowStr : slot.start;
                    for (const busy of busyRanges) {
                      if (busy.end <= cursor) continue;
                      if (busy.start >= slot.end) break;
                      if (busy.start > cursor) {
                        fragments.push({ start: cursor, end: busy.start });
                      }
                      cursor = busy.end > cursor ? busy.end : cursor;
                    }
                    if (cursor < slot.end) {
                      fragments.push({ start: cursor, end: slot.end });
                    }
                  }

                  // Filter out fragments shorter than selected duration
                  const minMinutes = duration;
                  const validFragments = fragments.filter((frag) => {
                    const [sh, sm] = frag.start.split(':').map(Number);
                    const [eh, em] = frag.end.split(':').map(Number);
                    return (eh * 60 + em) - (sh * 60 + sm) >= minMinutes;
                  });

                  return validFragments.map((frag, i) => {
                    const top = timeToY(frag.start);
                    const bottom = timeToY(frag.end);
                    const height = bottom - top;
                    if (height <= 0) return null;
                    return (
                      <div
                        key={`avail-${i}`}
                        className="absolute left-1 right-1 border border-dashed border-blue-400 rounded px-1 overflow-hidden"
                        style={{ top, height }}
                      >
                        <div className="text-[10px] leading-3 text-blue-500 mt-px truncate">
                          {frag.start} - {frag.end}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Busy event blocks */}
                {dayEvents.map((ev, i) => {
                  const top = timeToY(ev.start);
                  const bottom = timeToY(ev.end);
                  const height = Math.max(12, bottom - top);
                  const startD = new Date(ev.start);
                  const endD = new Date(ev.end);
                  const timeLabel = `${String(startD.getHours()).padStart(2, '0')}:${String(startD.getMinutes()).padStart(2, '0')} - ${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}`;

                  return (
                    <div
                      key={`ev-${i}`}
                      className="absolute left-1 right-1 rounded px-1 overflow-hidden border border-blue-200 bg-blue-100 text-blue-800 z-10 cursor-default"
                      style={{ top, height }}
                      title={`${timeLabel}\n${ev.summary ?? '予定あり'}`}
                    >
                      <div className="text-[10px] leading-3 truncate font-medium mt-px">
                        {ev.summary ?? '予定あり'}
                      </div>
                      {height >= 24 && (
                        <div className="text-[9px] leading-3 text-blue-600 truncate">
                          {timeLabel}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Drag preview */}
                {dragging && dragDay === dayKey && dragStartY !== null && dragEndY !== null && (
                  <div
                    className="absolute left-0 right-0 bg-blue-50 opacity-60 border border-dashed border-blue-400 rounded z-20"
                    style={{
                      top: Math.min(dragStartY, dragEndY),
                      height: Math.abs(dragEndY - dragStartY),
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 border border-dashed border-blue-400 rounded-sm" /> 対応可能</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 border border-blue-200 rounded-sm" /> 予定あり</span>
      </div>
    </div>
  );
}

function mergeSlots(slots: TimeSlot[]): TimeSlot[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const merged: TimeSlot[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = sorted[i].end > last.end ? sorted[i].end : last.end;
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}
