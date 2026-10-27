import type { NotificationDetail, NotificationItem, NotificationMessage, Tone } from "./notify.types.js";

const TONE: Record<Tone, { color: string; bg: string }> = {
  info: { color: "#2563eb", bg: "#eff6ff" },
  success: { color: "#16a34a", bg: "#f0fdf4" },
  warning: { color: "#d97706", bg: "#fffbeb" },
  danger: { color: "#dc2626", bg: "#fef2f2" },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const norm = (i: NotificationItem) =>
  typeof i === "string" ? { text: i, meta: undefined, details: [] as NotificationDetail[] } : { details: [], ...i };

const detailText = (d: NotificationDetail) => (typeof d === "string" ? d : `${d.label}: ${d.from}  →  ${d.to}`);

export function renderText(m: NotificationMessage): string {
  const out: string[] = [m.title];
  if (m.highlights?.length) out.push(m.highlights.join(" · "));
  if (m.intro) out.push("", m.intro);
  for (const s of m.sections) {
    out.push("", `${s.heading.toUpperCase()} (${s.total ?? s.items.length})`);
    for (const raw of s.items) {
      const i = norm(raw);
      out.push(`• ${i.text}`);
      if (i.meta) out.push(`    ${i.meta}`);
      for (const d of i.details) out.push(`    ${detailText(d)}`);
    }
  }
  if (m.footer) out.push("", "--", m.footer);
  return out.join("\n");
}

function renderDetailHtml(d: NotificationDetail): string {
  if (typeof d === "string") return esc(d);
  return (
    `${esc(d.label)}: <span style="color:#9ca3af;text-decoration:line-through">${esc(d.from)}</span>` +
    ` &rarr; <strong style="color:#111827">${esc(d.to)}</strong>`
  );
}

export function renderHtml(m: NotificationMessage): string {
  const pills = (m.highlights ?? [])
    .map(
      (h) =>
        `<span style="display:inline-block;margin:4px 6px 0 0;padding:3px 10px;border-radius:999px;background:#e5e7eb;color:#111827;font-size:12px;font-weight:600">${esc(h)}</span>`,
    )
    .join("");

  const sections = m.sections
    .map((s) => {
      const t = TONE[s.tone ?? "info"];
      const items = s.items
        .map((raw) => {
          const i = norm(raw);
          const meta = i.meta ? `<div style="color:#6b7280;font-size:13px;margin-top:2px">${esc(i.meta)}</div>` : "";
          const details = i.details.length
            ? `<div style="font-size:13px;margin-top:4px;color:#374151">${i.details.map(renderDetailHtml).join("<br>")}</div>`
            : "";
          return `<div style="padding:10px 12px;margin:6px 0;background:${t.bg};border-left:4px solid ${t.color};border-radius:4px"><div style="font-weight:600;color:#111827">${esc(i.text)}</div>${meta}${details}</div>`;
        })
        .join("");
      return `<h3 style="margin:22px 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${t.color}">${esc(s.heading)} (${s.total ?? s.items.length})</h3>${items}`;
    })
    .join("");

  const preheader = m.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(m.preheader)}</div>`
    : "";

  return (
    `<div style="background:#f3f4f6;padding:16px 0"><div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:20px 22px">` +
    preheader +
    `<h2 style="margin:0;font-size:18px;color:#111827">${esc(m.title)}</h2>` +
    (pills ? `<div>${pills}</div>` : "") +
    (m.intro ? `<p style="margin:12px 0 0;color:#4b5563">${esc(m.intro)}</p>` : "") +
    sections +
    (m.footer
      ? `<hr style="margin:24px 0 12px;border:none;border-top:1px solid #e5e7eb"><p style="margin:0;color:#9ca3af;font-size:12px">${esc(m.footer)}</p>`
      : "") +
    `</div></div>`
  );
}
