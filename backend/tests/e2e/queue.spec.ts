import { expect, test } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';
import { fulfillJson, installApiMocks } from './helpers/mockApi';
import { accountWithRegistrationMembership, eventDetailForGuard, EVENT_ID, queueStatusResponse } from './fixtures';

test.describe('Registration officer live queue', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page);
    await installApiMocks(page, {
      [`GET /events/${EVENT_ID}`]: (route) => fulfillJson(route, eventDetailForGuard),
      'GET /account': (route) => fulfillJson(route, accountWithRegistrationMembership),
      [`GET /queues/events/${EVENT_ID}`]: (route) => fulfillJson(route, queueStatusResponse),
    });
  });

  test('shows now-serving, station workload, and queue entries', async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}/queue`);

    await expect(page.getByRole('heading', { name: 'Choa Chu Kang Community Screening — Live queue' })).toBeVisible();

    await expect(page.locator('.mx-auto').getByText('Now serving')).toBeVisible();
    await expect(page.getByText('Queue #2')).toBeVisible();
    await expect(page.getByText('Marcus Goh Wei Liang').first()).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Station workload' })).toBeVisible();
    await expect(page.getByText('2 waiting · 1 called · 0 in progress')).toBeVisible();
    await expect(page.getByText('Next up #1 · priority')).toBeVisible();

    await expect(page.getByText('Aisha Binte Rahman')).toBeVisible();
    await expect(page.getByText('Tan Mei Ling')).toBeVisible();
    await expect(page.getByText('P-2026-0001')).toBeVisible();
    await expect(page.getByText('3 matching entries')).toBeVisible();
  });
});
