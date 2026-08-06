const SAVE_URL = "https://web.archive.org/save/";

export async function urlsFromSitemap(sitemapUrl, fetchImpl = fetch) {
  const res = await fetchImpl(sitemapUrl, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
}

export async function saveToWayback(urls, fetchImpl = fetch) {
  const results = [];
  for (const url of urls) {
    const target = `${SAVE_URL}${encodeURIComponent(url)}`;
    try {
      const res = await fetchImpl(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      results.push({ url, status: res.status, ok: res.ok });
    } catch (err) {
      results.push({ url, status: 0, ok: false, error: String(err) });
    }
  }
  return results;
}
