const { test, expect } = require('@playwright/test');

test.use({ ignoreHTTPSErrors: true });

test.describe('VSMS - Complete Service Handoff Journey', () => {

  test('full user journey: Login -> Scan QR -> Review Vehicle -> Mark Complete', async ({ page }) => {
    // 1. User arrives and logs in
    await page.goto('https://localhost:5173/login');
    await page.fill('input[name="username"]', 'staff_user');
    await page.fill('input[name="password"]', 'securePassword123');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('https://localhost:5173/dashboard');

    // 2. User navigates to the QR scanner section
    await page.click('a[href="/handoff"]');
    await expect(page).toHaveURL('https://localhost:5173/handoff');

    // 3. User submits a scanned QR code
    await page.fill('input[data-testid="qr-input"]', 'VSMS-HANDOFF-TOKEN-89123');
    await page.click('button[data-testid="submit-handoff"]');

    // 4. User is redirected to the Vehicle Inspection page
    await expect(page).toHaveURL(/.*\/vehicle-details/);
    await expect(page.locator('#vehicle-plate')).toHaveText('ABC-1234');

    // 5. User updates status and completes handoff
    await page.selectOption('select[name="status"]', 'Completed');
    await page.click('button[data-testid="save-status"]');

    // 6. Verify returning to dashboard with updated status
    await page.goto('https://localhost:5173/dashboard');
    await expect(page.locator('.recent-activity')).toContainText('ABC-1234 Completed');
  });

});