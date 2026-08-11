/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../utils/apiClient', () => ({
  default: { get, post: vi.fn(), patch: vi.fn() },
  getApiError: (_cause: unknown, fallback: string) => fallback,
}));

import StaffAccountsPage from './StaffAccountsPage';

function polyfillDialog() {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

beforeEach(() => {
  polyfillDialog();
  get.mockReset();
  get.mockResolvedValue({ data: { success: true, data: [{ id: 'user-1', fullName: 'VSMS Admin', email: 'admin@vsms.local', status: 'ACTIVE', approvalState: 'APPROVED', accessState: 'ENABLED', roles: ['ADMINISTRATOR'] }] } });
});

afterEach(cleanup);

it('keeps list controls at the top and discloses role guidance in a dialog', async () => {
  render(<StaffAccountsPage />);
  expect(await screen.findByText('VSMS Admin')).toBeTruthy();

  const refresh = screen.getByRole('button', { name: 'Refresh list' });
  const directory = screen.getByRole('region', { name: 'Organisation staff accounts' });
  expect(refresh.compareDocumentPosition(directory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Role access' }));
  const dialog = await screen.findByRole('dialog', { name: 'Role access' });
  expect(within(dialog).getByText('Administrator')).toBeTruthy();
  expect(within(dialog).getByText('Support')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close Role access' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Role access' })).toBeNull());

  await userEvent.click(refresh);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
