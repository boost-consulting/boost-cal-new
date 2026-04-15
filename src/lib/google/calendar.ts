import { google } from 'googleapis';

function createOAuth2Client(accessToken: string, refreshToken?: string) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return oauth2;
}

export interface CalendarEvent {
  start: string;
  end: string;
  summary?: string;
}

/** Fetch events from a user's Google Calendar */
export async function getCalendarEvents(
  accessToken: string,
  refreshToken: string | undefined,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const auth = createOAuth2Client(accessToken, refreshToken ?? undefined);
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items ?? [])
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({
      start: e.start!.dateTime!,
      end: e.end!.dateTime!,
      summary: e.summary ?? undefined,
    }));
}

export interface CreateEventParams {
  accessToken: string;
  refreshToken?: string;
  summary: string;
  description?: string;
  startTime: string;
  endTime: string;
  attendeeEmails: string[];
  conferenceRoomId?: string;
  conferenceRoomEmail?: string;
  location?: string;
  createMeetLink: boolean;
}

export interface CreatedEvent {
  eventId: string;
  meetingUrl: string | null;
  htmlLink: string;
}

/** Create a Google Calendar event with optional Meet link */
export async function createCalendarEvent(
  params: CreateEventParams
): Promise<CreatedEvent> {
  const auth = createOAuth2Client(params.accessToken, params.refreshToken);
  const calendar = google.calendar({ version: 'v3', auth });

  const attendees: { email: string; resource?: boolean }[] = params.attendeeEmails.map((email) => ({ email }));
  if (params.conferenceRoomEmail) {
    attendees.push({ email: params.conferenceRoomEmail, resource: true });
  }

  const eventBody: Record<string, unknown> = {
    summary: params.summary,
    description: params.description,
    start: { dateTime: params.startTime, timeZone: 'Asia/Tokyo' },
    end: { dateTime: params.endTime, timeZone: 'Asia/Tokyo' },
    attendees,
  };

  if (params.location) {
    eventBody.location = params.location;
  }

  if (params.createMeetLink) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `boostcal-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventBody,
    conferenceDataVersion: params.createMeetLink ? 1 : 0,
    sendUpdates: 'all',
  });

  const meetUrl = res.data.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video'
  )?.uri ?? null;

  return {
    eventId: res.data.id!,
    meetingUrl: meetUrl,
    htmlLink: res.data.htmlLink!,
  };
}

/** Custom rooms not managed in Google Workspace (no calendar resource, no auto-invite) */
const CUSTOM_CONFERENCE_ROOMS: { id: string; name: string; capacity: number }[] = [
  {
    id: 'boost-capital-office',
    name: 'ブーストキャピタルオフィス（麻布台ヒルズガーデンプラザB4階）',
    capacity: 0,
  },
];

export function isCustomConferenceRoom(id: string): boolean {
  return CUSTOM_CONFERENCE_ROOMS.some((r) => r.id === id);
}

export function getCustomConferenceRoomName(id: string): string | null {
  return CUSTOM_CONFERENCE_ROOMS.find((r) => r.id === id)?.name ?? null;
}

/** Look up a single Workspace conference room by resourceId */
export async function getConferenceRoomById(
  accessToken: string,
  refreshToken: string | undefined,
  resourceId: string
): Promise<{ id: string; name: string; email: string; capacity: number } | null> {
  if (isCustomConferenceRoom(resourceId)) return null;
  const auth = createOAuth2Client(accessToken, refreshToken);
  const admin = google.admin({ version: 'directory_v1', auth });
  try {
    const res = await admin.resources.calendars.get({
      customer: 'my_customer',
      calendarResourceId: resourceId,
    });
    if (!res.data.resourceEmail) return null;
    return {
      id: res.data.resourceId ?? resourceId,
      name: res.data.resourceName ?? '',
      email: res.data.resourceEmail,
      capacity: res.data.capacity ?? 0,
    };
  } catch {
    return null;
  }
}

/** Fetch conference rooms from Google Workspace, merged with custom rooms */
export async function getConferenceRooms(
  accessToken: string,
  refreshToken?: string
): Promise<{ id: string; name: string; capacity: number }[]> {
  const auth = createOAuth2Client(accessToken, refreshToken);
  const admin = google.admin({ version: 'directory_v1', auth });

  try {
    const res = await admin.resources.calendars.list({
      customer: 'my_customer',
    });

    const workspaceRooms = (res.data.items ?? []).map((room) => ({
      id: room.resourceId ?? '',
      name: room.resourceName ?? '',
      capacity: room.capacity ?? 0,
    }));

    return [...workspaceRooms, ...CUSTOM_CONFERENCE_ROOMS];
  } catch {
    return [...CUSTOM_CONFERENCE_ROOMS];
  }
}
