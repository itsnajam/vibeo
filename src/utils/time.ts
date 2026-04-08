export function formatScheduledTime(iso: string | null) {
  if (!iso) {
    return "Not scheduled yet";
  }

  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function secondsUntil(iso: string | null) {
  if (!iso) {
    return null;
  }

  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 1000));
}
