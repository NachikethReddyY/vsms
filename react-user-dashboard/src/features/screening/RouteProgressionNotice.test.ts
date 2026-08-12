/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { RouteProgressionNotice } from './StationShared';

afterEach(cleanup);

describe('offline route progression notice', () => {
  it('announces pending sync without claiming the participant entered a next queue', () => {
    const { container } = render(createElement(
      MemoryRouter,
      null,
      createElement(RouteProgressionNotice, {
        eventId: '22222222-2222-4222-8222-222222222222',
        queued: true,
      }),
    ));

    expect(screen.getByText('Pending sync — the participant has not entered the next queue yet.')).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(screen.queryByText(/added to .* queue/i)).toBeNull();
  });
});
