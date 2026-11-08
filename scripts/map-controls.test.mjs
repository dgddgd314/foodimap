import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const window = {};
vm.runInNewContext(await readFile(new URL("../assets/map-controls.js", import.meta.url), "utf8"), { window });
const { sparseLabels, currentLocation } = window.FoodimapControls;
const viewport = { zoom: 16, width: 1200, height: 800 };
const points = Array.from({ length: 9 }, (_, i) => ({
  id: String(i), score: 5 - i / 10, x: 150 + i % 3 * 300, y: 150 + Math.floor(i / 3) * 200,
}));

test("이름은 일부만 표시하고 작은 배율에서는 생략한다", () => {
  assert.equal(sparseLabels(points, viewport).size, 3);
  assert.equal(sparseLabels(points, { ...viewport, zoom: 13 }).size, 0);
  assert.equal(sparseLabels([], viewport).size, 0);
  assert.deepEqual([...sparseLabels(points.slice(0, 1), viewport)], ["0"]);
});

test("밀집된 이름을 띄우고 데이터 순서가 바뀌어도 동일한 이름을 선택한다", () => {
  const crowded = points.map((point, i) => ({ ...point, x: 200 + i * 12, y: 200 }));
  assert.equal(sparseLabels(crowded, viewport).size, 1);
  assert.deepEqual([...sparseLabels(points, viewport)], [...sparseLabels([...points].reverse(), viewport)]);
});

test("화면 가장자리·컨트롤·다른 마커에 가려지는 이름을 생략한다", () => {
  assert.equal(sparseLabels([{ ...points[0], x: 20 }], viewport).size, 0);
  assert.equal(sparseLabels([{ ...points[0], y: 780 }], viewport).size, 0);
  assert.equal(sparseLabels([points[0]], { ...viewport,
    obstacles: [{ left: 75, right: 225, top: 165, bottom: 195 }],
  }).size, 0);
  const overlap = [{ id: "top", score: 5, x: 200, y: 200 }, { id: "bottom", score: 4, x: 200, y: 240 }];
  assert.deepEqual([...sparseLabels(overlap, viewport)], ["bottom"]);
});

test("위치 요청은 호출 시 한 번 수행하고 시간 제한과 캐시 만료를 지정한다", async () => {
  let calls = 0;
  let options;
  const geolocation = { getCurrentPosition(success, _failure, settings) {
    calls += 1; options = settings;
    success({ coords: { latitude: 37.5, longitude: 127, accuracy: 42, altitude: 30 } });
  } };
  assert.equal(calls, 0);
  const result = await currentLocation(geolocation, true);
  assert.equal(calls, 1);
  assert.deepEqual({ ...result }, { latitude: 37.5, longitude: 127, accuracy: 42 });
  assert.equal(options.enableHighAccuracy, true);
  assert.equal(options.timeout, 15000);
  assert.equal(options.maximumAge, 30000);
});

test("위치 권한 거부·위치 확인 실패·시간 초과를 구분한다", async () => {
  for (const [code, message] of [[1, /위치 권한/], [2, /기기의 위치 설정/], [3, /시간이 초과/]]) {
    await assert.rejects(currentLocation({ getCurrentPosition(_success, failure) { failure({ code }); } }, true), message);
  }
});

test("HTTPS·API 지원과 올바른 좌표를 확인하고 불가능한 위치는 사용하지 않는다", async () => {
  let requested = false;
  const geolocation = { getCurrentPosition() { requested = true; } };
  await assert.rejects(currentLocation(geolocation, false), /HTTPS/);
  assert.equal(requested, false);
  await assert.rejects(currentLocation(undefined, true), /지원하지 않습니다/);
  await assert.rejects(currentLocation({ getCurrentPosition(success) {
    success({ coords: { latitude: 100, longitude: 127, accuracy: 10 } });
  } }, true), /확인하지 못했습니다/);
});
