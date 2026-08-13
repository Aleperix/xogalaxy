/**
 * XO Galaxy — adaptador de envío de email.
 * Provider según env.EMAIL_PROVIDER:
 *   "gmail"      → SMTP smtp.gmail.com vía nodemailer (GMAIL_USER + GMAIL_APP_PASSWORD).
 *   "cloudflare" → binding env.EMAIL (Send Email de Cloudflare; requiere dominio onboard).
 *   "resend"     → REST API de Resend (RESEND_API_KEY).
 *   "mock"       → no envía (tests / sin provider). Devuelve un messageId fake.
 * El fallo de envío NUNCA rompe la suscripción: la capa de negocio loguea y
 * deja el suscriptor 'pending' para reintentar.
 */
import nodemailer from "nodemailer";

export function normalizeFrom(env, msg) {
  if (msg.from) return msg.from;
  const domain = env.EMAIL_FROM_DOMAIN || "xogalaxy.com";
  return "novedades@" + domain;
}

export async function sendEmail(env, msg) {
  const provider = String(env.EMAIL_PROVIDER || "mock").toLowerCase();
  switch (provider) {
    case "gmail":
      return sendGmail(env, msg);
    case "cloudflare":
      return sendCloudflare(env, msg);
    case "resend":
      return sendResend(env, msg);
    default:
      return { provider: "mock", messageId: "mock-" + Date.now() };
  }
}

async function sendGmail(env, msg) {
  const user = env.GMAIL_USER;
  const pass = env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("provider gmail sin GMAIL_USER/GMAIL_APP_PASSWORD");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
  const info = await transport.sendMail({
    from: `"${msg.fromName || "XO Galaxy"}" <${user}>`,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    headers: msg.headers || {},
  });
  return { provider: "gmail", messageId: info.messageId || ("gmail-" + Date.now()) };
}

async function sendCloudflare(env, msg) {
  if (!env.EMAIL) throw new Error("binding EMAIL no configurado");
  const res = await env.EMAIL.send({
    to: msg.to,
    from: { email: normalizeFrom(env, msg), name: msg.fromName || "XO Galaxy" },
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    headers: msg.headers || {},
  });
  return { provider: "cloudflare", messageId: res.messageId };
}

async function sendResend(env, msg) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurado");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `"${msg.fromName || "XO Galaxy"}" <${normalizeFrom(env, msg)}>`,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) throw new Error(`resend HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "resend", messageId: data.id || ("resend-" + Date.now()) };
}
