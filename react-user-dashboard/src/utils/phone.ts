import { isValidPhoneNumber } from "react-phone-number-input";

export function normalizeSingaporePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length === 8 ? `+65${digits}` : trimmed;
}

export function isValidParticipantPhoneNumber(value: string) {
  const normalized = normalizeSingaporePhoneNumber(value);
  return Boolean(normalized && isValidPhoneNumber(normalized));
}

export function isValidParticipantNric(value: string) {
  return /^[STFGM]\d{7}[A-Z]$/.test(value.trim().replace(/[\s-]/g, "").toUpperCase());
}
