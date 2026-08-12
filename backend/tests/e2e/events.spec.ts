import { expect, test } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';
import { fulfillJson, installApiMocks } from './helpers/mockApi';
import { upcomingEvent } from './fixtures';

test.describe('Authenticated events workspace', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page);
  });

  test('renders upcoming events with status and capacity', async ({ page }) => {
    await installApiMocks(page, {
      'GET /events': (route) => fulfillJson(route, { events: [upcomingEvent] }),
    });

    await page.goto('/events');

    await expect(page.getByRole('heading', { name: 'Choa Chu Kang Community Screening' })).toBeVisible();
    await expect(page.getByText('Choa Chu Kang Community Club')).toBeVisible();
    await expect(page.getByText('42 checked in / 120 capacity').first()).toBeVisible();
    await expect(page.getByRole('article', { name: 'Choa Chu Kang Community Screening, status Assigned' })).toBeVisible();
  });

  test('filters the event list by search', async ({ page }) => {
    await installApiMocks(page, {
      'GET /events': (route) => fulfillJson(route, { events: [upcomingEvent] }),
    });

    await page.goto('/events');

    const search = page.getByPlaceholder('Search events or venues');
    await search.fill('community');
    await expect(page.getByText('Choa Chu Kang Community Screening')).toBeVisible();

    await search.fill('jupiter');
    await expect(page.getByRole('heading', { name: 'No events found' })).toBeVisible();
  });

  test('shows the empty state for staff with no events', async ({ page }) => {
    await installApiMocks(page, {
      'GET /events': (route) => fulfillJson(route, { events: [] }),
    });

    await page.goto('/events');

    await expect(page.getByRole('heading', { name: 'No upcoming events' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Create event/ })).toBeVisible();
  });
});

test.describe('Guest access to the events workspace', () => {
  test('redirects guests to the sign-in flow', async ({ page }) => {
    await installApiMocks(page, {
      'GET /auth/authorize': (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Sign in</title>' }),
    });

    await page.goto('/events');
    await expect(page).toHaveURL(/\/api\/v1\/auth\/authorize/);
  });
});
