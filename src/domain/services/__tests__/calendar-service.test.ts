import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarService } from '../calendar-service';
import type { LinkSettings } from '@/domain/models/schedule-link';

// Mock holiday-jp
vi.mock('@holiday-jp/holiday_jp', () => {
  const fn = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y === 2026 && m === 4 && d === 29;
  };
  return { default: { isHoliday: fn }, isHoliday: fn };
});

function makeSettings(overrides: Partial<LinkSettings> = {}): LinkSettings {
  return {
    weekdayTimeSlots: {
      '1': [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }], // Mon
      '2': [{ start: '09:00', end: '17:00' }], // Tue
      '3': [{ start: '09:00', end: '17:00' }], // Wed
      '4': [{ start: '09:00', end: '17:00' }], // Thu
      '5': [{ start: '09:00', end: '17:00' }], // Fri
    },
    excludeHolidays: true,
    dateOverrides: {},
    allowedDurations: [30],
    participants: { internalIds: [], externalEmails: [] },
    meetingOptions: {
      allowOnline: true,
      allowInPersonOffice: false,
      allowInPersonVisit: false,
      bufferOnline: 0,
      bufferInPersonOffice: 0,
      bufferInPersonVisit: 60,
    },
    timezone: 'Asia/Tokyo',
    ...overrides,
  };
}

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService();
  });

  describe('calculateAvailability', () => {
    it('should generate slots from weekday time slots', () => {
      const settings = makeSettings();
      // 2026-04-13 is Monday
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 30,
        busyTimes: [],
      });

      // Mon has 09:00-12:00 and 13:00-17:00 = 6 + 8 = 14 half-hour slots
      expect(slots.length).toBe(14);
      expect(slots[0].start).toContain('2026-04-13T09:00');
      expect(slots[0].end).toContain('2026-04-13T09:30');
    });

    it('should not generate slots on weekends', () => {
      const settings = makeSettings();
      // 2026-04-11 is Saturday, 2026-04-12 is Sunday
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-11',
        endDate: '2026-04-12',
        duration: 30,
        busyTimes: [],
      });

      expect(slots).toHaveLength(0);
    });

    it('should exclude holidays when excludeHolidays is true', () => {
      const settings = makeSettings({ excludeHolidays: true });
      // 2026-04-29 is mocked as a holiday (Wed)
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-29',
        endDate: '2026-04-29',
        duration: 30,
        busyTimes: [],
      });

      expect(slots).toHaveLength(0);
    });

    it('should not exclude holidays when excludeHolidays is false', () => {
      const settings = makeSettings({ excludeHolidays: false });
      // 2026-04-29 is mocked as a holiday (Wed)
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-29',
        endDate: '2026-04-29',
        duration: 30,
        busyTimes: [],
      });

      expect(slots.length).toBeGreaterThan(0);
    });

    it('should treat dateOverrides entries as exclusion ranges', () => {
      const settings = makeSettings({
        dateOverrides: {
          '2026-04-13': [{ start: '10:00', end: '11:00' }], // Exclude 10-11 on Monday
        },
      });

      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 30,
        busyTimes: [],
      });

      // Normally 14 slots; subtract 10:00-10:30 and 10:30-11:00 = 12
      expect(slots).toHaveLength(12);
      expect(slots.some((s) => s.start.includes('10:00'))).toBe(false);
      expect(slots.some((s) => s.start.includes('10:30'))).toBe(false);
    });

    it('should exclude date when override is empty array', () => {
      const settings = makeSettings({
        dateOverrides: {
          '2026-04-13': [], // Exclude Monday
        },
      });

      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 30,
        busyTimes: [],
      });

      expect(slots).toHaveLength(0);
    });

    it('should still exclude holiday even when dateOverrides has exclusion ranges', () => {
      const settings = makeSettings({
        excludeHolidays: true,
        dateOverrides: {
          '2026-04-29': [{ start: '10:00', end: '12:00' }],
        },
      });

      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-29',
        endDate: '2026-04-29',
        duration: 30,
        busyTimes: [],
      });

      expect(slots).toHaveLength(0);
    });

    it('should exclude busy times from slots', () => {
      const settings = makeSettings();
      // Monday 2026-04-13, busy 09:00-10:00
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 30,
        busyTimes: [
          { start: '2026-04-13T09:00:00+09:00', end: '2026-04-13T10:00:00+09:00' },
        ],
      });

      // Normally 14 slots, minus 2 (09:00-09:30, 09:30-10:00) = 12
      expect(slots).toHaveLength(12);
      expect(slots[0].start).toContain('10:00');
    });

    it('should apply buffer time and exclude overlapping slots', () => {
      const settings = makeSettings();
      // Monday 2026-04-13, busy 10:00-10:30 with 30min buffer
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 30,
        busyTimes: [
          { start: '2026-04-13T10:00:00+09:00', end: '2026-04-13T10:30:00+09:00' },
        ],
        bufferMinutes: 30,
      });

      // Slots at 09:30 (end 10:00, buffer until 10:30 overlaps busy) should be excluded
      // Slots at 10:00, 10:30 (start within buffer of busy end) also excluded
      const hasSlotAt0930 = slots.some((s) => s.start.includes('09:30'));
      const hasSlotAt1000 = slots.some((s) => s.start.includes('10:00'));
      const hasSlotAt1030 = slots.some((s) => s.start.includes('10:30'));
      expect(hasSlotAt1000).toBe(false);
      expect(hasSlotAt0930).toBe(false); // buffer before
      expect(hasSlotAt1030).toBe(false); // buffer after
    });

    it('should filter slots by duration', () => {
      const settings = makeSettings({
        weekdayTimeSlots: {
          '1': [{ start: '09:00', end: '09:45' }], // Only 45 min window
        },
      });

      const slots60 = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 60,
        busyTimes: [],
      });

      expect(slots60).toHaveLength(0); // 45 min window can't fit 60 min

      const slots30 = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        duration: 30,
        busyTimes: [],
      });

      expect(slots30).toHaveLength(1); // 09:00-09:30 fits
    });

    it('should handle multiple days', () => {
      const settings = makeSettings();
      // Mon-Tue
      const slots = service.calculateAvailability({
        settings,
        startDate: '2026-04-13',
        endDate: '2026-04-14',
        duration: 30,
        busyTimes: [],
      });

      // Mon: 14 slots, Tue: 16 slots (09:00-17:00 continuous)
      expect(slots).toHaveLength(30);
    });
  });
});
