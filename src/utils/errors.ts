type SupabaseError = { code?: string; message?: string; status?: number };

const CODE_MAP: Record<string, string> = {
  // Auth
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed: "Please confirm your email before signing in.",
  user_already_exists: "An account with this email already exists.",
  over_email_send_rate_limit: "Too many attempts. Please wait a few minutes and try again.",
  weak_password: "Password is too weak. Use at least 8 characters.",
  // Supabase REST
  "23503": "Account setup incomplete. Please try signing out and back in.",
  "23505": "A room with that code already exists. Please try again.",
  PGRST301: "Your session has expired. Please sign in again.",
};

export function friendlyError(error: unknown): string {
  console.error("[vibeo]", error);

  if (!error) return "Something went wrong.";

  const e = error as SupabaseError;

  // Supabase auth errors carry an error_code
  if (e.code && CODE_MAP[e.code]) return CODE_MAP[e.code];

  // Postgres constraint codes come through in message
  for (const [code, msg] of Object.entries(CODE_MAP)) {
    if (e.message?.includes(code)) return msg;
  }

  // Network / fetch failures
  if (error instanceof TypeError && e.message?.toLowerCase().includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }

  if (e.message) return e.message;
  if (error instanceof Error) return error.message;

  return "Something went wrong.";
}

export function validateAuthForm(
  mode: "signin" | "signup",
  fields: { fullName: string; email: string; password: string },
): string | null {
  const { fullName, email, password } = fields;

  if (mode === "signup" && !fullName.trim()) return "Please enter your full name.";
  if (!email.trim()) return "Please enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
  if (!password) return "Please enter a password.";
  if (mode === "signup" && password.length < 8) return "Password must be at least 8 characters.";

  return null;
}
