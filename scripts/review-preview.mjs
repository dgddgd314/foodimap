import { parse } from "parse5";

// 원문과 이미지의 공개 HTTP(S) 주소를 해석하고 실행 가능한 URL은 거부합니다.
function webUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// HTML 파서로 head의 OG 정보와 게시일을 읽으며 이미지 파일은 요청하지 않습니다.
export function parseReviewPreview(html, pageUrl) {
  const document = parse(html);
  const head = document.childNodes.find(node => node.tagName === "html")?.childNodes.find(node => node.tagName === "head");
  const metadata = new Map();
  for (const node of head?.childNodes || []) {
    if (node.tagName !== "meta") continue;
    const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
    const key = (attributes.property || attributes.name || "").toLowerCase();
    const value = attributes.content?.trim();
    if (value && !metadata.has(key)) metadata.set(key, value);
  }
  const published = metadata.get("article:published_time") || "";
  const date = published.slice(0, 10);
  return {
    reviewTitle: metadata.get("og:title") || "",
    reviewDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? date : "",
    reviewImage: webUrl(metadata.get("og:image:secure_url"), pageUrl) || webUrl(metadata.get("og:image"), pageUrl) || "",
  };
}

// 티스토리 썸네일의 fname 안에 들어 있는 원본 주소까지 따라가 만료 시각을 찾습니다.
export function imageExpiresAt(imageUrl) {
  let current = webUrl(imageUrl);
  let expiresAt = null;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    const url = new URL(current);
    const seconds = Number(url.searchParams.get("expires"));
    if (Number.isFinite(seconds) && seconds > 0) {
      expiresAt = Math.min(expiresAt ?? Infinity, seconds * 1000);
    }
    current = webUrl(url.searchParams.get("fname"));
  }
  return expiresAt;
}

// 매 빌드마다 원문 정보를 갱신하고 수동 입력이 없는 필드만 채우며 실패 시 이전 정보를 사용합니다.
export async function refreshReviewPreviews(places, { cache = {}, fetchImpl = fetch, now = Date.now() } = {}) {
  const previews = new Map();
  const nextCache = {};
  const warnings = [];
  const result = [];
  for (const place of places) {
    const sourceUrl = webUrl(place.reviewUrl);
    const fields = ["reviewTitle", "reviewDate", "reviewImage"];
    if (!sourceUrl || fields.every(key => typeof place[key] === "string" && place[key].trim())) {
      result.push({ ...place });
      continue;
    }
    if (!previews.has(sourceUrl)) {
      let preview;
      try {
        const response = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(15000), headers: { Accept: "text/html" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        preview = { ...parseReviewPreview(await response.text(), response.url || sourceUrl), fetchedAt: new Date(now).toISOString() };
      } catch (error) {
        warnings.push(`${place.id}: OG 조회 실패 (${error.message}). 이전 정보가 있으면 사용합니다.`);
        preview = cache[sourceUrl] || {};
      }
      const expiry = imageExpiresAt(preview.reviewImage);
      if (expiry !== null && expiry <= now) {
        preview = { ...preview, reviewImage: "" };
        warnings.push(`${place.id}: 만료된 OG 이미지 주소를 생략했습니다.`);
      }
      previews.set(sourceUrl, preview);
      nextCache[sourceUrl] = preview;
    }
    const preview = previews.get(sourceUrl);
    const enriched = { ...place };
    for (const key of fields) {
      if (typeof place[key] !== "string" || !place[key].trim()) enriched[key] = preview[key] || "";
    }
    result.push(enriched);
  }
  return { places: result, cache: nextCache, warnings };
}
