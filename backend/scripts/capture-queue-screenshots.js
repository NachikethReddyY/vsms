const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const { chromium } = require('@playwright/test');

const APP_URL = 'https://localhost:5173';
const DASHBOARD_DIR = path.resolve(__dirname, '../../react-user-dashboard');
const OUT_DIR = path.resolve(__dirname, '../queue-report-screenshots');

const EVENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const REGISTRATION_ID = 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6b';

const STAFF_SESSION = {
  user: {
    id: 'user-100001',
    username: 'staff@vsms.test',
    email: 'staff@vsms.test',
    fullName: 'Lena Tan',
    roles: ['ADMINISTRATOR', 'REGISTRATION_OFFICER', 'SCREENER', 'REVIEWER'],
    approvalState: 'APPROVED',
    accessState: 'ENABLED',
    eventMemberships: [
      {
        id: 'membership-1',
        eventId: EVENT_ID,
        status: 'ACTIVE',
        roles: ['ADMINISTRATOR', 'REGISTRATION_OFFICER', 'SCREENER', 'REVIEWER'],
      },
    ],
  },
  expiresAt: Date.now() + 60 * 60 * 1000,
};

const eventDetailForGuard = {
  eventId: EVENT_ID,
  name: 'Choa Chu Kang Community Screening',
  version: 1,
  status: 'IN_PROGRESS',
  canManage: true,
  shifts: [],
  eventStations: [],
};

const accountForGuard = {
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
        roles: ['ADMINISTRATOR', 'REGISTRATION_OFFICER', 'SCREENER', 'REVIEWER'],
      },
    ],
  },
};

const queueStatus = {
  event: { eventId: EVENT_ID, name: 'Choa Chu Kang Community Screening', status: 'IN_PROGRESS', venue: 'Hall A, CCK Sports Centre' },
  stations: [
    {
      stationId: 'station-va',
      stationName: 'Visual Acuity',
      stationType: 'VISUAL_ACUITY',
      stationOrder: 1,
      workload: { WAITING: 2, CALLED: 1, IN_PROGRESS: 0, COMPLETED: 6, SKIPPED: 0, CANCELLED: 0 },
      nextUp: { queueId: 'q-va-4', queueNumber: 4, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6c', participantDisplayName: 'Ming Wei Tan', isPriority: false },
    },
    {
      stationId: 'station-ref',
      stationName: 'Refraction',
      stationType: 'REFRACTION',
      stationOrder: 2,
      workload: { WAITING: 3, CALLED: 0, IN_PROGRESS: 2, COMPLETED: 4, SKIPPED: 1, CANCELLED: 0 },
      nextUp: { queueId: 'q-ref-8', queueNumber: 8, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6d', participantDisplayName: 'Priya Nair', isPriority: true },
    },
    {
      stationId: 'station-cv',
      stationName: 'Colour Vision',
      stationType: 'COLOUR_VISION',
      stationOrder: 3,
      workload: { WAITING: 0, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 7, SKIPPED: 0, CANCELLED: 0 },
      nextUp: null,
    },
    {
      stationId: 'station-eh',
      stationName: 'Eye Health',
      stationType: 'EYE_HEALTH',
      stationOrder: 4,
      workload: { WAITING: 1, CALLED: 0, IN_PROGRESS: 1, COMPLETED: 5, SKIPPED: 0, CANCELLED: 0 },
      nextUp: { queueId: 'q-eh-12', queueNumber: 12, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6e', participantDisplayName: 'Siti Aminah', isPriority: false },
    },
  ],
  entries: [
    { id: 'q-va-1', queueNumber: 1, status: 'WAITING', isPriority: false, priorityNotes: null, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6f', participantDisplayName: 'Ah Kow Lim', participantReference: 'REF-200121', stationId: 'station-va', stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY', enteredAt: '2026-08-12T09:02:00.000Z' },
    { id: 'q-va-2', queueNumber: 2, status: 'WAITING', isPriority: true, priorityNotes: 'Elderly, assisted walking', registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a70', participantDisplayName: 'Yusof bin Hassan', participantReference: 'PRI-900118', stationId: 'station-va', stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY', enteredAt: '2026-08-12T09:05:00.000Z' },
    { id: 'q-va-3', queueNumber: 3, status: 'CALLED', isPriority: false, priorityNotes: null, registrationId: REGISTRATION_ID, participantDisplayName: 'Aisha Binte Rahman', participantReference: 'REF-200077', stationId: 'station-va', stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY', enteredAt: '2026-08-12T09:10:00.000Z', calledAt: '2026-08-12T09:18:00.000Z' },
    { id: 'q-ref-4', queueNumber: 4, status: 'WAITING', isPriority: false, priorityNotes: null, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6c', participantDisplayName: 'Ming Wei Tan', participantReference: 'REF-200153', stationId: 'station-ref', stationName: 'Refraction', stationType: 'REFRACTION', enteredAt: '2026-08-12T09:12:00.000Z' },
    { id: 'q-ref-5', queueNumber: 5, status: 'IN_PROGRESS', isPriority: false, priorityNotes: null, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a71', participantDisplayName: 'Devi Krishnan', participantReference: 'REF-200088', stationId: 'station-ref', stationName: 'Refraction', stationType: 'REFRACTION', enteredAt: '2026-08-12T09:14:00.000Z', calledAt: '2026-08-12T09:20:00.000Z', startedAt: '2026-08-12T09:21:00.000Z' },
    { id: 'q-cv-6', queueNumber: 6, status: 'COMPLETED', isPriority: false, priorityNotes: null, registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a72', participantDisplayName: 'Wei Jie Low', participantReference: 'REF-200019', stationId: 'station-cv', stationName: 'Colour Vision', stationType: 'COLOUR_VISION', enteredAt: '2026-08-12T08:50:00.000Z', leftQueueAt: '2026-08-12T09:25:00.000Z', completedAt: '2026-08-12T09:25:00.000Z' },
  ],
};

const stationsPayload = {
  event: { eventId: EVENT_ID, name: 'Choa Chu Kang Community Screening', status: 'IN_PROGRESS', venue: 'Hall A, CCK Sports Centre' },
  stations: [
    { stationId: 'station-va', eventId: EVENT_ID, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY', stationOrder: 1, isActive: true },
    { stationId: 'station-ref', eventId: EVENT_ID, stationName: 'Refraction', stationType: 'REFRACTION', stationOrder: 2, isActive: true },
    { stationId: 'station-cv', eventId: EVENT_ID, stationName: 'Colour Vision', stationType: 'COLOUR_VISION', stationOrder: 3, isActive: true },
    { stationId: 'station-eh', eventId: EVENT_ID, stationName: 'Eye Health', stationType: 'EYE_HEALTH', stationOrder: 4, isActive: true },
  ],
};

const stationQueuePayload = {
  station: stationsPayload.stations[0],
  registrations: [
    { registrationId: REGISTRATION_ID, participantDisplayName: 'Aisha Binte Rahman', queueNumber: 3, status: 'CALLED', passToken: 'ab'.repeat(32), existingResult: null },
    { registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6f', participantDisplayName: 'Ah Kow Lim', queueNumber: 1, status: 'WAITING', passToken: 'ab'.repeat(32), existingResult: null },
    { registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a70', participantDisplayName: 'Yusof bin Hassan', queueNumber: 2, status: 'WAITING', passToken: 'ab'.repeat(32), existingResult: null },
    { registrationId: 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a73', participantDisplayName: 'Chloe Ong', queueNumber: 4, status: 'WAITING', passToken: 'ab'.repeat(32), existingResult: null },
  ],
};

const guardMocks = {
  'GET /account': (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accountForGuard) }),
  [`GET /events/${EVENT_ID}`]: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventDetailForGuard) }),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isServerUp() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'localhost',
        port: 5173,
        path: '/',
        method: 'HEAD',
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      },
    );
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

let serverProcess = null;

async function ensureDevServer() {
  if (await isServerUp()) return;
  console.log('Starting Vite dev server…');
  serverProcess = spawn('pnpm', ['dev'], { cwd: DASHBOARD_DIR, stdio: 'ignore', shell: true });
  for (let i = 0; i < 90; i += 1) {
    if (await isServerUp()) return;
    await sleep(1000);
  }
  throw new Error('Vite dev server did not become ready on https://localhost:5173');
}

async function seedSession(context) {
  await context.addInitScript((session) => {
    window.sessionStorage.setItem('vsms_staff_session', JSON.stringify(session));
  }, STAFF_SESSION);
}

function installApiMocks(page, handlers) {
  return page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/api\/v1/, '') || '/';
    const method = route.request().method().toUpperCase();
    const handler = handlers[`${method} ${pathname}`];
    if (!handler) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unmocked: ${method} ${pathname}` }) });
    }
    return handler(route);
  });
}

async function capture(browser, { name, mocks, url, waitFor, viewport }) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: viewport ? 2 : 1,
    ignoreHTTPSErrors: true,
  });
  await seedSession(context);
  const page = await context.newPage();
  await installApiMocks(page, mocks);
  await page.goto(APP_URL + url);
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 25_000 });
  await page.waitForTimeout(600);
  const outPath = path.join(OUT_DIR, name);
  await page.screenshot({ path: outPath, fullPage: true });
  await context.close();
  console.log(`Saved ${outPath}`);
  return outPath;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await ensureDevServer();
  const browser = await chromium.launch({ ignoreHTTPSErrors: true });

  // Staff view — live queue management
  await capture(browser, {
    name: 'queue-management.png',
    mocks: {
      ...guardMocks,
      [`GET /queues/events/${EVENT_ID}`]: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(queueStatus) }),
    },
    url: `/events/${EVENT_ID}/queue`,
    waitFor: 'text=Station workload',
  });

  // Staff view — screening station workflow with a participant pre-loaded after a QR scan
  await capture(browser, {
    name: 'station-workflow.png',
    mocks: {
      ...guardMocks,
      [`GET /events/${EVENT_ID}/stations`]: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stationsPayload) }),
      [`GET /events/${EVENT_ID}/stations/station-va/queue`]: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stationQueuePayload) }),
    },
    url: `/events/${EVENT_ID}/stations/visual-acuity?registrationId=${REGISTRATION_ID}`,
    waitFor: 'text=Find participant',
  });

  await browser.close();
  if (serverProcess) serverProcess.kill();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  if (serverProcess) serverProcess.kill();
  process.exit(1);
});