/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('../utils/apiClient', () => ({
  default: { get, post, patch },
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
  post.mockReset();
  patch.mockReset();
  get.mockResolvedValue({ data: { success: true, data: [{ id: 'user-1', fullName: 'VSMS Admin', email: 'admin@vsms.local', status: 'ACTIVE', approvalState: 'APPROVED', accessState: 'ENABLED', roles: ['ADMINISTRATOR'] }] } });
});

it('preserves existing roles when an administrator edits profile fields only', async () => {
  const member = { id: 'user-1', fullName: 'Legacy Staff', email: 'staff@vsms.local', employeeNumber: 'S001', status: 'ACTIVE', approvalState: 'APPROVED', accessState: 'ENABLED', roles: ['REGISTRATION_OFFICER', 'SCREENER'] };
  get.mockResolvedValue({ data: { success: true, data: [member] } });
  patch.mockResolvedValue({ data: { success: true, data: { ...member, fullName: 'Updated Staff' } } });
  render(<StaffAccountsPage />);
  expect(await screen.findByText('Legacy Staff')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit Legacy Staff' });
  await userEvent.clear(within(dialog).getByLabelText('Full name'));
  await userEvent.type(within(dialog).getByLabelText('Full name'), 'Updated Staff');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0][1]).not.toHaveProperty('roles');
  expect(patch.mock.calls[0][1]).not.toHaveProperty('professionalCategory');
});

it('creates staff without asking for or submitting an employee number', async () => {
  post.mockResolvedValue({ data: { success: true, data: {
    id: 'user-2',
    fullName: 'Aryaa Tan',
    email: 'aryaa@vsms.cloud',
    employeeNumber: 'STF-1234567890ABCDEF',
    status: 'ACTIVE',
    approvalState: 'APPROVED',
    accessState: 'ENABLED',
    roles: ['SUPPORT'],
  } } });
  render(<StaffAccountsPage />);
  expect(await screen.findByText('VSMS Admin')).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Add staff member' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add staff member' });
  expect(within(dialog).queryByLabelText(/employee number/i)).toBeNull();
  expect(within(dialog).getByText(/employee number is generated automatically/i)).toBeTruthy();
  expect((within(dialog).getByRole('radio', { name: /activate later/i }) as HTMLInputElement).checked).toBe(true);

  await userEvent.type(within(dialog).getByLabelText('Full name'), 'Aryaa Tan');
  await userEvent.type(within(dialog).getByLabelText('Work email'), 'aryaa@vsms.cloud');
  await userEvent.click(within(dialog).getByRole('radio', { name: /active now/i }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe('/users');
  expect(post.mock.calls[0][1]).toMatchObject({
    fullName: 'Aryaa Tan',
    email: 'aryaa@vsms.cloud',
    status: 'ACTIVE',
    roles: ['SUPPORT'],
  });
  expect(post.mock.calls[0][1]).not.toHaveProperty('employeeNumber');
});

afterEach(cleanup);

it('keeps list controls at the top and discloses role guidance in a dialog', async () => {
  render(<StaffAccountsPage />);
  expect(await screen.findByText('VSMS Admin')).toBeTruthy();

  const refresh = screen.getByRole('button', { name: 'Refresh list' });
  const directory = screen.getByRole('region', { name: 'Organisation staff accounts' });
  expect(refresh.compareDocumentPosition(directory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: /role access/i }));
  const dialog = await screen.findByRole('dialog', { name: 'Role access' });
  expect(within(dialog).getByText('Administrator')).toBeTruthy();
  expect(within(dialog).getByText('Staff')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close Role access' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Role access' })).toBeNull());

  await userEvent.click(refresh);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
