/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../utils/apiClient", () => ({ default: { get } }));

import { AuditLogsPage } from "../../pages/AdminPages";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  source: "APPLICATION",
  occurredAt: "2026-08-13T08:30:00.000Z",
  action: "QUEUE_JOINED",
  outcome: "SUCCESS",
  actor: { id: "22222222-2222-4222-8222-222222222222", fullName: "Asha Rao", email: "asha@example.test" },
  eventId: "33333333-3333-4333-8333-333333333333",
  entityName: "QueueEntry",
  entityId: "44444444-4444-4444-8444-444444444444",
  requestId: "request-1",
  ipAddress: "203.0.113.10",
  deviceName: "Registration desk",
  details: { stationType: "VISUAL_ACUITY" },
  oldValue: null,
  newValue: { status: "WAITING" },
  ...overrides,
});

beforeEach(() => get.mockReset());
afterEach(cleanup);

describe("AuditLogsPage", () => {
  it("renders one chronological feed from all three immutable ledgers", async () => {
    get.mockResolvedValueOnce({ data: { items: [
      item(),
      item({ id: "55555555-5555-4555-8555-555555555555", source: "AUTHENTICATION", action: "LOGIN_FAILED", outcome: "DENIED", entityName: "Authentication" }),
      item({ id: "66666666-6666-4666-8666-666666666666", source: "EVENT", action: "PUBLISHED", entityName: "Event" }),
    ], nextCursor: null } });

    render(<AuditLogsPage />);

    expect(screen.getByRole("status").textContent).toMatch(/loading audit history/i);
    expect(await screen.findByText("QUEUE_JOINED")).toBeTruthy();
    expect(screen.getByText("LOGIN_FAILED")).toBeTruthy();
    expect(screen.getByText("PUBLISHED")).toBeTruthy();
    expect(screen.getByLabelText(/3 audit records loaded/i)).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/admin/audit-logs", expect.objectContaining({ params: { limit: 50 } }));
  });

  it("applies filters deliberately and uses the single cursor to load older records", async () => {
    get
      .mockResolvedValueOnce({ data: { items: [item()], nextCursor: "signed-cursor" } })
      .mockResolvedValueOnce({ data: { items: [item({ id: "77777777-7777-4777-8777-777777777777", action: "LOGIN_FAILED", source: "AUTHENTICATION" })], nextCursor: "signed-filter-cursor" } })
      .mockResolvedValueOnce({ data: { items: [item({ id: "88888888-8888-4888-8888-888888888888", action: "OLDER" })], nextCursor: null } });

    render(<AuditLogsPage />);
    await screen.findByText("QUEUE_JOINED");
    await userEvent.type(screen.getByLabelText("Action"), "LOGIN_FAILED");
    expect(get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /apply filters/i }));
    expect(await screen.findByText("LOGIN_FAILED")).toBeTruthy();
    expect(get.mock.calls[1][1].params).toMatchObject({ limit: 50, action: "LOGIN_FAILED" });
    await userEvent.click(screen.getByRole("button", { name: /load older records/i }));
    expect(await screen.findByText("OLDER")).toBeTruthy();
    expect(get.mock.calls[2][1].params).toMatchObject({ action: "LOGIN_FAILED", cursor: "signed-filter-cursor" });
  });

  it("exposes evidence details without putting them in the default scan path", async () => {
    get.mockResolvedValueOnce({ data: { items: [item()], nextCursor: null } });
    render(<AuditLogsPage />);
    const details = await screen.findByText(/evidence details/i);
    const evidence = details.closest("details") as HTMLDetailsElement;
    expect(evidence.open).toBe(false);
    await userEvent.click(details);
    expect(evidence.open).toBe(true);
    expect(await screen.findByText(/VISUAL_ACUITY/)).toBeTruthy();
    expect(within(evidence).getByText(/request-1/i)).toBeTruthy();
  });

  it("handles empty, permission, failure, and retry states", async () => {
    get.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const view = render(<AuditLogsPage />);
    expect(await screen.findByRole("heading", { name: /no matching evidence/i })).toBeTruthy();
    view.unmount();

    get.mockRejectedValueOnce({ response: { status: 403 } });
    render(<AuditLogsPage />);
    expect(await screen.findByRole("heading", { name: /administrator access required/i })).toBeTruthy();
    cleanup();

    get.mockRejectedValueOnce({ response: { status: 500, data: { message: "Audit store unavailable" } } });
    get.mockResolvedValueOnce({ data: { items: [item()], nextCursor: null } });
    render(<AuditLogsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/audit store unavailable/i);
    await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("QUEUE_JOINED")).toBeTruthy());
  });
});
