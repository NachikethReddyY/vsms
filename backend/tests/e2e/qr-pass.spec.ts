import { expect, test } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';
import { fulfillJson, installApiMocks } from './helpers/mockApi';
import { accountWithRegistrationMembership, EVENT_ID, eventDetailForGuard, qrPassResponse, REGISTRATION_ID } from './fixtures';

test.describe('Participant QR pass generator', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page);
    await installApiMocks(page, {
      [`GET /events/${EVENT_ID}`]: (route) => fulfillJson(route, eventDetailForGuard),
      'GET /account': (route) => fulfillJson(route, accountWithRegistrationMembership),
      [`POST /qr/generate/${REGISTRATION_ID}`]: (route) => fulfillJson(route, qrPassResponse),
      'PUT /qr/revoke/qr-100001': (route) => fulfillJson(route, { success: true }),
    });
  });

  test('generates a pass and then revokes it', async ({ page }) => {
    await page.goto(`/qr-generator?eventId=${EVENT_ID}`);

    await page.locator('#registration-id').fill(REGISTRATION_ID);
    await page.getByRole('button', { name: /Generate new pass/ }).click();

    await expect(page.getByRole('heading', { name: 'Pass ready' })).toBeVisible();
    await expect(page.getByText(/^Expires/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();

    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('button', { name: 'Confirm revoke' })).toBeVisible();

    await page.getByRole('button', { name: 'Confirm revoke' }).click();
    await expect(page.getByRole('heading', { name: 'No pass generated' })).toBeVisible();
  });
});
