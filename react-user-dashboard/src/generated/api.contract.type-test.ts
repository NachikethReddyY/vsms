import type { components } from './api'

type ManualCheckInRequest = components['schemas']['ManualCheckInRequest']

const registrationReference: ManualCheckInRequest = {
  eventId: '00000000-0000-4000-8000-000000000001',
  registrationId: '00000000-0000-4000-8000-000000000002',
}

const qrToken: ManualCheckInRequest = {
  eventId: '00000000-0000-4000-8000-000000000001',
  identifier: 'a'.repeat(64),
}

// @ts-expect-error A manual check-in accepts exactly one lookup method.
const bothLookupMethods: ManualCheckInRequest = {
  eventId: '00000000-0000-4000-8000-000000000001',
  registrationId: '00000000-0000-4000-8000-000000000002',
  identifier: 'a'.repeat(64),
}

// @ts-expect-error A manual check-in requires a lookup method.
const noLookupMethod: ManualCheckInRequest = {
  eventId: '00000000-0000-4000-8000-000000000001',
}

void registrationReference
void qrToken
void bothLookupMethods
void noLookupMethod
