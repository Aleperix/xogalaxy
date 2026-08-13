/**
 * XO Galaxy — plantillas de email personalizadas.
 * Personalizan por nombre y preferencias (temas + frecuencia). Cada plantilla
 * entrega { subject, html, text } y enlaza baja / preferencias con su token.
 */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function stripMd(s) {
  return String(s || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TOPIC_LABELS = {
  juegos: "Juegos",
  actividades: "Actividades",
  tutoriales: "Tutoriales",
  nostalgia: "Nostalgia y Lost media",
};

export const TOPICS = Object.keys(TOPIC_LABELS);

export function topicLabel(key) {
  return TOPIC_LABELS[key] || key;
}

export function parsePrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const topics = Array.isArray(p.topics)
    ? p.topics.filter((t) => TOPICS.includes(String(t))).slice(0, 8)
    : [];
  return { topics, frequency: p.frequency === "monthly" ? "monthly" : "weekly" };
}

export function shell(title, bodyHtml) {
  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#f2f4f8;font-family:Arial,Helvetica,sans-serif">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px">` +
    `<div style="background:#080c14;color:#fff;border-radius:12px 12px 0 0;padding:18px 24px">` +
    `<strong style="color:#a8ff60">● XO GALAXY</strong> · nostalgia viva</div>` +
    `<div style="background:#fff;border-radius:0 0 12px 12px;padding:24px">` +
    title +
    bodyHtml +
    `</div></div></body></html>`
  );
}

function greeting(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "comunidad";
  return "Hola " + esc(first) + "!";
}

export function confirmEmail(subscriber, { confirmUrl, baseUrl }) {
  const name = subscriber.name || "";
  const subject = "Confirmá tu suscripción a XO Galaxy";
  const html = shell(
    `<h1 style="margin:0 0 8px;font-size:20px;color:#111">Confirmá tu suscripción</h1>`,
    `<p style="color:#444;font-size:15px;line-height:1.6">${greeting(name)}</p>` +
      `<p style="color:#444;font-size:15px;line-height:1.6">Te llegaron novedades de XO Galaxy: juegos, actividades, tutoriales y joyas de la época XO que revivimos. Confirmá tu correo para empezar a recibirlas:</p>` +
      `<p style="text-align:center;margin:22px 0"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#a8ff60;color:#080c14;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Confirmar suscripción</a></p>` +
      `<p style="color:#888;font-size:13px;line-height:1.6">Si no fuiste vos, podés ignorar este correo. Preferencias: <a href="${esc(baseUrl)}/p/politica-de-privacidad.html">política de privacidad</a>.</p>`
  );
  const text =
    `${greeting(name)}\n\nConfirmá tu suscripción a las novedades de XO Galaxy:\n${confirmUrl}\n\nSi no fuiste vos, ignorá este correo.`;
  return { subject, html, text };
}

export function digestEmail(subscriber, posts, { unsubscribeUrl, prefsUrl, baseUrl }) {
  const prefs = parsePrefs(subscriber.prefs);
  const name = subscriber.name || "";
  const freqLabel = prefs.frequency === "monthly" ? "mensual" : "semanal";
  const topicsText = prefs.topics.length
    ? prefs.topics.map(topicLabel).join(", ")
    : "todo";
  const subject = `Novedades XO Galaxy · ${freqLabel}`;
  const site = baseUrl || "https://xogalax.blogspot.com";

  let itemsHtml = "";
  let itemsText = "";
  if (!posts.length) {
    itemsHtml = `<p style="color:#888;font-size:14px">Esta semana no hay novedades nuevas. Volvé pronto.</p>`;
    itemsText = "Esta semana no hay novedades nuevas.\n";
  } else {
    posts.forEach(function (p) {
      itemsHtml +=
        `<div style="border:1px solid #e4e7ee;border-radius:8px;padding:14px;margin-bottom:12px">` +
        `<a href="${esc(p.postUrl || site)}" style="font-size:16px;font-weight:bold;color:#104bff;text-decoration:none">${esc(p.title)}</a>` +
        (p.body ? `<p style="color:#555;font-size:14px;line-height:1.6;margin:6px 0 0">${esc(stripMd(p.body)).slice(0, 220)}…</p>` : "") +
        `</div>`;
      itemsText += `- ${p.title}\n`;
    });
  }

  const html = shell(
    `<h1 style="margin:0 0 8px;font-size:20px;color:#111">Novedades de la semana</h1>`,
    `<p style="color:#444;font-size:15px;line-height:1.6">${greeting(name)} · recibís esta edición ${freqLabel} con tus temas: <strong>${esc(topicsText)}</strong>.</p>` +
      `<p style="color:#888;font-size:13px;margin:0 0 16px">Rescatamos joyas de la era XO y las modernizamos para hoy. Perdidos en el tiempo, no perdidos para siempre.</p>` +
      itemsHtml +
      `<p style="margin:18px 0 0;font-size:12px;color:#888">Cambiá tus preferencias <a href="${esc(prefsUrl)}">acá</a> o date de baja <a href="${esc(unsubscribeUrl)}">acá</a>.</p>`
  );
  const text =
    `${greeting(name)}\n\nNovedades XO Galaxy (edición ${freqLabel}, temas: ${topicsText}).\n\n${itemsText}\n\nCambiá tus preferencias: ${prefsUrl}\nDarte de baja: ${unsubscribeUrl}`;

  return { subject, html, text };
}

export function page(title, bodyHtml, style) {
  return (
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>${esc(title)} · XO Galaxy</title>` +
    `<style>body{font-family:system-ui,-apple-system,sans-serif;background:#080c14;color:#e7e9ee;margin:0;padding:24px;display:flex;justify-content:center;align-items:center;min-height:80vh}.card{max-width:460px;width:100%;background:#141b2b;border:1px solid #262f44;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 10px;color:#fff}p{color:#aab3c5;font-size:14px;line-height:1.6}.btn{display:inline-block;background:#a8ff60;color:#080c14;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px;margin-top:8px}.field{margin:12px 0}label{display:block;font-size:12px;color:#8b95a9;margin-bottom:4px}input[type=text],input[type=email],select{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid #333f5c;background:#0d1322;color:#e7e9ee;font-size:14px}button{padding:11px 18px;border:0;border-radius:8px;background:#a8ff60;color:#080c14;font-weight:bold;cursor:pointer}</style></head><body>` +
    `<div class="card">${bodyHtml}</div></body></html>`
  );
}
