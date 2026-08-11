/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../utils/apiClient', () => ({
  default: { get, post, patch },
  getApiError: (cause: unknown, fallback: string) => {
    if (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as { message: unknown }).message === 'string') {
      return (cause as { message: string }).message;
    }
    return fallback;
  },
}));

import StationLibraryPage from './StationLibraryPage';

const template = {
  stationTemplateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  templateKey: '11111111-1111-4111-8111-111111111111',
  stationType: 'VISUAL_ACUITY',
  version: 1,
  name: 'Visual acuity booth',
  description: 'Snellen chart',
  defaultCapacity: 4,
  active: true,
};

function polyfillDialog() {
  if (typeof HTMLDialogElement === 'undefined') return;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
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
});

afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/station-templates']}>
      <Routes>
        <Route path="/admin/station-templates" element={<StationLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function library() {
  return screen.getByLabelText(/Station template library/i);
}

function openCreateFromEmpty() {
  return userEvent.click(screen.getByRole('button', { name: /Add template/i }));
}

describe('StationLibraryPage', () => {
  it('shows loading then listed templates', async () => {
    let resolveList: (value: unknown) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));
    renderPage();
    expect(screen.getByLabelText(/Loading station templates/i)).toBeTruthy();
    resolveList({ data: [template] });
    expect(await within(library()).findByText('Visual acuity booth')).toBeTruthy();
    expect(screen.getByText(/1 active \/ 1 total/i)).toBeTruthy();
  });

  it('shows empty state when the library has no templates', async () => {
    get.mockResolvedValueOnce({ data: [] });
    renderPage();
    expect(await screen.findByRole('heading', { name: /No station templates yet/i })).toBeTruthy();
  });

  it('shows load error and retries', async () => {
    get.mockRejectedValueOnce(new Error('forbidden'));
    get.mockResolvedValueOnce({ data: [template] });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent || '').toMatch(/forbidden/i);
    await userEvent.click(within(alert).getByRole('button', { name: /Try again/i }));
    expect(await within(library()).findByText('Visual acuity booth')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toBe('/events/station-templates/library');
  });

  it('validates create name and posts a template', async () => {
    get.mockResolvedValueOnce({ data: [] });
    post.mockResolvedValueOnce({
      data: {
        ...template,
        stationTemplateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        templateKey: '22222222-2222-4222-8222-222222222222',
        stationType: 'EYE_HEALTH',
        name: 'Eye health booth',
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: /No station templates yet/i });
    await openCreateFromEmpty();
    const dialog = await screen.findByRole('dialog', { name: /Add station template/i });
    await userEvent.selectOptions(within(dialog).getByLabelText(/Station type/i), 'EYE_HEALTH');
    await userEvent.clear(within(dialog).getByLabelText(/^Name$/i));
    await userEvent.type(within(dialog).getByLabelText(/^Name$/i), 'Eye health booth');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create template/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/events/station-templates', expect.objectContaining({
      stationType: 'EYE_HEALTH',
      name: 'Eye health booth',
    })));
    expect(await within(library()).findByText('Eye health booth')).toBeTruthy();
  });

  it('surfaces create API errors inside the dialog', async () => {
    get.mockResolvedValueOnce({ data: [] });
    post.mockRejectedValueOnce(new Error('Station template could not be created'));
    renderPage();
    await screen.findByRole('heading', { name: /No station templates yet/i });
    await openCreateFromEmpty();
    const dialog = await screen.findByRole('dialog', { name: /Add station template/i });
    await userEvent.type(within(dialog).getByLabelText(/^Name$/i), 'Duplicate');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create template/i }));
    expect(await within(dialog).findByText(/could not be created/i)).toBeTruthy();
  });
});
