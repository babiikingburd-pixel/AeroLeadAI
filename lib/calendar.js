"use client";
// Calendar integration: generate a downloadable .ics for a lead's follow-up
// date (works with Google Calendar, Outlook, Apple Calendar — anything that
// accepts a standard ICS file, no calendar API keys needed).
function icsEscape(s) { return String(s || "").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n"); }
function toIcsDate(d) {
  const dt = new Date(d);
  return dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function buildIcs(lead) {
  const start = lead.followUp ? new Date(lead.followUp) : new Date(Date.now() + 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const uid = `${Math.random().toString(36).slice(2)}@aeroleadai`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AeroLeadAI//Follow-up//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${icsEscape("Follow up: " + lead.address)}`,
    `DESCRIPTION:${icsEscape(`AeroLeadAI follow-up. Damage score: ${lead.findingsScore ?? "—"}. Status: ${lead.status || "new"}.`)}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(lead) {
  const blob = new Blob([buildIcs(lead)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `followup-${(lead.address || "lead").replace(/\W+/g, "-").slice(0, 40)}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}
