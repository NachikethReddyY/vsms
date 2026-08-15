const keyFor = (eventId: string) => `vsms-registration-started:${eventId}`;

export function beginRegistrationEvidence(eventId: string) {
  const key = keyFor(eventId);
  const existing = window.sessionStorage.getItem(key);
  if (existing && Number.isFinite(Date.parse(existing))) return existing;

  const startedAt = new Date().toISOString();
  window.sessionStorage.setItem(key, startedAt);
  return startedAt;
}

export function getRegistrationStartedAt(eventId: string) {
  return beginRegistrationEvidence(eventId);
}

export function clearRegistrationEvidence(eventId: string) {
  window.sessionStorage.removeItem(keyFor(eventId));
}
