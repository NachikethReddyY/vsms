export const EVENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const REGISTRATION_ID = 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6b';
export const PASS_TOKEN = 'test-pass-demo-0001';

export const upcomingEvent = {
  eventId: EVENT_ID,
  name: 'Choa Chu Kang Community Screening',
  venue: 'Choa Chu Kang Community Club',
  status: 'PUBLISHED',
  startsAt: '2026-08-20T01:00:00.000Z',
  endsAt: '2026-08-20T06:00:00.000Z',
  timezone: 'Asia/Singapore',
  canManage: true,
  activeCapacityCount: 42,
  capacity: 120,
  bannerKey: 'COMMUNITY_SCREENING',
  artworkDataUrl: null,
  shifts: [],
};

export const eventDetailForGuard = {
  eventId: EVENT_ID,
  name: 'Choa Chu Kang Community Screening',
  version: 1,
  status: 'PUBLISHED',
  canManage: false,
  shifts: [],
  eventStations: [],
};

export const accountWithRegistrationMembership = {
  account: {
    id: 'user-100001',
    userId: 'user-100001',
    fullName: 'Lena Tan',
    email: 'staff@vsms.test',
    approvalState: 'APPROVED',
    accessState: 'ENABLED',
    roles: ['ADMINISTRATOR', 'REGISTRATION_OFFICER', 'SCREENER', 'REVIEWER'],
    eventMemberships: [
      {
        id: 'membership-1',
        eventId: EVENT_ID,
        status: 'ACTIVE',
        roles: ['REGISTRATION_OFFICER'],
      },
    ],
  },
};

export const queueStatusResponse = {
  event: {
    eventId: EVENT_ID,
    name: 'Choa Chu Kang Community Screening',
    status: 'PUBLISHED',
    venue: 'Choa Chu Kang Community Club',
  },
  stations: [
    {
      stationId: 'station-visual-acuity',
      stationName: 'Visual Acuity',
      stationType: 'VISUAL_ACUITY',
      stationOrder: 1,
      workload: { WAITING: 2, CALLED: 1, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
      nextUp: { queueId: 'queue-entry-1', queueNumber: 1, registrationId: 'registration-1', participantDisplayName: 'Aisha Binte Rahman', isPriority: true },
    },
  ],
  entries: [
    {
      id: 'queue-entry-1',
      queueNumber: 1,
      status: 'WAITING',
      isPriority: true,
      priorityNotes: 'Needs an interpreter.',
      registrationId: 'registration-1',
      participantDisplayName: 'Aisha Binte Rahman',
      participantReference: 'P-2026-0001',
      stationId: 'station-visual-acuity',
      stationName: 'Visual Acuity',
      stationType: 'VISUAL_ACUITY',
      enteredAt: '2026-08-20T01:05:00.000Z',
      calledAt: null,
      startedAt: null,
      completedAt: null,
    },
    {
      id: 'queue-entry-2',
      queueNumber: 2,
      status: 'CALLED',
      isPriority: false,
      priorityNotes: null,
      registrationId: 'registration-2',
      participantDisplayName: 'Marcus Goh Wei Liang',
      participantReference: 'P-2026-0002',
      stationId: 'station-visual-acuity',
      stationName: 'Visual Acuity',
      stationType: 'VISUAL_ACUITY',
      enteredAt: '2026-08-20T01:10:00.000Z',
      calledAt: '2026-08-20T01:20:00.000Z',
      startedAt: null,
      completedAt: null,
    },
    {
      id: 'queue-entry-3',
      queueNumber: 3,
      status: 'WAITING',
      isPriority: false,
      priorityNotes: null,
      registrationId: 'registration-3',
      participantDisplayName: 'Tan Mei Ling',
      participantReference: 'P-2026-0003',
      stationId: 'station-visual-acuity',
      stationName: 'Visual Acuity',
      stationType: 'VISUAL_ACUITY',
      enteredAt: '2026-08-20T01:12:00.000Z',
      calledAt: null,
      startedAt: null,
      completedAt: null,
    },
  ],
};

export const publicPassStatusResponse = {
  success: true,
  data: {
    valid: true,
    eventName: 'Choa Chu Kang Community Screening',
    queueNumber: 3,
    currentQueueNumber: 1,
    queueState: {
      status: 'WAITING',
      station: { id: 'station-visual-acuity', type: 'VISUAL_ACUITY', name: 'Visual Acuity' },
      queueNumber: 3,
    },
    aheadAtStation: 1,
    stations: [
      {
        stationId: 'station-visual-acuity',
        stationName: 'Visual Acuity',
        workload: { WAITING: 2, CALLED: 1, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
        nextUp: { queueNumber: 1 },
      },
    ],
    transfers: [],
    expiresAt: '2026-08-20T23:59:59.000Z',
    registrationStatus: 'CHECKED_IN',
  },
};

export const qrPassResponse = {
  success: true,
  data: {
    qrId: 'qr-100001',
    registrationId: REGISTRATION_ID,
    issuedAt: '2026-08-20T01:00:00.000Z',
    expiresAt: '2026-08-20T23:59:59.000Z',
    qrImage: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
  },
};
