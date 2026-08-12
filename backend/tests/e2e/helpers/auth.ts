import type { Page } from '@playwright/test';

export interface E2eUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  approvalState: 'APPROVED';
  accessState: 'ENABLED';
  department?: string | null;
  designation?: string | null;
}

export const STAFF_USER: E2eUser = {
  id: 'user-100001',
  email: 'staff@vsms.test',
  fullName: 'Lena Tan',
  roles: ['ADMINISTRATOR', 'REGISTRATION_OFFICER', 'SCREENER', 'REVIEWER'],
  approvalState: 'APPROVED',
  accessState: 'ENABLED',
  department: null,
  designation: null,
};

/**
 * Seeds a valid auth session into sessionStorage before the app boots.
 * Because no CSRF cookie is present, AuthProvider skips the /auth/refresh
 * call and keeps this session, so specs never touch the real Cognito flow.
 */
export async function seedAuthenticatedSession(page: Page, user: E2eUser = STAFF_USER) {
  const session = {
    user: { ...user, username: user.email },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  await page.addInitScript((value) => {
    window.sessionStorage.setItem('vsms_staff_session', JSON.stringify(value));
  }, session);
}
