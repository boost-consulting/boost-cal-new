'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface AvailableSlot {
  start: string;
  end: string;
}

interface LinkInfo {
  name: string;
  description: string | null;
  ownerName: string;
  allowedDurations: number[];
  meetingOptions: {
    allowOnline: boolean;
    allowInPersonOffice: boolean;
    allowInPersonVisit: boolean;
  };
  visitLocation: string | null;
  timezone: string;
}

type MeetingMode = 'online' | 'inPerson_office' | 'inPerson_visit';
type PageState = 'loading' | 'selecting' | 'form' | 'complete' | 'error';

const MEETING_MODE_LABELS: Record<MeetingMode, string> = {
  online: 'オンライン',
  inPerson_office: '対面（弊社オフィス）',
  inPerson_visit: '対面（貴社指定）',
};

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const START_HOUR = 8;
const END_HOUR = 21;
const HOUR_HEIGHT = 48;
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

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function timeToY(timeStr: string): number {
  let hours: number, minutes: number;
  if (timeStr.includes('T')) {
    const d = new Date(timeStr);
    hours = d.getHours();
    minutes = d.getMinutes();
  } else {
    [hours, minutes] = timeStr.split(':').map(Number);
  }
  return ((hours - START_HOUR) * 60 + minutes) / 60 * HOUR_HEIGHT;
}

interface Props {
  slug: string;
}

export function ScheduleBookingContent({ slug }: Props) {
  const [state, setState] = useState<PageState>('loading');
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [duration, setDuration] = useState<number>(30);
  const [meetingMode, setMeetingMode] = useState<MeetingMode>('online');
  const [errorMessage, setErrorMessage] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);

  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [customMeetingUrl, setCustomMeetingUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [bookingResult, setBookingResult] = useState<{
    meetingUrl: string | null;
    startTime: string;
    endTime: string;
  } | null>(null);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const gridDates = getGridDates(weekOffset);

  const fetchAvailability = useCallback(async () => {
    const params = new URLSearchParams({
      meetingMode,
      duration: duration.toString(),
    });

    const res = await fetch(`/api/schedule/${slug}/availability?${params}`);
    if (!res.ok) {
      setErrorMessage('このリンクは無効です');
      setState('error');
      return;
    }

    const data = await res.json();
    setLinkInfo(data.linkInfo);
    setSlots(data.availableSlots);
    setState('selecting');
  }, [slug, meetingMode, duration]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const map: Record<string, AvailableSlot[]> = {};
    for (const slot of slots) {
      const d = new Date(slot.start);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(slot);
    }
    return map;
  }, [slots]);

  const getSlotsForDate = (date: Date): AvailableSlot[] => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return slotsByDate[key] ?? [];
  };

  const handleSelectSlot = (slot: AvailableSlot) => {
    setSelectedSlot(slot);
    setState('form');
  };

  const handleBack = () => {
    setSelectedSlot(null);
    setFormErrors({});
    setState('selecting');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!clientName.trim()) errs.clientName = '名前は必須です';
    if (!clientEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      errs.clientEmail = '正しいメールアドレスを入力してください';
    }
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/schedule/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          clientEmail,
          startTime: selectedSlot!.start,
          endTime: selectedSlot!.end,
          meetingMode,
          customMeetingUrl: customMeetingUrl || null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.error === 'DOUBLE_BOOKING') {
          setFormErrors({ general: 'この時間帯は既に予約されています。別の時間を選択してください。' });
          return;
        }
        if (err.error === 'ALREADY_BOOKED') {
          setFormErrors({ general: 'このリンクでは既に予約済みです。変更・キャンセルは予約完了メールからお願いします。' });
          return;
        }
        setFormErrors({ general: err.message ?? '予約に失敗しました' });
        return;
      }

      const { data } = await res.json();
      setBookingResult({
        meetingUrl: data.meetingUrl,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      setState('complete');
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.href);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleMeetingModeChange = (mode: MeetingMode) => {
    if (mode === meetingMode) return;
    setMeetingMode(mode);
    setSelectedSlot(null);
    setState('loading');
  };

  const handleDurationChange = (d: number) => {
    if (d === duration) return;
    setDuration(d);
    setSelectedSlot(null);
    setState('loading');
  };

  const monthLabel = (() => {
    const m = gridDates[3];
    return `${m.getFullYear()}年${m.getMonth() + 1}月`;
  })();

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md text-center">
          <p className="text-red-700">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (state === 'complete' && bookingResult) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 max-w-md text-center">
          <h2 className="text-xl font-bold text-green-800">予約が確定しました</h2>
          <div className="mt-4 text-sm text-green-700 space-y-2">
            <p>
              {new Date(bookingResult.startTime).toLocaleString('ja-JP')} 〜{' '}
              {new Date(bookingResult.endTime).toLocaleTimeString('ja-JP')}
            </p>
            {bookingResult.meetingUrl && (
              <p>
                会議URL:{' '}
                <a href={bookingResult.meetingUrl} className="text-blue-600 underline">
                  {bookingResult.meetingUrl}
                </a>
              </p>
            )}
          </div>
          <p className="mt-4 text-sm text-green-600">確認メールをお送りしました。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex gap-6 max-w-[1400px] mx-auto p-6">
        {/* Left: Info & Form */}
        <div className="w-[340px] flex-shrink-0 space-y-6">
          {linkInfo && (
            <div>
              <h1 className="text-xl font-bold text-gray-900">{linkInfo.name}</h1>
              {linkInfo.description && (
                <p className="mt-1 text-sm text-gray-600">{linkInfo.description}</p>
              )}
              <p className="mt-1 text-sm text-gray-500">{linkInfo.ownerName}</p>
            </div>
          )}

          {/* Duration */}
          {linkInfo && linkInfo.allowedDurations.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">会議時間</label>
              <div className="flex gap-1">
                {linkInfo.allowedDurations.map((d) => (
                  <button
                    key={d}
                    onClick={() => handleDurationChange(d)}
                    className={`px-3 py-1.5 text-sm rounded-md border ${
                      duration === d
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {d}分
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Meeting mode */}
          {linkInfo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">会議形式</label>
              <div className="flex gap-1">
                {(Object.entries(MEETING_MODE_LABELS) as [MeetingMode, string][])
                  .filter(([key]) => {
                    if (key === 'online') return linkInfo.meetingOptions.allowOnline;
                    if (key === 'inPerson_office') return linkInfo.meetingOptions.allowInPersonOffice;
                    if (key === 'inPerson_visit') return linkInfo.meetingOptions.allowInPersonVisit;
                    return false;
                  })
                  .map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => handleMeetingModeChange(key)}
                      className={`px-3 py-1.5 text-sm rounded-md border ${
                        meetingMode === key
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Selected slot info or hint */}
          {state === 'selecting' && (
            <p className="text-sm text-gray-500">
              カレンダーから空き時間をクリックして予約してください
            </p>
          )}

          {/* Booking form */}
          {state === 'form' && selectedSlot && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800 font-medium">
                  {new Date(selectedSlot.start).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}
                </p>
                <p className="text-sm text-blue-700">
                  {new Date(selectedSlot.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  {' 〜 '}
                  {new Date(selectedSlot.end).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  {' '}({MEETING_MODE_LABELS[meetingMode]})
                </p>
                <button type="button" onClick={handleBack} className="mt-1 text-xs text-blue-600 hover:text-blue-800">
                  変更する
                </button>
              </div>

              {formErrors.general && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-sm text-red-700">{formErrors.general}</p>
                </div>
              )}

              <div>
                <label htmlFor="clientName" className="block text-sm font-medium text-gray-700">
                  お名前 <span className="text-red-500">*</span>
                </label>
                <input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => { setClientName(e.target.value); setFormErrors({}); }}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
                />
                {formErrors.clientName && <p className="mt-1 text-sm text-red-600">{formErrors.clientName}</p>}
              </div>

              <div>
                <label htmlFor="clientEmail" className="block text-sm font-medium text-gray-700">
                  メールアドレス <span className="text-red-500">*</span>
                </label>
                <input
                  id="clientEmail"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => { setClientEmail(e.target.value); setFormErrors({}); }}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
                />
                {formErrors.clientEmail && <p className="mt-1 text-sm text-red-600">{formErrors.clientEmail}</p>}
              </div>

              {meetingMode === 'online' && (
                <div>
                  <label htmlFor="customMeetingUrl" className="block text-sm font-medium text-gray-700">
                    会議URL（任意）
                  </label>
                  <input
                    id="customMeetingUrl"
                    value={customMeetingUrl}
                    onChange={(e) => setCustomMeetingUrl(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    placeholder="https://zoom.us/..."
                  />
                </div>
              )}

              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                  メモ（任意）
                </label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  placeholder="ご相談内容など"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '予約中...' : '予約を確定する'}
              </button>
            </form>
          )}
        </div>

        {/* Right: Calendar Grid */}
        <div className="flex-1 min-w-0">
          {/* Navigation */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1 text-sm rounded-md border border-blue-400 text-blue-600 hover:bg-blue-50"
            >
              今日
            </button>
            <button
              onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
              disabled={weekOffset === 0}
              className="px-2 py-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >
              &lt;
            </button>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="px-2 py-1 text-gray-500 hover:text-gray-700"
            >
              &gt;
            </button>
            <span className="text-base font-medium text-gray-800">{monthLabel}</span>
          </div>

          {/* Calendar */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white">
            {/* Time axis */}
            <div className="w-12 flex-shrink-0 border-r border-gray-200">
              <div className="h-14" />
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
              const isToday = isSameDay(date, today);
              const isPast = date < today;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const daySlots = getSlotsForDate(date);

              return (
                <div
                  key={dateIdx}
                  className={`flex-1 min-w-0 ${dateIdx > 0 ? 'border-l border-gray-200' : ''}`}
                >
                  {/* Day header */}
                  <div className={`h-14 flex flex-col items-center justify-center border-b border-gray-200 ${isPast ? 'bg-gray-50' : ''}`}>
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
                    className={`relative ${isPast ? 'bg-gray-50' : ''}`}
                    style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
                  >
                    {/* Hour lines */}
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                      <div key={i} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: i * HOUR_HEIGHT }} />
                    ))}

                    {/* Available slot blocks — clickable */}
                    {!isPast && daySlots.map((slot, i) => {
                      // Skip slots that have already passed
                      if (new Date(slot.start) < new Date()) return null;
                      const top = timeToY(slot.start);
                      const bottom = timeToY(slot.end);
                      const height = Math.max(12, bottom - top);
                      const startD = new Date(slot.start);
                      const endD = new Date(slot.end);
                      const timeLabel = `${String(startD.getHours()).padStart(2, '0')}:${String(startD.getMinutes()).padStart(2, '0')} - ${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}`;
                      const isSelected = selectedSlot?.start === slot.start && selectedSlot?.end === slot.end;

                      return (
                        <div
                          key={`slot-${i}`}
                          onClick={() => handleSelectSlot(slot)}
                          className={`absolute left-1 right-1 rounded px-1 overflow-hidden cursor-pointer transition-colors z-10 ${
                            isSelected
                              ? 'bg-blue-600 text-white border border-blue-700'
                              : 'bg-green-50 border border-dashed border-green-400 text-green-700 hover:bg-green-100'
                          }`}
                          style={{ top, height }}
                          title={timeLabel}
                        >
                          <div className={`text-[10px] leading-3 truncate font-medium mt-px ${isSelected ? 'text-white' : 'text-green-700'}`}>
                            {timeLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex gap-4 text-xs text-gray-500 mt-3">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-50 border border-dashed border-green-400 rounded-sm" /> 予約可能</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-600 rounded-sm" /> 選択中</span>
          </div>
        </div>
      </div>
    </div>
  );
}
