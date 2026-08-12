import { expect, test } from '@playwright/test';
import { fulfillJson, installApiMocks } from './helpers/mockApi';

test.describe('Public landing page', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      'GET /auth/config-status': (route) =>
        fulfillJson(route, { configured: true, publicSignupEnabled: true }),
    });
  });

  test('renders the hero and public actions', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Keep the day moving.' })).toBeVisible();
    await expect(page.getByText('Sign in to VSMS').first()).toBeVisible();
    await expect(page.getByText('Screening support, not diagnosis.')).toBeVisible();
    await expect(page.getByText('Team Cryptics')).toBeVisible();
  });

  test('navigates to public account creation when sign-up is enabled', async ({ page }) => {
    await page.goto('/');

    await page.getByText('Sign up').click();
    await expect(page).toHaveURL(/\/create-account$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Create your VSMS account' })).toBeVisible();
  });
});
