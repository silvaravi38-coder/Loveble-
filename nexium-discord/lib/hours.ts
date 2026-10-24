// hours: { "1": [["08:00","11:00"], ...], ... } com 0 = domingo e 6 = sábado
export function isOpen(hours: Record<string, string[][]>, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get("weekday") as "Sun"];
  const now = `${get("hour")}:${get("minute")}`;
  return (hours[String(day)] ?? []).some(([a, b]) => now >= a && now < b);
}
