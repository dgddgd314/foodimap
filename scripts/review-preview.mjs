const DAY = 24 * 60 * 60 * 1000;
const REVIEW_FIELDS = ["reviewTitle", "reviewDate", "reviewImage"];

// 원문과 이미지의 공개 HTTP(S) 주소를 해석하고 실행 가능한 URL은 거부합니다.
function webUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// 실제 원문을 해석할 때만 HTML 파서를 불러오며 이미지 파일은 요청하지 않습니다.
export async function parseReviewPreview(html, pageUrl) {
  const { parse } = await import("parse5");
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

// 수동 입력이 없는 리뷰 필드가 있을 때만 OG 조회 대상 주소를 반환합니다.
function reviewSource(place) {
  if (REVIEW_FIELDS.every(key => typeof place[key] === "string" && place[key].trim())) return null;
  return webUrl(place.reviewUrl);
}

// 캐시가 없거나 만료 3일 전이면 갱신하고, 만료 정보가 없으면 7일마다 확인합니다.
function previewNeedsRefresh(preview, now) {
  const fetchedAt = Date.parse(preview?.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  const expiresAt = imageExpiresAt(preview.reviewImage);
  return expiresAt === null ? now - fetchedAt >= 7 * DAY : expiresAt - now <= 3 * DAY;
}

// 기존 단일 리뷰와 리뷰 배열을 모두 살펴 원문 요청 없이 갱신 필요 여부를 판단합니다.
export function reviewRefreshNeeded(places, cache, { now = Date.now(), forceRefresh = false } = {}) {
  return places.some(place => (place.reviews ?? [place]).some(review => {
    const sourceUrl = reviewSource(review);
    return sourceUrl && (forceRefresh || previewNeedsRefresh(cache[sourceUrl], now));
  }));
}

// 모든 방문 리뷰의 빈 필드를 OG로 보완하며 같은 URL의 캐시와 조회 결과를 공유합니다.
export async function refreshReviewPreviews(places, { cache = {}, fetchImpl = fetch, now = Date.now(), forceRefresh = false } = {}) {
  const previews = new Map();
  const nextCache = {};
  const warnings = [];
  const result = [];
  let fetchedCount = 0;
  // 리뷰 하나를 갱신하고 실패하거나 만료된 경우 기존 캐시의 사용 가능한 정보를 돌려줍니다.
  async function enrichReview(review, placeId) {
    const sourceUrl = reviewSource(review);
    if (!sourceUrl) return { ...review };
    if (!previews.has(sourceUrl)) {
      let preview = cache[sourceUrl] || {};
      if (forceRefresh || previewNeedsRefresh(preview, now)) {
        fetchedCount++;
        try {
          const response = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(15000), headers: { Accept: "text/html" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          preview = { ...await parseReviewPreview(await response.text(), response.url || sourceUrl), fetchedAt: new Date(now).toISOString() };
        } catch (error) {
          warnings.push(`${placeId}: ${sourceUrl} OG 조회 실패 (${error.message}). 이전 정보가 있으면 사용합니다.`);
        }
      }
      // 캐시에는 만료 시각을 남겨 다음 점검에도 재시도하고, 화면에 내보낼 주소만 숨깁니다.
      nextCache[sourceUrl] = preview;
      const expiry = imageExpiresAt(preview.reviewImage);
      if (expiry !== null && expiry <= now) {
        preview = { ...preview, reviewImage: "" };
        warnings.push(`${placeId}: ${sourceUrl} 만료된 OG 이미지 주소를 생략했습니다.`);
      }
      previews.set(sourceUrl, preview);
    }
    const preview = previews.get(sourceUrl);
    const enriched = { ...review };
    for (const key of REVIEW_FIELDS) {
      if (typeof review[key] !== "string" || !review[key].trim()) enriched[key] = preview[key] || "";
    }
    return enriched;
  }
  for (const place of places) {
    if (place.reviews) {
      const reviews = [];
      for (const review of place.reviews) reviews.push(await enrichReview(review, place.id));
      result.push({ ...place, reviews });
    } else {
      result.push(await enrichReview(place, place.id));
    }
  }
  return { places: result, cache: nextCache, warnings, fetchedCount };
}
