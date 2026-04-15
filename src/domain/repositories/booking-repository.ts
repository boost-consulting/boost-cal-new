import type { SupabaseClient } from '@supabase/supabase-js';
import type { Booking, CreateBookingInput, MeetingMode, BookingStatus } from '@/domain/models/booking';

interface BookingRow {
  id: string;
  schedule_link_id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
  event_title: string | null;
  meeting_url: string | null;
  meeting_mode: string;
  conference_room_id: string | null;
  location_name: string | null;
  location_address: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    scheduleLinkId: row.schedule_link_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    eventTitle: row.event_title,
    meetingUrl: row.meeting_url,
    meetingMode: row.meeting_mode as MeetingMode,
    conferenceRoomId: row.conference_room_id,
    locationName: row.location_name,
    locationAddress: row.location_address,
    status: row.status as BookingStatus,
    notes: row.notes,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class BookingRepository {
  constructor(private db: SupabaseClient) {}

  async create(input: CreateBookingInput): Promise<Booking> {
    const { data, error } = await this.db
      .from('bookings')
      .insert({
        schedule_link_id: input.scheduleLinkId,
        client_name: input.clientName,
        client_email: input.clientEmail,
        start_time: input.startTime.toISOString(),
        end_time: input.endTime.toISOString(),
        event_title: input.eventTitle ?? null,
        meeting_url: input.meetingUrl ?? null,
        meeting_mode: input.meetingMode,
        conference_room_id: input.conferenceRoomId ?? null,
        location_name: input.locationName ?? null,
        location_address: input.locationAddress ?? null,
        status: 'CONFIRMED',
        notes: input.notes ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return toBooking(data);
  }

  async findActiveByEmailAndLink(
    scheduleLinkId: string,
    clientEmail: string,
    from: Date
  ): Promise<Booking | null> {
    const { data, error } = await this.db
      .from('bookings')
      .select('*')
      .eq('schedule_link_id', scheduleLinkId)
      .eq('client_email', clientEmail)
      .eq('status', 'CONFIRMED')
      .gte('start_time', from.toISOString())
      .order('start_time', { ascending: true })
      .limit(1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as BookingRow[];
    return rows.length > 0 ? toBooking(rows[0]) : null;
  }

  async checkOverlap(
    scheduleLinkId: string,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    const { data } = await this.db
      .from('bookings')
      .select('id')
      .eq('schedule_link_id', scheduleLinkId)
      .eq('status', 'CONFIRMED')
      .lt('start_time', endTime.toISOString())
      .gt('end_time', startTime.toISOString());

    return (data ?? []).length > 0;
  }

  async createParticipants(bookingId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    const rows = userIds.map((userId) => ({
      booking_id: bookingId,
      user_id: userId,
    }));

    const { error } = await this.db
      .from('booking_participants')
      .insert(rows);

    if (error) throw new Error(error.message);
  }

  async findUpcomingConfirmed(startFrom: Date, startUntil: Date): Promise<Booking[]> {
    const { data, error } = await this.db
      .from('bookings')
      .select('*')
      .eq('status', 'CONFIRMED')
      .gte('start_time', startFrom.toISOString())
      .lt('start_time', startUntil.toISOString());

    if (error) throw new Error(error.message);
    return (data as BookingRow[]).map(toBooking);
  }

  async findParticipantsByBookingIds(
    bookingIds: string[]
  ): Promise<{ bookingId: string; userId: string }[]> {
    if (bookingIds.length === 0) return [];

    const { data, error } = await this.db
      .from('booking_participants')
      .select('booking_id, user_id')
      .in('booking_id', bookingIds);

    if (error) throw new Error(error.message);
    return (data as { booking_id: string; user_id: string }[]).map((row) => ({
      bookingId: row.booking_id,
      userId: row.user_id,
    }));
  }
}
