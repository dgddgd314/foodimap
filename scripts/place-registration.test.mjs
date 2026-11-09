import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, readdir, unlink, rmdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { naverPlace, geocode, savePlace, validateDraft } from "./place-registration.mjs";

const draft = { naverUrl: "https://map.naver.com/p/entry/place/1865441465?c=15.00,0,0,0,dh&placePath=%2Fhome", name: "테스트 식당", address: "테스트 도로 1", addressDetail: " 지하 1층 101호 ", score: 0, reviewUrl: null };
const location = { address: "테스트 도로 1", lat: 37.4812, lng: 126.9527 };
const auth = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const addressResponse = { status: "OK", meta: { totalCount: 1 }, addresses: [{ roadAddress: location.address, x: String(location.lng), y: String(location.lat) }] };
const reply = body => async () => new Response(JSON.stringify(body), { status: 200 });

async function fixture(t) {
  const parent = fileURLToPath(new URL("../.local/", import.meta.url));
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, "registration-test-"));
  const file = path.join(dir, "places.json");
  await writeFile(file, "[]\n");
  t.after(async () => {
    for (const entry of await readdir(dir)) await unlink(path.join(dir, entry));
    await rmdir(dir);
  });
  return file;
}

test("네이버 장소 ID를 유지하고 화면 설정·추적 쿼리를 제거한다", () => {
  const source = naverPlace(draft.naverUrl);
  assert.deepEqual(source, { naverPlaceId: "1865441465", naverUrl: "https://map.naver.com/p/entry/place/1865441465" });
  assert.deepEqual(naverPlace("https://m.place.naver.com/restaurant/1865441465/home"), source);
  assert.deepEqual(naverPlace("https://pcmap.place.naver.com/restaurant/1865441465/home"), source);
  assert.throws(() => naverPlace("https://map.naver.com.evil.example/p/entry/place/1865441465"));
  assert.throws(() => naverPlace("https://naver.me/example"), /주소창/);
  assert.throws(() => naverPlace("https://map.naver.com/p?c=126.95,37.48,15"));
});

test("평점 누락을 0으로 채우지 않고 실제 0점은 보존한다", () => {
  assert.equal(validateDraft(draft).score, 0);
  for (const score of [null, undefined, "", "4", -1, 6, NaN]) assert.throws(() => validateDraft({ ...draft, score }));
  assert.throws(() => validateDraft({ ...draft, reviewUrl: "javascript:alert(1)" }));
  assert.throws(() => validateDraft({ ...draft, address: " " }));
  assert.throws(() => validateDraft({ ...draft, addressDetail: 3 }), /상세주소/);
  assert.equal(validateDraft({ ...draft, addressDetail: undefined }).addressDetail, "");
});

test("선택한 리뷰 제목·게시일·외부 이미지 주소를 보존하고 비어 있으면 OG 자동 입력용으로 남긴다", async t => {
  const file = await fixture(t);
  const review = { reviewTitle: " 내 리뷰 ", reviewDate: "2026-11-08", reviewImage: "https://images.example/food.jpg" };
  const saved = await savePlace(file, { ...draft, ...review }, location);
  assert.equal(saved.reviewTitle, "내 리뷰");
  assert.equal(saved.reviewDate, review.reviewDate);
  assert.equal(saved.reviewImage, review.reviewImage);
  assert.equal(validateDraft(draft).reviewImage, "");
  assert.throws(() => validateDraft({ ...draft, reviewImage: "javascript:alert(1)" }));
  assert.throws(() => validateDraft({ ...draft, reviewImage: "./assets/photo.jpg" }));
  assert.throws(() => validateDraft({ ...draft, reviewDate: "어제" }));
});

test("주소를 API에 전달하고 x/y를 경도/위도로 저장한다", async () => {
  const results = await geocode(draft.address, { ...auth, fetchImpl: async (url, options) => {
    assert.equal(url.origin, "https://maps.apigw.ntruss.com");
    assert.equal(url.searchParams.get("query"), draft.address);
    assert.equal(options.headers["x-ncp-apigw-api-key"], auth.clientSecret);
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify(addressResponse));
  } });
  assert.deepEqual(results, [location]);
});

test("주소 후보가 여러 개면 첫 번째로 임의 확정하지 않는다", async () => {
  const second = { roadAddress: "테스트 도로 2", x: "127.1", y: "37.6" };
  const results = await geocode(draft.address, { ...auth, fetchImpl: reply({ ...addressResponse, meta: { totalCount: 2 }, addresses: [...addressResponse.addresses, second] }) });
  assert.equal(results.length, 2);
});

test("인증·할당량·네트워크 오류에서 비밀키를 출력하지 않는다", async () => {
  const fetchers = [
    async () => new Response(auth.clientSecret, { status: 401 }),
    async () => new Response(auth.clientSecret, { status: 429 }),
    async () => { throw new Error(auth.clientSecret); },
  ];
  for (const fetchImpl of fetchers) {
    await assert.rejects(() => geocode(draft.address, { ...auth, fetchImpl }), error => !error.message.includes(auth.clientSecret) && /실패/.test(error.message));
  }
  let fetched = false;
  await assert.rejects(() => geocode(draft.address, { fetchImpl: async () => { fetched = true; } }), /env.local/);
  assert.equal(fetched, false);
});

test("빈 검색 결과·비정상 좌표·잘못된 응답을 거부한다", async () => {
  const invalid = [
    { status: "OK", addresses: [] },
    { status: "INVALID_REQUEST", addresses: [] },
    { ...addressResponse, addresses: [{ roadAddress: "주소", x: "", y: "37" }] },
    { ...addressResponse, addresses: [{ roadAddress: "주소", x: "127", y: "999" }] },
    { ...addressResponse, meta: { totalCount: 101 } },
  ];
  for (const body of invalid) await assert.rejects(() => geocode(draft.address, { ...auth, fetchImpl: reply(body) }));
});

test("확인한 좌표만 기존 데이터에 추가하고 중복 등록은 덮어쓰지 않는다", async t => {
  const file = await fixture(t);
  await writeFile(file, JSON.stringify([{ id: "keep-this", name: "기존 기록" }]));
  const record = await savePlace(file, draft, location);
  const content = await readFile(file, "utf8");
  const records = JSON.parse(content);
  assert.equal(records.length, 2);
  assert.equal(records[0].id, "keep-this");
  assert.equal(records[1].lat, location.lat);
  assert.equal(records[1].lng, location.lng);
  assert.equal(records[1].address, draft.address);
  assert.equal(records[1].addressDetail, "지하 1층 101호");
  assert.equal(record.naverPlaceId, "1865441465");
  assert.equal(record.isExample, false);
  assert.equal(record.reviewUrl, null);
  assert.equal(record.geocoding.provider, "naver");
  assert.equal(content.includes(auth.clientSecret), false);
  await assert.rejects(() => savePlace(file, draft, location), /이미 등록/);
  assert.equal(await readFile(file, "utf8"), content);
  assert.deepEqual(await readdir(path.dirname(file)), ["places.json"]);
});

test("오류나 동시 등록 시 기존 파일을 보존한다", async t => {
  const file = await fixture(t);
  const original = await readFile(file, "utf8");
  await assert.rejects(() => savePlace(file, draft, { ...location, lat: NaN }));
  await writeFile(`${file}.lock`, "");
  await assert.rejects(() => savePlace(file, draft, location), /다른 등록/);
  assert.equal(await readFile(file, "utf8"), original);
  await unlink(`${file}.lock`);
  await writeFile(file, "broken json");
  await assert.rejects(() => savePlace(file, draft, location));
  assert.equal(await readFile(file, "utf8"), "broken json");
  assert.deepEqual(await readdir(path.dirname(file)), ["places.json"]);
});
