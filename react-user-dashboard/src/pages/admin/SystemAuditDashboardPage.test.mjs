import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./SystemAuditDashboardPage.tsx", import.meta.url), "utf8");

test("audit dashboard stays wired to the backend admin audit contract", () => {
  assert.match(source, /apiClient\.get<AuditDashboardResponse>\("\/admin\/audit-logs"\)/);
  assert.match(source, /setRows\(mapAuditRows\(response\.data\)\)/);
  assert.match(source, /response\.logs \|\|\ \[\]/);
  assert.match(source, /response\.authLogs \|\| \[\]/);
});

test("audit dashboard maps both ledger and auth events into one view model", () => {
  assert.match(source, /export function mapAuditRows/);
  assert.match(source, /deriveCategory/);
  assert.match(source, /new Date\(b\.timestamp\)\.getTime\(\) - new Date\(a\.timestamp\)\.getTime\(\)/);
});

test("audit dashboard handles loading, empty, failure, and permission states", () => {
  assert.match(source, /isLoading/);
  assert.match(source, /LoadingState/);
  assert.match(source, /No audit events recorded yet\./);
  assert.match(source, /err\.response\?\.status === 403/);
  assert.match(source, /Admin access is required to view the audit trail/);
  assert.doesNotMatch(source, /100% Secure/);
});
