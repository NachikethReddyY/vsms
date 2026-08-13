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
import StationTemplateFormPage from './StationTemplateFormPage';

const template = {
  stationTemplateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  templateKey: '11111111-1111-4111-8111-111111111111',
  stationType: 'VISUAL_ACUITY',
  version: 1,
  name: 'Visual acuity booth',
  description: 'Snellen chart',
  defaultCapacity: 4,
  active: true,
  fieldSchema: null,
};

const customTemplate = {
  stationTemplateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  templateKey: '22222222-2222-4222-8222-222222222222',
  stationType: 'CUSTOM',
  version: 2,
  name: 'Custom notes booth',
  description: 'Extra notes',
  defaultCapacity: 2,
  active: true,
  fieldSchema: [{ key: 'field1', label: 'Field 1', type: 'text', required: false }],
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderLibrary(path = '/admin/station-templates') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/station-templates" element={<StationLibraryPage />} />
        <Route path="/admin/station-templates/new" element={<StationTemplateFormPage mode="create" />} />
        <Route path="/admin/station-templates/:stationTemplateId/edit" element={<StationTemplateFormPage mode="edit" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function library() {
  return screen.getByLabelText(/Station template library/i);
}

describe('Station library pages', () => {
  it('shows loading then listed templates with edit links', async () => {
    let resolveList: (value: unknown) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));
    renderLibrary();
    expect(screen.getByLabelText(/Loading station templates/i)).toBeTruthy();
    resolveList({ data: [template] });
    expect(await within(library()).findByText('Visual acuity booth')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Edit/i }).getAttribute('href')).toBe(`/admin/station-templates/${template.stationTemplateId}/edit`);
    expect(screen.getByRole('link', { name: /Add template/i }).getAttribute('href')).toBe('/admin/station-templates/new');
  });

  it('shows empty state when the library has no templates', async () => {
    get.mockResolvedValueOnce({ data: [] });
    renderLibrary();
    expect(await screen.findByRole('heading', { name: /No station templates yet/i })).toBeTruthy();
  });

  it('shows load error and retries', async () => {
    get.mockRejectedValueOnce(new Error('forbidden'));
    get.mockResolvedValueOnce({ data: [template] });
    renderLibrary();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent || '').toMatch(/forbidden/i);
    await userEvent.click(within(alert).getByRole('button', { name: /Try again/i }));
    expect(await within(library()).findByText('Visual acuity booth')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('creates a custom template from the dedicated form page without a type dropdown', async () => {
    post.mockResolvedValueOnce({ data: customTemplate });
    renderLibrary('/admin/station-templates/new');
    expect(await screen.findByRole('heading', { name: /Add station template/i })).toBeTruthy();
    expect(screen.queryByLabelText(/Station type/i)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /^Form fields$/i })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /^Live preview$/i })).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/^Name$/i), 'Custom notes booth');
    await userEvent.click(screen.getByRole('button', { name: /Create template/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/events/station-templates', expect.objectContaining({
      stationType: 'CUSTOM',
      name: 'Custom notes booth',
      fieldSchema: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
    })));
  });

  it('loads valid example data with multiple flag rules', async () => {
    post.mockResolvedValueOnce({ data: customTemplate });
    renderLibrary('/admin/station-templates/new');
    await userEvent.click(await screen.findByRole('button', { name: /Use example/i }));
    expect(screen.getAllByText(/Flag rules ·/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /Live preview/i })).toBeTruthy();
    expect((screen.getByLabelText('Plates presented *') as HTMLInputElement).value).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: /Create template/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/events/station-templates', expect.objectContaining({
      name: 'Colour vision screening',
      fieldSchema: expect.arrayContaining([expect.objectContaining({
        key: 'platesCorrect',
        flagRules: expect.arrayContaining([
          expect.objectContaining({ flag: 'REFER', value: 12 }),
          expect.objectContaining({ flag: 'REVIEW', value: 16 }),
        ]),
      })]),
    })));
  });

  it('edits an existing custom template including fields', async () => {
    get.mockResolvedValueOnce({ data: [customTemplate] });
    patch.mockResolvedValueOnce({ data: { ...customTemplate, name: 'Updated notes booth' } });
    renderLibrary(`/admin/station-templates/${customTemplate.stationTemplateId}/edit`);
    expect(await screen.findByDisplayValue('Custom notes booth')).toBeTruthy();
    const nameInput = screen.getByLabelText(/^Name$/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated notes booth');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      `/events/station-templates/items/${customTemplate.stationTemplateId}`,
      expect.objectContaining({
        name: 'Updated notes booth',
        fieldSchema: expect.arrayContaining([expect.objectContaining({ key: 'field1' })]),
      }),
    ));
  });

  it('edits existing clinical form fields on the template page', async () => {
    const clinical = {
      ...template,
      fieldSchema: [
        { key: 'chartDistanceMetres', label: 'Chart distance (m)', type: 'select', required: true, options: ['3', '6'] },
        { key: 'od', label: 'Right eye (OD)', type: 'va-eye', required: true },
        { key: 'os', label: 'Left eye (OS)', type: 'va-eye', required: true },
        { key: 'withUsualDistanceGlasses', label: 'With usual distance glasses', type: 'select', required: true, options: ['yes', 'no', 'unknown'] },
        { key: 'notes', label: 'Notes', type: 'text', required: false },
      ],
    };
    get.mockResolvedValueOnce({ data: [clinical] });
    patch.mockResolvedValueOnce({ data: clinical });
    renderLibrary(`/admin/station-templates/${clinical.stationTemplateId}/edit`);
    expect(await screen.findByDisplayValue('Visual acuity booth')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /^Form fields$/i })).toBeTruthy();
    expect(screen.getByDisplayValue('Chart distance (m)')).toBeTruthy();
    const notesLabel = screen.getByDisplayValue('Notes');
    await userEvent.clear(notesLabel);
    await userEvent.type(notesLabel, 'Screener notes');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      `/events/station-templates/items/${clinical.stationTemplateId}`,
      expect.objectContaining({
        name: 'Visual acuity booth',
        fieldSchema: expect.arrayContaining([expect.objectContaining({ label: 'Screener notes' })]),
      }),
    ));
  });

  it('hides registration, clinical review, and eye health from the library list', async () => {
    const registration = {
      stationTemplateId: '60000000-0000-4000-8000-000000000001',
      templateKey: 'REGISTRATION',
      stationType: null,
      version: 1,
      name: 'Registration',
      description: 'Check-in',
      defaultCapacity: 3,
      active: true,
      fieldSchema: null,
    };
    const clinicalReview = {
      stationTemplateId: '60000000-0000-4000-8000-000000000004',
      templateKey: 'CLINICAL_REVIEW',
      stationType: null,
      version: 1,
      name: 'Clinical review',
      description: 'Review outcomes',
      defaultCapacity: 2,
      active: true,
      fieldSchema: null,
    };
    const eyeHealth = {
      stationTemplateId: '60000000-0000-4000-8000-000000000003',
      templateKey: 'EYE_HEALTH',
      stationType: null,
      version: 1,
      name: 'Eye health',
      description: 'Review only',
      defaultCapacity: 2,
      active: true,
      fieldSchema: null,
    };
    get.mockResolvedValueOnce({ data: [registration, clinicalReview, eyeHealth, template] });
    renderLibrary();
    expect(await within(library()).findByText('Visual acuity booth')).toBeTruthy();
    expect(screen.queryByText('Registration')).toBeNull();
    expect(screen.queryByText('Clinical review')).toBeNull();
    expect(screen.queryByText('Eye health')).toBeNull();
  });

  it('blocks edit routes for templates hidden from the station library', async () => {
    const clinicalReview = {
      stationTemplateId: '60000000-0000-4000-8000-000000000004',
      templateKey: 'CLINICAL_REVIEW',
      stationType: null,
      version: 1,
      name: 'Clinical review',
      description: 'Review outcomes',
      defaultCapacity: 2,
      active: true,
      fieldSchema: null,
    };
    get.mockResolvedValueOnce({ data: [clinicalReview] });
    renderLibrary(`/admin/station-templates/${clinicalReview.stationTemplateId}/edit`);
    expect(await screen.findByRole('heading', { name: /Not in station library/i })).toBeTruthy();
    expect(screen.getByText(/not managed in the station library/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save changes/i })).toBeNull();
  });
});
