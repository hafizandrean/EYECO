/**
 * Password utilities - shared between auth and superadmin routes
 */

export interface PasswordStrength {
  score: number;
  errors: string[];
}

/**
 * Checks password strength against requirements:
 * - Min 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 symbol (!@#$%^&*)
 */
export function checkPasswordStrength(password: string): PasswordStrength {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Minimal 8 karakter');
  if (!/[A-Z]/.test(password)) errors.push('Harus mengandung huruf besar');
  if (!/[a-z]/.test(password)) errors.push('Harus mengandung huruf kecil');
  if (!/[0-9]/.test(password)) errors.push('Harus mengandung angka');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Harus mengandung simbol (!@#$%^&*)');
  return { score: 5 - errors.length, errors };
}