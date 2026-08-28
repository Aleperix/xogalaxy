/**
 * Migración: agregar xo-author-data a los 2 posts existentes en Blogger.
 * Lee credenciales de ~/.config/xogalaxy/blogger.json
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CREDS_PATH = join(homedir(), ".config", "xogalaxy", "blogger.json");
const creds = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
const API = "https://www.googleapis.com/blogger/v3";
const BLOG_ID = creds.blog_id;

const POST_IDS = [
  "6641116164386469933",
  "5242767238564511924",
];

const AUTHOR_NAME = "Aleperix";
const AUTHOR_SUB = "107284810985445490995";
const AUTHOR_PIC = "https://avatars.githubusercontent.com/u/44621287?v=4";

async function refreshToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("token: " + res.status);
  return data.access_token;
}

async function getPost(token, postId) {
  const res = await fetch(`${API}/blogs/${BLOG_ID}/posts/${postId}?fields=id,title,content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error("GET: " + res.status + " " + JSON.stringify(data));
  return data;
}

async function patchPost(token, postId, content) {
  const res = await fetch(`${API}/blogs/${BLOG_ID}/posts/${postId}?fields=id,title,url`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("PATCH: " + res.status + " " + JSON.stringify(data));
  return data;
}

const dryRun = process.argv.includes("--dry-run");

const token = await refreshToken();
console.log("Token OK");

for (const id of POST_IDS) {
  const post = await getPost(token, id);
  console.log(`\nPost ${id}: "${post.title}"`);

  if (post.content.includes("xo-author-data") && post.content.includes("data-sub=")) {
    console.log("  → Ya tiene xo-author-data con data-sub, skip");
    continue;
  }

  var content = post.content;
  if (content.includes("xo-author-data")) {
    content = content.replace(/<span class="xo-author-data"[^>]*><\/span>/, "");
  }

  const byline = `<span class="xo-author-data" data-name="${AUTHOR_NAME}" data-pic="${AUTHOR_PIC}" data-sub="${AUTHOR_SUB}"></span>`;
  const newContent = byline + content;

  if (dryRun) {
    console.log("  → DRY RUN: agregaría byline al inicio del content");
  } else {
    const updated = await patchPost(token, id, newContent);
    console.log("  → OK:", updated.url);
  }
}

console.log("\nListo.");
