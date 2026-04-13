import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase/server';
import { UserRepository } from '@/domain/repositories/user-repository';
import { getCalendarEvents } from '@/lib/google/calendar';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser?.email) {
    return NextResponse.json(
      { message: '未認証です', error: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const userIds = searchParams.get('userIds')?.split(',').filter(Boolean) ?? [];

  if (!startDate || !endDate) {
    return NextResponse.json(
      { message: 'startDate, endDate は必須です', error: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const userRepo = new UserRepository(supabaseAdmin);
  const user = await userRepo.findByEmail(authUser.email);

  if (!user) {
    return NextResponse.json(
      { message: 'ユーザーが見つかりません', error: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const allUserIds = [user.id, ...userIds];
  const tokens = await userRepo.getTokensByIds(allUserIds);

  const events: { start: string; end: string; userId: string }[] = [];
  const busyByUser: Record<string, { start: string; end: string }[]> = {};

  // Fetch all users' calendars in parallel
  await Promise.all(
    tokens.map(async (t) => {
      busyByUser[t.id] = [];

      if (t.accessToken) {
        try {
          const calEvents = await getCalendarEvents(
            t.accessToken,
            t.refreshToken ?? undefined,
            new Date(startDate).toISOString(),
            new Date(endDate).toISOString()
          );
          const isOwner = t.id === user.id;
          const mapped = calEvents.map((e) => ({
            start: e.start,
            end: e.end,
            userId: t.id,
            summary: isOwner ? e.summary : '予定あり',
          }));
          events.push(...mapped);
          busyByUser[t.id] = calEvents.map((e) => ({ start: e.start, end: e.end }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[calendar/events] Failed for user ${t.id}:`, msg);
        }
      }
    })
  );

  return NextResponse.json({ events, busyByUser });
}
