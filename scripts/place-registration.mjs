import { open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function naverPlace(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("네이버 지도 식당 링크를 확인해주세요."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("https 네이버 지도 식당 링크를 사용해주세요.");
  }
  let id;
  if (url.hostname === "map.naver.com") {
    id = url.pathname.match(/^\/p\/(?:entry\/place|search\/[^/]+\/place)\/(\d+)(?:\/|$)/)?.[1];
  } else if (["pcmap.place.naver.com", "m.place.naver.com"].includes(url.hostname)) {
    id = url.pathname.match(/^\/(?:restaurant|place)\/(\d+)(?:\/|$)/)?.[1];
  }
  if (!id) throw new Error("장소 ID가 있는 링크가 필요합니다. 짧은 공유 링크는 브라우저에서 연 뒤 주소창의 식당 링크를 복사해주세요.");
  return { naverPlaceId: id, naverUrl: `https://map.naver.com/p/entry/place/${id}` };
}

export function validateDraft(input) {
  const place = naverPlace(input?.naverUrl);
  for (const key of ["name", "address"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      throw new Error(`${key === "name" ? "식당 이름" : "주소"}을 입력해주세요.`);
    }
  }
  if (input.addressDetail != null && typeof input.addressDetail !== "string") {
    throw new Error("상세주소는 층·호수 등을 적은 문자열이어야 합니다.");
  }
  if (typeof input.score !== "number" || !Number.isFinite(input.score) || input.score < 0 || input.score > 5) {
    throw new Error("본인이 매긴 총점을 0~5 사이 숫자로 입력해주세요.");
  }
  let reviewUrl = null;
  if (input.reviewUrl) {
    let url;
    try { url = new URL(input.reviewUrl); } catch { throw new Error("리뷰 글 주소를 확인해주세요."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("리뷰 글 주소는 http 또는 https 링크여야 합니다.");
    }
    reviewUrl = url.href;
  }
  return {
    id: `naver-${place.naverPlaceId}`, ...place,
    name: input.name.trim(), address: input.address.trim(),
    addressDetail: input.addressDetail?.trim() || "",
    area: typeof input.area === "string" ? input.area.trim() : "",
    score: input.score,
    summary: typeof input.summary === "string" ? input.summary.trim() : "",
    reviewUrl, isExample: false,
  };
}

function coordinates(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export async function geocode(address, { clientId, clientSecret, fetchImpl = fetch } = {}) {
  if (!clientId?.trim() || !clientSecret?.trim()) {
    throw new Error(".env.local에 NAVER_MAPS_CLIENT_ID와 NAVER_MAPS_CLIENT_SECRET을 입력해주세요.");
  }
  if (typeof address !== "string" || !address.trim()) throw new Error("검색할 주소가 필요합니다.");
  const url = new URL("https://maps.apigw.ntruss.com/map-geocode/v2/geocode");
  url.searchParams.set("query", address.trim());
  url.searchParams.set("count", "100");
  let response;
  let data;
  try {
    response = await fetchImpl(url, {
      headers: { "x-ncp-apigw-api-key-id": clientId, "x-ncp-apigw-api-key": clientSecret, Accept: "application/json" },
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch {
    // 응답 본문이나 요청 헤더를 출력하지 않습니다.
    throw new Error(`주소 변환에 실패했습니다${response ? ` (HTTP ${response.status})` : ""}. 네트워크, API 키와 Geocoding 활성화 상태를 확인해주세요.`);
  }
  if (data.status !== "OK" || !Array.isArray(data.addresses)) throw new Error("네이버 주소 변환 응답을 확인할 수 없습니다.");
  if (data.meta?.totalCount > data.addresses.length) throw new Error("주소 후보가 너무 많습니다. 도로명과 건물 번호까지 입력해주세요.");
  const results = data.addresses.map(item => {
    if (item.x == null || item.y == null || String(item.x).trim() === "" || String(item.y).trim() === "") {
      throw new Error("주소 변환 결과의 좌표가 비어 있습니다.");
    }
    // Naver x = 경도, y = 위도. URL의 c는 지도 화면 설정이므로 사용하지 않습니다.
    const lng = Number(item.x);
    const lat = Number(item.y);
    if (!coordinates(lat, lng)) throw new Error("주소 변환 결과의 좌표가 올바르지 않습니다.");
    const address = item.roadAddress || item.jibunAddress;
    if (typeof address !== "string" || !address.trim()) throw new Error("주소 변환 결과에 주소가 없습니다.");
    return { address, lat, lng };
  });
  if (!results.length) throw new Error("일치하는 주소가 없습니다. 층·호수를 제외한 도로명 주소로 다시 입력해주세요.");
  return results;
}

export async function savePlace(file, draft, location) {
  const place = validateDraft(draft);
  if (!location || !coordinates(location.lat, location.lng) || typeof location.address !== "string" || !location.address.trim()) {
    throw new Error("확인된 주소와 좌표가 필요합니다.");
  }
  const lockPath = `${file}.lock`;
  let lock;
  try { lock = await open(lockPath, "wx"); } catch (error) {
    if (error.code === "EEXIST") throw new Error("다른 등록 작업이 진행 중입니다. 해당 작업을 마친 뒤 다시 실행해주세요.");
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const existing = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(existing)) throw new Error("기존 식당 데이터가 배열이 아닙니다.");
    if (existing.some(item => item.id === place.id || item.naverPlaceId === place.naverPlaceId)) {
      throw new Error("이미 등록한 식당입니다. 기존 기록을 덮어쓰지 않았습니다.");
    }
    const record = { ...place, lat: location.lat, lng: location.lng,
      geocoding: { provider: "naver", matchedAddress: location.address, resolvedAt: new Date().toISOString() } };
    const output = await open(temporary, "wx");
    try {
      await output.writeFile(`${JSON.stringify([...existing, record], null, 2)}\n`, "utf8");
      await output.sync();
    } finally { await output.close(); }
    await rename(temporary, file);
    return record;
  } finally {
    try {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
