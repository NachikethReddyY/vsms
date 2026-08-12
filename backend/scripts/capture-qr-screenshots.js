const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const { chromium } = require('@playwright/test');
const QRCode = require('qrcode');

const APP_URL = 'https://localhost:5173';
const DASHBOARD_DIR = path.resolve(__dirname, '../../react-user-dashboard');
const OUT_DIR = path.resolve(__dirname, '../qr-report-screenshots');

const EVENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const REGISTRATION_ID = 'c19a6f8a-4a6f-4a9e-b2b0-3c1f9c2d5a6b';

// Test-only token generated at runtime.
// This is not a real credential or production secret.
const PASS_TOKEN = `test-pass-${Date.now()}`;

const STAFF_SESSION = {
  user: {
    id: 'user-100001',
    username: 'staff@vsms.test',
    email: 'staff@vsms.test',
    fullName: 'Lena Tan',
    roles: [
      'ADMINISTRATOR',
      'REGISTRATION_OFFICER',
      'SCREENER',
      'REVIEWER',
    ],
    approvalState: 'APPROVED',
    accessState: 'ENABLED',
  },
  expiresAt: Date.now() + 60 * 60 * 1000,
};

const eventDetailForGuard = {
  eventId: EVENT_ID,
  name: 'Choa Chu Kang Community Screening',
  version: 1,
  status: 'PUBLISHED',
  canManage: false,
  shifts: [],
  eventStations: [],
};

const accountFor = (roles) => ({
  account: {
    id: 'user-100001',
    userId: 'user-100001',
    fullName: 'Lena Tan',
    email: 'staff@vsms.test',
    approvalState: 'APPROVED',
    accessState: 'ENABLED',
    roles: [
      'ADMINISTRATOR',
      'REGISTRATION_OFFICER',
      'SCREENER',
      'REVIEWER',
    ],
    eventMemberships: [
      {
        id: 'membership-1',
        eventId: EVENT_ID,
        status: 'ACTIVE',
        roles,
      },
    ],
  },
});

const verifyResult = {
  success: true,
  data: {
    valid: true,
    qrId: 'qr-100001',
    registrationId: REGISTRATION_ID,
    participant: {
      id: 'participant-1',
      firstName: 'Aisha',
      lastName: 'Binte Rahman',
    },
    event: {
      id: EVENT_ID,
      name: 'Choa Chu Kang Community Screening',
    },
    queueNumber: 3,
  },
};

const publicStatusCall = {
  success: true,
  data: {
    eventId: EVENT_ID,
    eventName: 'Choa Chu Kang Community Screening',
    valid: true,
    currentQueueNumber: 3,
    queueNumber: 3,
    queueState: {
      status: 'CALLED',
      queueNumber: 3,
      isPriority: false,
      station: {
        id: 'station-va',
        name: 'Visual Acuity',
        type: 'VISUAL_ACUITY',
      },
    },
    aheadAtStation: 0,
    stations: [
      {
        stationId: 'station-va',
        stationName: 'Visual Acuity',
        workload: {
          WAITING: 2,
          CALLED: 1,
          IN_PROGRESS: 1,
        },
        nextUp: {
          queueNumber: 4,
        },
      },
      {
        stationId: 'station-ref',
        stationName: 'Refraction',
        workload: {
          WAITING: 3,
          CALLED: 0,
          IN_PROGRESS: 0,
        },
        nextUp: {
          queueNumber: 5,
        },
      },
      {
        stationId: 'station-cv',
        stationName: 'Colour Vision',
        workload: {
          WAITING: 0,
          CALLED: 0,
          IN_PROGRESS: 0,
        },
        nextUp: null,
      },
    ],
    transfers: [
      {
        fromStation: 'Registration',
        toStation: 'Visual Acuity',
      },
    ],
    expiresAt: '2026-08-20T23:59:59.000Z',
    registrationStatus: 'CHECKED_IN',
  },
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

  serverProcess = spawn(
    'pnpm',
    ['dev'],
    {
      cwd: DASHBOARD_DIR,
      stdio: 'ignore',
      shell: true,
    },
  );

  for (let i = 0; i < 90; i += 1) {
    if (await isServerUp()) return;

    await sleep(1000);
  }

  throw new Error(
    'Vite dev server did not become ready on https://localhost:5173',
  );
}

async function seedSession(context) {
  await context.addInitScript((session) => {
    window.sessionStorage.setItem(
      'vsms_staff_session',
      JSON.stringify(session),
    );
  }, STAFF_SESSION);
}

function installApiMocks(page, handlers) {
  return page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());

    const pathname =
      url.pathname.replace(/^\/api\/v1/, '') || '/';

    const method = route.request().method().toUpperCase();

    const handler = handlers[`${method} ${pathname}`];

    if (!handler) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: `Unmocked: ${method} ${pathname}`,
        }),
      });
    }

    return handler(route);
  });
}

/**
 * Headless browsers have no camera. Inject a fake getUserMedia/enumerateDevices
 * so the html5-qrcode scanner UI renders its scanning frame instead of an error.
 */
async function fakeCamera(page) {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices || {};
    if (!media.getUserMedia) {
      media.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#101013';
          ctx.fillRect(0, 0, 1280, 720);
          ctx.strokeStyle = '#2a2a30';
          ctx.lineWidth = 2;
          for (let x = 0; x <= 1280; x += 64) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 720); ctx.stroke();
          }
          for (let y = 0; y <= 720; y += 64) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1280, y); ctx.stroke();
          }
        }
        return canvas.captureStream(30);
      };
    }
    if (!media.enumerateDevices) {
      media.enumerateDevices = async () => [
        {
          deviceId: 'fake-camera-0',
          kind: 'videoinput',
          label: 'Fake Camera',
          groupId: 'fake-group-0',
        },
      ];
    }
  });
}

async function capture(
  browser,
  {
    name,
    session = false,
    mocks = {},
    url,
    init,
    setup,
    waitFor,
    viewport,
  },
) {
  const context = await browser.newContext({
    viewport: viewport ?? {
      width: 1440,
      height: 900,
    },
    deviceScaleFactor: viewport ? 2 : 1,
    ignoreHTTPSErrors: true,
  });

  if (session) {
    await seedSession(context);
  }

  const page = await context.newPage();

  await installApiMocks(page, mocks);

  if (init) {
    await init(page);
  }

  await page.goto(APP_URL + url);

  if (waitFor) {
    await page.waitForSelector(waitFor, {
      timeout: 20_000,
    });
  }

  if (setup) {
    await setup(page);
  }

  const outPath = path.join(OUT_DIR, name);

  await page.screenshot({
    path: outPath,
    fullPage: true,
  });

  await context.close();

  console.log(`Saved ${outPath}`);

  return outPath;
}

async function main() {
  fs.mkdirSync(OUT_DIR, {
    recursive: true,
  });

  await ensureDevServer();

  const qrImage = await QRCode.toDataURL(
    `https://localhost:5173/participant-status/${PASS_TOKEN}`,
    {
      width: 320,
    },
  );

  const browser = await chromium.launch({
    ignoreHTTPSErrors: true,
  });

  const guardMocks = (roles) => ({
    [`GET /events/${EVENT_ID}`]: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(eventDetailForGuard),
      }),

    'GET /account': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(accountFor(roles)),
      }),
  });

  // Figure: QR Code Generation Interface
  await capture(browser, {
    name: 'qr-generation-interface.png',
    session: true,

    mocks: {
      ...guardMocks(['REGISTRATION_OFFICER']),

      [`POST /qr/generate/${REGISTRATION_ID}`]: (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              qrId: 'qr-100001',
              registrationId: REGISTRATION_ID,
              issuedAt: '2026-08-20T01:00:00.000Z',
              expiresAt: '2026-08-20T23:59:59.000Z',
              qrImage,
            },
          }),
        }),
    },

    url: `/qr-generator?eventId=${EVENT_ID}`,

    waitFor: 'text=Generate new pass',

    setup: async (page) => {
      await page
        .locator('#registration-id')
        .fill(REGISTRATION_ID);

      await page
        .getByRole('button', {
          name: /Generate new pass/,
        })
        .click();

      await page.waitForSelector('text=Pass ready');
    },
  });

  // Figure: QR Code Scanning Interface (staff camera scanner)
  await capture(browser, {
    name: 'qr-scanning-interface.png',
    session: true,

    init: fakeCamera,

    mocks: guardMocks(['SCREENER']),

    url: `/qr-scanner?eventId=${EVENT_ID}`,

    waitFor: 'text=Hold the QR inside the frame',

    setup: async (page) => {
      await page.waitForTimeout(1200);
    },
  });

  // Figure: QR Code Validation Result
  await capture(browser, {
    name: 'qr-validation-result.png',
    session: true,

    mocks: {
      ...guardMocks(['SCREENER']),

      'POST /qr/verify': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(verifyResult),
        }),
    },

    url: `/qr-scanner?eventId=${EVENT_ID}`,

    waitFor: 'text=Scan participant QR',

    setup: async (page) => {
      await page
        .locator('#qr-scan-input')
        .fill(PASS_TOKEN);

      await page
        .getByRole('button', {
          name: 'Verify',
          exact: true,
        })
        .click();

      await page.waitForSelector(
        'text=Open station with this participant',
      );
    },
  });

  // Figure: QR scan target — participant queue status (phone viewport)
  await capture(browser, {
    name: 'qr-scanning-queue-status.png',
    session: false,

    viewport: {
      width: 390,
      height: 844,
    },

    mocks: {
      [`GET /qr/public-status/${PASS_TOKEN}`]: (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(publicStatusCall),
        }),
    },

    url: `/participant-status/${PASS_TOKEN}`,

    waitFor: 'text=Your queue number',

    setup: async (page) => {
      await page.waitForSelector('.ps-state-card');

      await page.waitForSelector('.ps-stations');

      await page.waitForTimeout(400);
    },
  });

  await browser.close();

  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);

  if (serverProcess) {
    serverProcess.kill();
  }

  process.exit(1);
});
