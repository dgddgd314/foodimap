import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/naver-map.js", import.meta.url), "utf8");

function setup({ reducedMotion = false } = {}) {
  let script;
  let mapsCreated = 0;
  let timeout;
  let mapOptions;
  let zoom = 16;
  const zoomCalls = [];
  const locationMoves = [];
  const markers = [];
  const circles = [];
  const window = {
    setTimeout(callback) { timeout = callback; return 1; },
    matchMedia() { return { matches: reducedMotion }; },
  };
  const clearTimeout = () => { timeout = null; };
  const document = { createElement: () => ({}), head: { append(node) { script = node; } } };
  vm.runInNewContext(source, { window, document, clearTimeout });
  return {
    start: (config = {}) => window.FoodimapNaverMap.create({}, { naverClientId: "test-id", ...config }, () => {}),
    script: () => script,
    options: () => mapOptions,
    zoomCalls, locationMoves, markers, circles,
    ready: () => window.foodimapNaverReady(),
    loaded: () => script.onload(),
    networkFailure: () => script.onerror(),
    authenticationFailure: () => window.navermap_authFailure(),
    expire: () => timeout(),
    count: () => mapsCreated,
    publishApi() {
      window.naver = { maps: {
        Map: class {
          constructor(_container, options) { mapsCreated += 1; mapOptions = options; }
          getZoom() { return zoom; }
          setZoom(value, effect) { zoom = value; zoomCalls.push({ zoom, effect }); }
          morph(position, level) { locationMoves.push({ position, zoom: level, animate: true }); }
          updateBy(position, level) { locationMoves.push({ position, zoom: level, animate: false }); }
        },
        LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
        Size: class {}, Point: class {},
        Marker: class {
          constructor(options) { this.options = options; markers.push(this); }
          setPosition(position) { this.options.position = position; }
        },
        Circle: class {
          constructor(options) { this.options = options; circles.push(this); }
          setCenter(center) { this.options.center = center; }
          setRadius(radius) { this.options.radius = radius; }
        },
      } };
    },
  };
}

test("준비 콜백이 API 공개보다 먼저 와도 스크립트 실행 후 지도를 만든다", async () => {
  const sdk = setup();
  const result = sdk.start();
  sdk.ready();
  await Promise.resolve();
  assert.equal(sdk.count(), 0);
  sdk.publishApi();
  sdk.loaded();
  assert.equal(typeof (await result).applyView, "function");
  assert.equal(sdk.count(), 1);
});

test("키가 없으면 SDK를 요청하지 않고 설정 오류를 알린다", async () => {
  const sdk = setup();
  await assert.rejects(sdk.start({ naverClientId: "  " }), /Client ID/);
  assert.equal(sdk.script(), undefined);
  assert.equal(sdk.count(), 0);
});

test("기본 지도에서는 지명 레이어를 숨기지 않는다", async () => {
  const sdk = setup();
  const result = sdk.start();
  sdk.publishApi(); sdk.loaded(); sdk.ready();
  await result;
  assert.equal(sdk.options().mapTypes, undefined);
  assert.equal(sdk.options().mapTypeId, undefined);
  assert.equal(sdk.options().customStyleId, undefined);
  assert.equal(new URL(sdk.script().src).searchParams.get("submodules"), null);
});

test("스타일 ID를 설정하면 GL 모듈과 해당 스타일을 함께 사용한다", async () => {
  const sdk = setup();
  const result = sdk.start({ naverStyleId: " my-published-style " });
  assert.equal(new URL(sdk.script().src).searchParams.get("submodules"), "gl");
  sdk.publishApi(); sdk.loaded(); sdk.ready();
  await result;
  assert.equal(sdk.options().gl, true);
  assert.equal(sdk.options().customStyleId, "my-published-style");
});

test("줌 버튼은 애니메이션을 사용하며 확대·축소 한계를 지킨다", async () => {
  const sdk = setup();
  sdk.publishApi();
  const map = await sdk.start();
  map.zoom(1); map.zoom(1); map.zoom(-1);
  map.zoom(20); map.zoom(-30);
  assert.deepEqual(sdk.zoomCalls, [
    { zoom: 17, effect: true }, { zoom: 18, effect: true }, { zoom: 17, effect: true },
    { zoom: 20, effect: true }, { zoom: 5, effect: true },
  ]);
});

test("위치 버튼은 기존 위치 점·오차 원을 갱신하고 위치로 이동한다", async () => {
  const sdk = setup();
  sdk.publishApi();
  const map = await sdk.start();
  assert.equal(sdk.markers.length, 0);
  map.showLocation({ latitude: 37.5, longitude: 127, accuracy: 50 });
  map.showLocation({ latitude: 37.6, longitude: 127.1, accuracy: 25 });
  assert.equal(sdk.markers.length, 1);
  assert.equal(sdk.circles.length, 1);
  assert.equal(sdk.circles[0].options.radius, 25);
  assert.equal(sdk.circles[0].options.center.lat, 37.6);
  assert.equal(sdk.markers[0].options.position.lng, 127.1);
  assert.equal(sdk.locationMoves.length, 2);
  assert.equal(sdk.locationMoves[1].animate, true);
});

test("동작 줄이기를 설정하면 줌과 위치 이동 효과를 끈다", async () => {
  const sdk = setup({ reducedMotion: true });
  sdk.publishApi();
  const map = await sdk.start();
  map.zoom(1);
  map.showLocation({ latitude: 37.5, longitude: 127, accuracy: 10 });
  assert.equal(sdk.zoomCalls[0].effect, false);
  assert.equal(sdk.locationMoves[0].animate, false);
});

test("스크립트 로드 후 준비 콜백이 오는 순서도 처리한다", async () => {
  const sdk = setup();
  const result = sdk.start();
  sdk.publishApi();
  sdk.loaded();
  await Promise.resolve();
  assert.equal(sdk.count(), 0);
  sdk.ready();
  sdk.ready();
  assert.equal(typeof (await result).applyView, "function");
  assert.equal(sdk.count(), 1);
});

test("인증 실패 뒤에 로드가 완료되어도 지도를 생성하지 않는다", async () => {
  const sdk = setup();
  const result = sdk.start();
  const rejected = assert.rejects(result, /인증에 실패/);
  sdk.authenticationFailure();
  sdk.publishApi();
  sdk.ready();
  sdk.loaded();
  await rejected;
  assert.equal(sdk.count(), 0);
});

test("네트워크 실패와 준비 신호 누락을 구분해서 알린다", async () => {
  const network = setup();
  const networkResult = network.start();
  const networkRejected = assert.rejects(networkResult, /다운로드에 실패/);
  network.networkFailure();
  await networkRejected;

  const stalled = setup();
  const stalledResult = stalled.start();
  const stalledRejected = assert.rejects(stalledResult, /응답이 없습니다/);
  stalled.publishApi();
  stalled.loaded();
  stalled.expire();
  await stalledRejected;
  assert.equal(stalled.count(), 0);
});
