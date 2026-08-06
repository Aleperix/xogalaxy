import { writeFile, mkdir, rm } from "node:fs/promises";
import { join, basename } from "node:path";

const BLOG = "https://xogalax.blogspot.com";
const BLOG_ID = "6925527308405412397";
const MAX_RESULTS = 500;

const BASE = new URL(import.meta.url);
const ROOT = join(BASE.pathname, "..", "..");
const DATE = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, "backup", DATE);

const JSON_HEADERS = { Accept: "application/json" };

async function fetchFeed(name, url) {
  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`${name} feed HTTP ${res.status}`);
  return res.json();
}

function slugFromUrl(url) {
  const seg = url.split("/").filter(Boolean).pop();
  return (seg || "index").replace(/\.html$/, "");
}

function escapeYaml(value) {
  return JSON.stringify(String(value));
}

function toMarkdown(entry) {
  const url = entry.link?.find((l) => l.rel === "alternate")?.href || "";
  const title = entry.title?.$t || "(sin título)";
  const content = entry.content?.$t || entry.summary?.$t || "";
  return [
    "---",
    `title: ${escapeYaml(title)}`,
    `published: ${entry.published?.$t ?? ""}`,
    `updated: ${entry.updated?.$t ?? ""}`,
    `url: ${escapeYaml(url)}`,
    `id: ${escapeYaml(entry.id?.$t ?? "")}`,
    "---",
    "",
    content,
    "",
  ].join("\n");
}

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, "feeds"), { recursive: true });
  await mkdir(join(OUT, "posts"), { recursive: true });
  await mkdir(join(OUT, "pages"), { recursive: true });

  const [posts, pages, comments, home] = await Promise.all([
    fetchFeed("posts", `${BLOG}/feeds/posts/default?alt=json&max-results=${MAX_RESULTS}`),
    fetchFeed("pages", `${BLOG}/feeds/pages/default?alt=json&max-results=${MAX_RESULTS}`),
    fetchFeed("comments", `${BLOG}/feeds/comments/default?alt=json&max-results=${MAX_RESULTS}`),
    fetch(`${BLOG}/`, { headers: { Accept: "text/html" } }).then((r) => r.text()),
  ]);

  const blog = { url: BLOG, id: BLOG_ID, meta: posts.feed, entries: undefined };

  await writeFile(join(OUT, "feeds", "posts.json"), JSON.stringify(posts, null, 2));
  await writeFile(join(OUT, "feeds", "pages.json"), JSON.stringify(pages, null, 2));
  await writeFile(join(OUT, "feeds", "comments.json"), JSON.stringify(comments, null, 2));
  await writeFile(join(OUT, "feeds", "blog.json"), JSON.stringify(blog, null, 2));
  await writeFile(join(OUT, "site-home.html"), home);

  for (const entry of posts.feed?.entry || []) {
    const url = entry.link?.find((l) => l.rel === "alternate")?.href || "";
    const slug = slugFromUrl(url);
    await writeFile(join(OUT, "posts", `${slug}.md`), toMarkdown(entry));
  }
  for (const entry of pages.feed?.entry || []) {
    const url = entry.link?.find((l) => l.rel === "alternate")?.href || "";
    const slug = slugFromUrl(url);
    await writeFile(join(OUT, "pages", `${slug}.md`), toMarkdown(entry));
  }

  const readme = [
    `# Backup ${DATE}`,
    "",
    `Blog: ${BLOG}`,
    `Generado: ${new Date().toISOString()}`,
    "",
    "## Contenido",
    `- Posts: ${(posts.feed?.entry || []).length}`,
    `- Páginas: ${(pages.feed?.entry || []).length}`,
    `- Comentarios: ${(comments.feed?.entry || []).length}`,
    "",
    "## Fuentes",
    "- feeds/ : JSON crudo de feeds (posts, pages, comments, blog)",
    "- site-home.html : snapshot renderizado de la portada",
    "- posts/ y pages/ : markdown con front matter + contenido HTML",
    "",
  ].join("\n");
  await writeFile(join(OUT, "README.md"), readme);

  console.log(`backup OK: ${OUT}`);
}

run().catch((err) => {
  console.error("backup error:", err);
  process.exit(1);
});
