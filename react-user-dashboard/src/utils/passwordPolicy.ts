export const passwordRequirements = [
  { label: "At least 12 characters", test: (password: string) => password.length >= 12 },
  { label: "At least 1 uppercase letter", test: (password: string) => /[A-Z]/.test(password) },
  { label: "At least 1 lowercase letter", test: (password: string) => /[a-z]/.test(password) },
  { label: "At least 1 number", test: (password: string) => /\d/.test(password) },
  { label: "At least 1 special character", test: (password: string) => /[^A-Za-z0-9]/.test(password) },
];

export function isPasswordValid(password: string) {
  return passwordRequirements.every((requirement) => requirement.test(password));
}
