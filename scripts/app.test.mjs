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

test("점수 색상은 0점 파랑·2점 초록·3.5점 노랑·5점 빨강과 중간값을 연결한다", () => {
  const { context } = app();
  for (const [score, color] of [[0, "rgb(66,133,244)"], [1, "rgb(53,151,184)"],
    [2, "rgb(39,168,124)"], [3.5, "rgb(246,190,37)"], [5, "rgb(237,96,107)"]]) {
    assert.equal(context.scoreColor(score), color);
  }
});
