type SupabaseError = { code?: string; message?: string; status?: number };

export function friendlyError(error: unknown): string {
  console.error("[vibeo]", error);
  if (!error) return "Something went wrong.";
  const e = error as SupabaseError;
  if (e.message) return e.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
