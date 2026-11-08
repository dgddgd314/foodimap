const VIEWS = {
  gwanak: { center: [37.4812, 126.9527], naverZoom: 15 },
  nowon: { center: [37.6551, 127.0612], naverZoom: 15 },
  seoul: { bounds: [[37.425, 126.764], [37.702, 127.185]] },
  korea: { bounds: [[33.0, 124.5], [38.7, 132.0]] },
};
const detail = document.querySelector("#place-detail");
const content = document.querySelector("#detail-content");
const status = document.querySelector("#map-message");
const markers = new Map();
let map;
let places = [];
let selectedId = null;
let activeView = "gwanak";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 웹 링크를 검증하고, 기준 주소가 있으면 로컬 이미지의 상대 경로도 해석합니다.
function reviewUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, baseUrl);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

// 식당 필수 정보와 팝업에 표시할 리뷰 제목·게시일·이미지 주소를 검증합니다.
function validatePlaces(data) {
  if (!Array.isArray(data)) throw new Error("음식점 데이터는 배열이어야 합니다.");
  const ids = new Set();
  return data.map((place, index) => {
    if (!place || typeof place.id !== "string" || !place.id.trim() || ids.has(place.id)
      || typeof place.name !== "string" || !place.name.trim()
      || !Number.isFinite(place.lat) || Math.abs(place.lat) > 90
      || !Number.isFinite(place.lng) || Math.abs(place.lng) > 180
      || !Number.isFinite(place.score) || place.score < 0 || place.score > 5) {
      throw new Error(`${index + 1}번째 음식점의 ID, 이름, 좌표 또는 점수를 확인해주세요.`);
    }
    if (place.reviewUrl != null && place.reviewUrl !== "" && !reviewUrl(place.reviewUrl)) {
      throw new Error(`${index + 1}번째 음식점의 리뷰 주소를 확인해주세요.`);
    }
    ids.add(place.id);
    return { ...place, name: place.name.trim(), area: typeof place.area === "string" ? place.area : "",
      summary: typeof place.summary === "string" ? place.summary : "", reviewUrl: reviewUrl(place.reviewUrl),
      reviewTitle: typeof place.reviewTitle === "string" ? place.reviewTitle.trim() : "",
      reviewDate: typeof place.reviewDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(place.reviewDate)
        && Number.isFinite(Date.parse(place.reviewDate)) ? place.reviewDate : "",
      reviewImage: reviewUrl(place.reviewImage, document.baseURI),
      address: typeof place.address === "string" ? place.address : "",
      addressDetail: typeof place.addressDetail === "string" ? place.addressDetail : "",
      naverUrl: reviewUrl(place.naverUrl),
      isExample: place.isExample === true };
  });
}

function scoreColor(score) {
  const stops = [[39, 168, 124], [246, 190, 37], [237, 96, 107]];
  const position = Math.max(0, Math.min(5, score)) / 2.5;
  const index = Math.min(1, Math.floor(position));
  const fraction = position - index;
  return `rgb(${stops[index].map((value, i) => Math.round(value + (stops[index + 1][i] - value) * fraction)).join(",")})`;
}

// 대표이미지와 글 제목·게시일을 표시하고 누르면 원문이 열리는 리뷰 카드를 만듭니다.
function makeReviewLink(place) {
  const title = place.reviewTitle || `${place.name} 리뷰`;
  const dateText = place.reviewDate.replaceAll("-", ".");
  const link = element("a", "review-link");
  link.href = place.reviewUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${title}${dateText ? `, ${dateText} 게시` : ""} (새 탭)`);
  if (place.reviewImage) {
    const image = element("img", "review-image");
    image.src = place.reviewImage;
    image.alt = "";
    image.width = 88;
    image.height = 72;
    image.decoding = "async";
    image.addEventListener("error", () => image.remove(), { once: true });
    link.append(image);
  }
  const text = element("span", "review-text");
  text.append(element("span", "review-title", title));
  if (place.reviewDate) {
    const date = element("time", "review-date", dateText);
    date.dateTime = place.reviewDate;
    text.append(date);
  }
  link.append(text);
  return link;
}

// 지도와 상세 평점에 같은 모양과 점수 색상의 마커를 만듭니다.
function scoreMarker(score, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  // SVG에는 검증된 점수로 계산한 숫자 색상만 넣습니다.
  svg.innerHTML = `<circle cx="20" cy="20" r="15" fill="${scoreColor(score)}" stroke="#fff" stroke-width="2.5"/><path d="m20 10.5 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z" fill="#fff" stroke="#fff" stroke-width=".7" stroke-linejoin="round"/>`;
  return svg;
}

// 위치·식당 이름을 왼쪽에 묶고 평점을 오른쪽에 두며, 아래에 지도 링크와 리뷰를 표시합니다.
function selectPlace(place, fromKeyboard = false) {
  selectedId = place.id;
  content.replaceChildren();
  const heading = element("h1", "place-name", place.name);
  heading.id = "place-name";
  heading.tabIndex = -1;
  const score = element("div", "place-score");
  score.append(scoreMarker(place.score, "score-marker"), document.createTextNode(place.score.toFixed(1)));
  score.setAttribute("aria-label", `총점 ${place.score.toFixed(1)}점, 5점 만점`);
  const titleRow = element("div", "place-title-row");
  const identity = element("div", "place-identity");
  if (place.area) identity.append(element("p", "place-area", `${place.area}${place.isExample ? " · 예시" : ""}`));
  identity.append(heading);
  titleRow.append(identity, score);
  content.append(titleRow);
  if (place.address) content.append(element("p", "place-address", [place.address, place.addressDetail].filter(Boolean).join(" ")));
  if (place.summary) content.append(element("p", "place-summary", place.summary));
  const actions = element("div", "place-actions");
  if (place.naverUrl) {
    const link = element("a", "naver-link", "네이버 지도 ↗");
    const logo = element("img", "naver-logo");
    logo.src = "./assets/naver-logo-white.svg";
    logo.alt = "";
    logo.width = 48;
    logo.height = 9;
    link.prepend(logo);
    link.href = place.naverUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${place.name} 네이버 지도에서 보기 (새 탭)`);
    actions.append(link);
  }
  if (place.reviewUrl) actions.append(element("hr", "review-divider"), makeReviewLink(place));
  if (actions.childElementCount) content.append(actions);
  if (!place.reviewUrl) content.append(element("p", "example-note", place.isExample ? "예시 장소 · 실제 리뷰 없음" : "아직 연결된 리뷰가 없습니다."));
  detail.hidden = false;
  updateSelection();
  updateVisiblePlaces();
  if (fromKeyboard) heading.focus({ preventScroll: true });
}

function updateSelection() {
  markers.forEach(({ button, marker }, id) => {
    const selected = id === selectedId;
    button.setAttribute("aria-pressed", String(selected));
    marker.select(selected);
  });
}

function closeDetail(restoreFocus = false) {
  const previous = markers.get(selectedId)?.button;
  selectedId = null;
  detail.hidden = true;
  updateSelection();
  if (map) updateVisiblePlaces();
  if (restoreFocus && previous && !previous.hidden) previous.focus({ preventScroll: true });
}

// 클릭 영역을 유지한 지도 마커에 식당 이름과 선택 동작을 연결합니다.
function markerButton(place) {
  const button = element("button", "food-marker");
  button.type = "button";
  button.dataset.placeId = place.id;
  button.setAttribute("aria-label", `${place.isExample ? "예시, " : ""}${place.name}, ${place.score.toFixed(1)}점`);
  button.setAttribute("aria-pressed", "false");
  button.append(scoreMarker(place.score));
  button.append(element("span", "marker-label", place.name));
  const tooltip = element("span", "marker-tooltip", `${place.name} | `);
  const tooltipScore = element("strong", "marker-tooltip-score", place.score.toFixed(1));
  tooltipScore.style.color = scoreColor(place.score);
  tooltip.append(tooltipScore);
  tooltip.setAttribute("aria-hidden", "true");
  button.append(tooltip);
  button.addEventListener("click", event => {
    event.stopPropagation();
    selectPlace(place, event.detail === 0);
  });
  button.addEventListener("pointerdown", event => event.stopPropagation());
  button.addEventListener("dblclick", event => event.stopPropagation());
  return button;
}

function updateVisiblePlaces() {
  const visiblePlaces = [];
  places.forEach(place => {
    const visible = map.contains(place);
    markers.get(place.id).button.hidden = !visible;
    if (visible) visiblePlaces.push(place);
  });
  const bounds = document.querySelector("#map").getBoundingClientRect();
  const points = visiblePlaces.map(place => {
    const rect = markers.get(place.id).button.getBoundingClientRect();
    return { id: place.id, score: place.score, x: rect.left + rect.width / 2 - bounds.left,
      y: rect.top + rect.height / 2 - bounds.top };
  });
  const obstacles = [...document.querySelectorAll(".floating-control:not([hidden]), .map-meta")]
    .filter(node => getComputedStyle(node).visibility !== "hidden")
    .map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left - bounds.left - 8, right: rect.right - bounds.left + 8,
        top: rect.top - bounds.top - 8, bottom: rect.bottom - bounds.top + 8 };
    });
  const labels = FoodimapControls.sparseLabels(points, {
    zoom: map.getZoom(), width: bounds.width, height: bounds.height, obstacles,
  });
  markers.forEach(({ button }, id) => { button.dataset.labelVisible = String(labels.has(id)); });
  document.querySelector("#map-status").textContent = `현재 지도에 식당 ${visiblePlaces.length}개${places.some(place => place.isExample) ? " (예시 포함)" : ""}`;
}

function clearPreset() {
  activeView = null;
  document.querySelectorAll("[data-view]").forEach(button => button.setAttribute("aria-pressed", "false"));
}

function applyView(key) {
  activeView = key;
  closeDetail();
  map.applyView(VIEWS[key]);
  document.querySelectorAll("[data-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.view === key)));
  updateVisiblePlaces();
}

function showMessage(message, reload = true) {
  status.replaceChildren();
  status.hidden = !message;
  if (!message) return;
  status.append(document.createTextNode(message));
  if (!reload) return;
  const retry = element("button", "", "새로고침");
  retry.type = "button";
  retry.addEventListener("click", () => window.location.reload());
  status.append(retry);
}

async function locate() {
  const button = document.querySelector("#locate");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "현재 위치 확인 중");
  showMessage("현재 위치를 확인하고 있습니다…", false);
  try {
    const position = await FoodimapControls.currentLocation(navigator.geolocation, window.isSecureContext);
    clearPreset();
    closeDetail();
    map.showLocation(position);
    showMessage(places.length ? "" : "등록된 식당이 없습니다.", false);
    document.querySelector("#location-status").textContent = "현재 위치로 이동했습니다. 파란 원은 위치의 오차 범위입니다.";
  } catch (error) {
    showMessage(error.message || "현재 위치를 가져오지 못했습니다.", false);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.setAttribute("aria-label", "현재 위치로 이동");
    updateVisiblePlaces();
  }
}

// 식당 데이터를 불러오고 지도와 키보드·지역 선택 동작을 연결합니다.
async function init() {
  const config = window.FOODIMAP_CONFIG || {};
  if (reviewUrl(config.blogUrl)) {
    document.querySelector("#blog-link").href = config.blogUrl;
    document.querySelector("#brand-link").href = config.blogUrl;
  }
  if (reviewUrl(config.tagsUrl)) document.querySelector("#tags-link").href = config.tagsUrl;
  try {
    const response = await fetch(new URL("./data/places.json", document.baseURI));
    if (!response.ok) throw new Error(`음식점 정보를 불러오지 못했습니다. (${response.status})`);
    places = validatePlaces(await response.json());
    map = await FoodimapNaverMap.create(document.querySelector("#map"), config,
      message => showMessage(message || (places.length ? "" : "등록된 식당이 없습니다.")));
    map.applyView(VIEWS.gwanak);
    places.forEach(place => {
      const button = markerButton(place);
      const marker = map.addMarker(place, button);
      markers.set(place.id, { button, marker });
      button.addEventListener("pointerenter", () => marker.select(true));
      button.addEventListener("pointerleave", () => marker.select(selectedId === place.id));
      button.addEventListener("focus", () => marker.select(true));
      button.addEventListener("blur", () => marker.select(selectedId === place.id));
    });
    map.onMove(updateVisiblePlaces);
    map.onDrag(() => { clearPreset(); closeDetail(); });
    map.onClick(() => closeDetail());
    const locateButton = document.querySelector("#locate");
    locateButton.disabled = false;
    locateButton.addEventListener("click", locate);
    document.querySelectorAll("[data-view]").forEach(button => {
      button.disabled = false;
      button.addEventListener("click", () => applyView(button.dataset.view));
    });
    ["zoom-in", "zoom-out"].forEach((id, index) => {
      const button = document.getElementById(id);
      button.disabled = false;
      button.addEventListener("click", () => { clearPreset(); map.zoom(index === 0 ? 1 : -1); });
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !detail.hidden) closeDetail(true); });
    new ResizeObserver(() => {
      map.resize();
      if (activeView) map.applyView(VIEWS[activeView]);
      updateVisiblePlaces();
    }).observe(document.querySelector("#map"));
    updateVisiblePlaces();
    if (!places.length) showMessage("등록된 식당이 없습니다.");
  } catch (error) {
    showMessage(error.message || "지도를 불러오지 못했습니다.");
  }
}

init();
