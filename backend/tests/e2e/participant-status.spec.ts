import { expect, test } from '@playwright/test';
import { fulfillJson, installApiMocks } from './helpers/mockApi';
import { PASS_TOKEN, publicPassStatusResponse } from './fixtures';

test.describe('Public participant pass status', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      [`GET /qr/public-status/${PASS_TOKEN}`]: (route) => fulfillJson(route, publicPassStatusResponse),
      [`GET /qr/handoff/${PASS_TOKEN}`]: (route) =>
        fulfillJson(route, {
          success: true,
          data: { qrImage: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==' },
        }),
    });
  });

  test('shows queue position and station workload without personal data', async ({ page }) => {
    await page.goto(`/participant-status/${PASS_TOKEN}`);

    await expect(page.getByText('Valid pass')).toBeVisible();
    await expect(page.getByText('You are in the queue')).toBeVisible();
    await expect(page.getByText('Go to Visual Acuity station · queue #3')).toBeVisible();
    await expect(page.getByText('1 person ahead at this station.')).toBeVisible();

    await expect(page.locator('.ps-queue-now')).toContainText('#1');
    await expect(page.locator('.ps-queue-yours')).toContainText('#3');

    await expect(page.getByRole('heading', { name: 'Station workload' })).toBeVisible();
    await expect(page.getByText('2 waiting')).toBeVisible();
    await expect(page.getByText('1 called')).toBeVisible();
    await expect(page.getByText('0 in progress')).toBeVisible();
    await expect(page.getByText('No personal information is shown on this page.')).toBeVisible();
  });

  test('creates a screener handoff pass from the dialog', async ({ page }) => {
    await page.goto(`/participant-status/${PASS_TOKEN}`);

    await page.getByText('Show a screener pass').click();
    await expect(page.getByRole('heading', { name: 'Screener pass' })).toBeVisible();

    await page.getByRole('button', { name: 'Visual Acuity' }).click();
    await expect(page.getByAltText('Screener pass QR code')).toBeVisible();
    await expect(page.getByText('No personal information is stored in the code.')).toBeVisible();
  });
});
