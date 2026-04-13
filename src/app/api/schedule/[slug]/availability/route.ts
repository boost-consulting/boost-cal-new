import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { ScheduleLinkRepository } from '@/domain/repositories/schedule-link-repository';
import { UserRepository } from '@/domain/repositories/user-repository';
import { CalendarService } from '@/domain/services/calendar-service';
import { getCalendarEvents } from '@/lib/google/calendar';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const linkRepo = new ScheduleLinkRepository(supabaseAdmin);
  const link = await linkRepo.findActiveBySlug(slug);

  if (!link) {
    return NextResponse.json(
      { message: 'リンクが見つかりません', error: 'LINK_NOT_FOUND' },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const meetingMode = searchParams.get('meetingMode') ?? undefined;
  const duration = Number(searchParams.get('duration') ?? link.duration);
  const startDate = searchParams.get('startDate') ?? new Date().toISOString().split('T')[0];
  const endDateParam = searchParams.get('endDate');
  const endDate = endDateParam ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let bufferMinutes = 0;
  if (meetingMode) {
    const opts = link.settings.meetingOptions;
    if (meetingMode === 'online') bufferMinutes = opts.bufferOnline;
    else if (meetingMode === 'inPerson_office') bufferMinutes = opts.bufferInPersonOffice;
    else if (meetingMode === 'inPerson_visit') bufferMinutes = opts.bufferInPersonVisit;
  }

  // Fetch busy times from all participants' calendars
  const userRepo = new UserRepository(supabaseAdmin);
  const busyTimes: { start: string; end: string }[] = [];

  // Collect all participant user IDs (owner + internal participants)
  const allUserIds = [link.ownerId, ...(link.settings.participants?.internalIds ?? [])];
  const uniqueUserIds = [...new Set(allUserIds)];
  const tokens = await userRepo.getTokensByIds(uniqueUserIds);

  const timeMin = new Date(startDate).toISOString();
  const timeMax = new Date(endDate + 'T23:59:59+09:00').toISOString();

  await Promise.all(
    tokens.map(async (t) => {
      if (t.accessToken) {
        try {
          const events = await getCalendarEvents(
            t.accessToken,
            t.refreshToken ?? undefined,
            timeMin,
            timeMax
          );
          busyTimes.push(...events.map((e) => ({ start: e.start, end: e.end })));
        } catch {
          // Skip users with invalid tokens
        }
      }
    })
  );

  const calendarService = new CalendarService();
  const availableSlots = calendarService.calculateAvailability({
    settings: link.settings,
    startDate,
    endDate,
    duration,
    busyTimes,
    bufferMinutes,
  });

  const owner = await userRepo.findById(link.ownerId);

  return NextResponse.json({
    availableSlots,
    linkInfo: {
      name: link.name,
      description: link.description,
      ownerName: owner?.name ?? '',
      allowedDurations: link.settings.allowedDurations,
      meetingOptions: {
        allowOnline: link.settings.meetingOptions.allowOnline,
        allowInPersonOffice: link.settings.meetingOptions.allowInPersonOffice,
        allowInPersonVisit: link.settings.meetingOptions.allowInPersonVisit,
      },
      visitLocation: link.settings.visitLocationName ?? null,
      timezone: link.settings.timezone,
    },
  });
}
