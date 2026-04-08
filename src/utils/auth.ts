import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { UserProfile } from "../types";

export function mapSessionToUser(session: Session | null): UserProfile | null {
  if (!session?.user) return null;
  const name = session.user.user_metadata?.full_name ?? "Guest";
  return { id: session.user.id, fullName: name };
}

export async function signInAnonymously(displayName: string): Promise<void> {
  // Sign in anonymously with display name stored in metadata
  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { full_name: displayName.trim() } },
  });
  if (error) throw error;

  // Upsert profile so the rest of the app can join rooms
  if (data.user) {
    await supabase.from("profiles").upsert({
      id: data.user.id,
      email: `anon-${data.user.id}@vibeo.app`,
      full_name: displayName.trim(),
    }, { onConflict: "id" });
  }
}

export async function updateDisplayName(userId: string, name: string): Promise<void> {
  await supabase.auth.updateUser({ data: { full_name: name.trim() } });
  await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", userId);
}
