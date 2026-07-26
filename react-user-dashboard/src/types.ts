export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  employeeNumber?: string;
  department?: string | null;
  designation?: string | null;
  status?: string;
  roles: string[];
}

export interface AuthSession {
  accessToken: string;
  idToken: string | null;
  refreshToken: string | null;
  email: string;
  user: AppUser;
}

export interface PendingSignupProfile {
  fullName: string;
  email: string;
  employeeNumber: string;
  department: string;
  designation: string;
  role: string;
}

export interface EventSummary {
  id: string;
  eventName: string;
  location: string;
  status: string;
  eventDate: string;
}
