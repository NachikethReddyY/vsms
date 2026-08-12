import { expect, test } from '@playwright/test';
import { fulfillJson, installApiMocks } from './helpers/mockApi';
import { PASS_TOKEN, publicPassStatusResponse } from './fixtures';

test.describe('Public participant pass status', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      [`GET /qr/public-status/${PASS_TOKEN}`]: (route) => fulfillJson(route, publicPassStatusResponse),
    });
  });

  test('shows the stable assigned route without exposing event workload', async ({ page }) => {
    await page.goto(`/participant-status/${PASS_TOKEN}`);

    await expect(page.getByText('Valid pass')).toBeVisible();
    await expect(page.getByText('You are in the queue')).toBeVisible();
    await expect(page.getByText('Go to Visual Acuity · queue #3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your event route' })).toBeVisible();
    await expect(page.getByText('Refraction')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Station workload' })).toHaveCount(0);
    await expect(page.getByText('Show a screener pass')).toHaveCount(0);
    await expect(page.getByText('No personal information is shown on this page.')).toBeVisible();
  });
});
