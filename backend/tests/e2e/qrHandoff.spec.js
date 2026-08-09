const { test, expect } = require('@playwright/test');

// Tell Playwright to ignore self-signed HTTPS certificate errors on localhost
test.use({ ignoreHTTPSErrors: true });

test.describe('VSMS - QR Handoff E2E Flow', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Navigate to your local Vite dev server
    await page.goto('https://localhost:5173/login');
    await page.fill('input[name="username"]', 'staff_user');
    await page.fill('input[name="password"]', 'securePassword123');
    await page.click('button[type="submit"]');

    // Verify successful login navigation
    await expect(page).toHaveURL('https://localhost:5173/dashboard');
  });

  test('should successfully scan/submit a QR handoff token and extract vehicle info', async ({ page }) => {
    // 2. Navigate to the QR Handoff route on port 5173
    await page.goto('https://localhost:5173/handoff');

    // 3. Simulate entering or scanning a QR handoff token
    const mockQrData = 'VSMS-HANDOFF-TOKEN-89123';
    await page.fill('input[data-testid="qr-input"]', mockQrData);
    await page.click('button[data-testid="submit-handoff"]');

    // 4. Assert that the extraction succeeded and details are visible
    const successBanner = page.locator('.status-message');
    await expect(successBanner).toContainText('QR Handoff Extracted Successfully');

    // 5. Verify extracted details displayed on page
    await expect(page.locator('#vehicle-plate')).toHaveText('ABC-1234');
    await expect(page.locator('#handoff-status')).toHaveText('Ready for Service');
  });

});