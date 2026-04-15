import type { Booking, MeetingMode } from '@/domain/models/booking';
import type { BookingRepository } from '@/domain/repositories/booking-repository';
import type { ScheduleLinkRepository } from '@/domain/repositories/schedule-link-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';
import { createCalendarEvent } from '@/lib/google/calendar';

interface CreateBookingInput {
  clientName: string;
  clientEmail: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  meetingMode: MeetingMode;
  customMeetingUrl?: string;
  notes?: string;
}

export class BookingService {
  constructor(
    private bookingRepository: BookingRepository,
    private scheduleLinkRepository: ScheduleLinkRepository,
    private userRepository?: UserRepository
  ) {}

  async createBooking(slug: string, input: CreateBookingInput): Promise<Booking> {
    const link = await this.scheduleLinkRepository.findActiveBySlug(slug);
    if (!link) {
      throw new Error('リンクが見つかりません');
    }

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);

    // Already-booked check: same email already has an upcoming confirmed booking on this link
    const existing = await this.bookingRepository.findActiveByEmailAndLink(
      link.id,
      input.clientEmail,
      new Date()
    );
    if (existing) {
      throw new Error('このリンクでは既に予約済みです');
    }

    // Double booking check
    const hasOverlap = await this.bookingRepository.checkOverlap(
      link.id,
      startTime,
      endTime
    );
    if (hasOverlap) {
      throw new Error('この時間帯は既に予約されています');
    }

    const eventTitle = this.generateEventTitle(link.name, input.clientName);

    // Determine location info
    const locationName = input.meetingMode === 'inPerson_visit'
      ? (link.settings.visitLocationName ?? null)
      : null;
    const locationAddress = input.meetingMode === 'inPerson_visit'
      ? (link.settings.visitLocationAddress ?? null)
      : null;
    const conferenceRoomId = input.meetingMode === 'inPerson_office'
      ? (link.settings.conferenceRoomId ?? null)
      : null;

    // Determine meeting URL and create calendar event
    let meetingUrl = input.customMeetingUrl ?? null;
    const createMeetLink = input.meetingMode === 'online' && !meetingUrl;

    // Try to create Google Calendar event
    if (this.userRepository) {
      const owner = await this.userRepository.findById(link.ownerId);
      if (owner?.accessToken) {
        // Collect attendee emails
        const attendeeEmails = [input.clientEmail];
        const participantIds = link.settings.participants?.internalIds ?? [];

        if (participantIds.length > 0) {
          const tokens = await this.userRepository.getTokensByIds(participantIds);
          // We need user emails, not just tokens - get from findById
          for (const pid of participantIds) {
            const pUser = await this.userRepository.findById(pid);
            if (pUser) attendeeEmails.push(pUser.email);
          }
        }

        // Add external emails
        const externalEmails = link.settings.participants?.externalEmails ?? [];
        attendeeEmails.push(...externalEmails);

        try {
          const location = locationName
            ? `${locationName}${locationAddress ? ` (${locationAddress})` : ''}`
            : undefined;

          const event = await createCalendarEvent({
            accessToken: owner.accessToken,
            refreshToken: owner.refreshToken ?? undefined,
            summary: eventTitle,
            description: input.notes,
            startTime: input.startTime,
            endTime: input.endTime,
            attendeeEmails,
            conferenceRoomId: conferenceRoomId ?? undefined,
            location,
            createMeetLink,
          });

          if (event.meetingUrl) {
            meetingUrl = event.meetingUrl;
          }
        } catch {
          // Google API error — continue without calendar event
        }
      }
    }

    const booking = await this.bookingRepository.create({
      scheduleLinkId: link.id,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      startTime,
      endTime,
      eventTitle,
      meetingUrl: meetingUrl ?? undefined,
      meetingMode: input.meetingMode,
      conferenceRoomId: conferenceRoomId ?? undefined,
      locationName: locationName ?? undefined,
      locationAddress: locationAddress ?? undefined,
      notes: input.notes,
    });

    // Create participants
    const participantIds = link.settings.participants?.internalIds ?? [];
    if (participantIds.length > 0) {
      await this.bookingRepository.createParticipants(booking.id, participantIds);
    }

    return booking;
  }

  generateEventTitle(linkName: string, clientName: string): string {
    return `${linkName} - ${clientName}`;
  }
}
