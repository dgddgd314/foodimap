import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");

// 지도 SDK 없이 팝업에 생성되는 요소와 속성을 관찰합니다.
function node(tagName) {
  return {
    tagName, children: [], attributes: {},
    // 자식 요소를 표시 순서대로 보관합니다.
    append(...children) { this.children.push(...children); },
    // 지도 로고를 링크 맨 앞에 넣습니다.
    prepend(...children) { this.children.unshift(...children); },
    // 팝업을 다시 열면 이전 내용을 비웁니다.
    replaceChildren(...children) { this.children = children; },
    // 접근성 속성을 검사할 수 있도록 기록합니다.
    setAttribute(key, value) { this.attributes[key] = value; },
    // 이미지 로드 이벤트는 실제 네트워크 없이 등록만 허용합니다.
    addEventListener() {},
    // 실제 DOM처럼 현재 자식 수를 반환합니다.
    get childElementCount() { return this.children.length; },
  };
}

// 앱 초기화와 지도 배치만 제외하고 실제 검증·색상·팝업 함수를 실행합니다.
function app() {
  const elements = new Map();
  const document = {
    baseURI: "https://example.com/foodimap/",
    // 선택한 컨테이너를 반복 조회해도 같은 객체를 반환합니다.
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, node("div"));
      return elements.get(selector);
    },
    createElement: node,
    createElementNS: (_namespace, tag) => node(tag),
    createTextNode: text => ({ textContent: text }),
  };
  const context = vm.createContext({ document, URL });
  vm.runInContext(source.replace(/\ninit\(\);\s*$/, ""), context);
  vm.runInContext("updateVisiblePlaces = () => {};", context);
  return { context, elements };
}

const place = { id: "place", name: "식당", lat: 37.5, lng: 127, score: 3.5 };

test("점수 색상은 0점 파랑·2점 초록·3.5점 노랑·5점 빨강과 중간값을 연결한다", () => {
  const { context } = app();
  for (const [score, color] of [[0, "rgb(66,133,244)"], [1, "rgb(53,151,184)"],
    [2, "rgb(39,168,124)"], [3.5, "rgb(246,190,37)"], [5, "rgb(237,96,107)"]]) {
    assert.equal(context.scoreColor(score), color);
  }
});

test("기존 단일 리뷰와 새 리뷰 배열을 읽고 잘못된 리뷰 입력을 거부한다", () => {
  const { context } = app();
  const legacy = context.validatePlaces([{ ...place, reviewUrl: "https://example.com/old" }])[0];
  assert.equal(legacy.reviews.length, 1);
  assert.equal(legacy.reviews[0].score, 3.5);
  assert.equal(legacy.reviews[0].reviewDate, "");
  for (const reviews of [{}, [], [null], [{ score: 6 }], [{ score: 3, reviewUrl: "javascript:alert(1)" }]]) {
    assert.throws(() => context.validatePlaces([{ ...place, reviews }]), /리뷰/);
  }
});

test("팝업은 모든 리뷰 링크를 최근 등록 순으로 표시하고 개별 평점과 누적 평점을 구분한다", () => {
  const { context, elements } = app();
  const entries = [
    { score: 4, reviewUrl: "https://example.com/first", reviewTitle: "첫 리뷰", reviewDate: "2026-11-10" },
    { score: 0, reviewUrl: null },
    { score: 5, reviewUrl: "https://example.com/latest", reviewDate: "2026-11-01" },
  ];
  const validated = context.validatePlaces([{ ...place, reviews: entries }])[0];
  context.selectPlace(validated);
  const content = elements.get("#detail-content");
  const actions = content.children.find(child => child.className === "place-actions");
  const links = actions.children.filter(child => child.tagName === "a");
  assert.deepEqual(links.map(link => link.href), [entries[2].reviewUrl, entries[0].reviewUrl]);
  assert.match(links[0].attributes["aria-label"], /식당 리뷰, 5.0점/);
  assert.match(links[1].attributes["aria-label"], /첫 리뷰, 4.0점/);
  const titleRow = content.children[0];
  assert.match(titleRow.children[1].attributes["aria-label"], /총점 3.5점/);
  assert.equal(validated.reviews[0].reviewUrl, entries[0].reviewUrl);
  context.selectPlace(context.validatePlaces([place])[0]);
  assert.ok(content.children.some(child => child.className === "review-empty"));
});
