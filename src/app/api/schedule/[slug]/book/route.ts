import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { BookingRepository } from '@/domain/repositories/booking-repository';
import { ScheduleLinkRepository } from '@/domain/repositories/schedule-link-repository';
import { UserRepository } from '@/domain/repositories/user-repository';
import { BookingService } from '@/domain/services/booking-service';
import { createBookingSchema } from '@/schemas/booking';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await request.json();

  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'バリデーションエラー',
        error: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const bookingRepo = new BookingRepository(supabaseAdmin);
  const linkRepo = new ScheduleLinkRepository(supabaseAdmin);
  const userRepo = new UserRepository(supabaseAdmin);
  const service = new BookingService(bookingRepo, linkRepo, userRepo);

  try {
    const booking = await service.createBooking(slug, {
      clientName: parsed.data.clientName,
      clientEmail: parsed.data.clientEmail,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      meetingMode: parsed.data.meetingMode,
      customMeetingUrl: parsed.data.customMeetingUrl ?? undefined,
      notes: parsed.data.notes ?? undefined,
    });

    return NextResponse.json(
      {
        data: {
          id: booking.id,
          startTime: booking.startTime.toISOString(),
          endTime: booking.endTime.toISOString(),
          meetingUrl: booking.meetingUrl,
          meetingMode: booking.meetingMode,
          status: booking.status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('見つかりません')) {
        return NextResponse.json(
          { message: error.message, error: 'LINK_NOT_FOUND' },
          { status: 404 }
        );
      }
      if (error.message.includes('既に予約済み')) {
        return NextResponse.json(
          { message: error.message, error: 'ALREADY_BOOKED' },
          { status: 409 }
        );
      }
      if (error.message.includes('既に予約')) {
        return NextResponse.json(
          { message: error.message, error: 'DOUBLE_BOOKING' },
          { status: 409 }
        );
      }
    }
    throw error;
  }
}
