export interface AppUser {
  id: string;
  userId?: string;
  username?: string;
  email: string;
  fullName: string;
  employeeNumber?: string;
  department?: string | null;
  designation?: string | null;
  professionalCategory?: "STAFF" | "DOCTOR" | null;
  status?: string;
  approvalState?: 'PENDING' | 'APPROVED' | 'REJECTED';
  accessState?: 'ENABLED' | 'SUSPENDED' | 'DISABLED';
  roles: string[];
  systemRole?: "ADMIN" | "EVENT_MANAGER" | "STAFF";
}

export interface AuthSession {
  user: AppUser;
  expiresAt: number;
}

export interface EventSummary {
  id: string;
  eventName: string;
  location: string;
  status: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
  _count?: {
    eventRegistrations: number;
  };
}

export interface ParticipantSummary {
  id: string;
  participantReference: string;
  firstName: string;
  lastName: string;
  maskedContactNumber: string;
  maskedDateOfBirth: string;
  status: string;
}

export interface Participant {
  id: string;
  participantReference: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  nricMasked: string | null;
  email: string | null;
  race: string | null;
  nationality: string | null;
  addressStreet: string | null;
  addressUnit: string | null;
  addressPostalCode: string | null;
  preferredLanguage: string | null;
  accessibilityNotes: string | null;
  status: string;
}

export interface EmergencyContact {
  id: string;
  contactName: string;
  relationship: string;
  phoneNumber: string;
  email: string | null;
  isPrimary: boolean;
  status: string;
}

export interface ConsentFormVersion {
  id: string;
  formCode: string;
  versionNumber: string;
  title: string;
  contentText: string | null;
  documentObjectKey: string;
}

export interface Registration {
  id: string;
  participantId: string;
  eventId: string;
  queueNumber: number | null;
  registrationStatus: string;
  registeredAt: string;
  participant: Pick<Participant, "id" | "participantReference" | "firstName" | "lastName" | "dateOfBirth">;
  event: EventSummary;
  statusHistory?: RegistrationHistory[];
}

export interface RegistrationHistory {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  occurredAt: string;
  changedBy?: {
    id: string;
    fullName: string;
  };
}
