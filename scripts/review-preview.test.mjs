import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseReviewPreview, imageExpiresAt, refreshReviewPreviews } from "./review-preview.mjs";
import { buildSite } from "./build.mjs";

const sourceUrl = "https://example.com/review";
const now = Date.parse("2026-11-09T00:00:00Z");
const html = `<html><head>
  <META content='한 끼 &amp; &quot;리뷰&quot;' property='og:title'>
  <meta content='/photo.png?size=400&amp;signature=a%2Bb%3D' property='og:image'>
  <meta property="article:published_time" content="2026-11-08T23:55:00+09:00">
</head><body><meta property="og:image" content="https://wrong.example/body.png"></body></html>`;
const place = { id: "restaurant", reviewUrl: sourceUrl };

test("OG 속성 순서·HTML 엔티티·상대주소를 해석하고 서명과 현지 게시일을 유지한다", () => {
  assert.deepEqual(parseReviewPreview(html, sourceUrl), {
    reviewTitle: '한 끼 & "리뷰"', reviewDate: "2026-11-08",
    reviewImage: "https://example.com/photo.png?size=400&signature=a%2Bb%3D",
  });
  assert.equal(parseReviewPreview('<meta property="og:image" content="javascript:alert(1)">', sourceUrl).reviewImage, "");
  assert.equal(parseReviewPreview('<meta property="og:image" content="data:image/png;base64,AAAA">', sourceUrl).reviewImage, "");
});

test("수동 입력을 우선하고 빈 필드만 OG로 채우며 같은 원문과 이미지 파일을 중복 요청하지 않는다", async () => {
  const requests = [];
  const manual = { ...place, id: "manual", reviewImage: "https://images.example/manual.png", reviewTitle: "내 제목" };
  const result = await refreshReviewPreviews([manual, { ...place, reviewImage: " " }, { id: "no-review" }], {
    now, fetchImpl: async url => { requests.push(url); return new Response(html); },
  });
  assert.deepEqual(requests, [sourceUrl]);
  assert.equal(result.places[0].reviewImage, manual.reviewImage);
  assert.equal(result.places[0].reviewTitle, manual.reviewTitle);
  assert.equal(result.places[0].reviewDate, "2026-11-08");
  assert.match(result.places[1].reviewImage, /photo\.png/);
  assert.deepEqual(result.places[2], { id: "no-review" });
});

test("모든 필드를 직접 지정한 리뷰는 OG 요청 없이 유지한다", async () => {
  const manual = { ...place, reviewImage: "https://example.com/manual.png", reviewTitle: "제목", reviewDate: "2026-11-01" };
  const result = await refreshReviewPreviews([manual], { fetchImpl: async () => { throw new Error("요청하면 안 됩니다"); } });
  assert.deepEqual(result.places, [manual]);
  assert.deepEqual(result.warnings, []);
});

test("매 빌드에서 원문을 다시 읽어 캐시의 만료 주소를 최신 주소로 교체한다", async () => {
  const expired = `https://images.example/old.png?expires=${now / 1000 - 60}`;
  const fresh = `https://images.example/new.png?expires=${now / 1000 + 86400}`;
  const result = await refreshReviewPreviews([place], {
    now, cache: { [sourceUrl]: { reviewImage: expired } },
    fetchImpl: async () => new Response(`<meta property="og:image" content="${fresh}">`),
  });
  assert.equal(result.places[0].reviewImage, fresh);
  assert.equal(result.cache[sourceUrl].reviewImage, fresh);
});

test("원문 조회 실패 시 같은 URL의 캐시를 쓰되 중첩된 만료 이미지 주소는 숨긴다", async () => {
  const expired = `https://blog.example/image.png?expires=${now / 1000 - 1}&signature=unchanged`;
  const thumbnail = `https://thumb.example/?fname=${encodeURIComponent(expired)}`;
  assert.equal(imageExpiresAt(thumbnail), now - 1000);
  const cached = { reviewTitle: "저장된 제목", reviewDate: "2026-11-01", reviewImage: thumbnail };
  const result = await refreshReviewPreviews([place, { ...place, id: "new", reviewUrl: "https://example.com/other" }], {
    now, cache: { [sourceUrl]: cached }, fetchImpl: async () => new Response("Unavailable", { status: 503 }),
  });
  assert.equal(result.places[0].reviewTitle, cached.reviewTitle);
  assert.equal(result.places[0].reviewDate, cached.reviewDate);
  assert.equal(result.places[0].reviewImage, "");
  assert.equal(result.places[1].reviewTitle, "");
  assert.ok(result.warnings.some(warning => warning.includes("HTTP 503")));
  assert.ok(result.warnings.some(warning => warning.includes("만료")));
  const usable = await refreshReviewPreviews([place], {
    now, cache: { [sourceUrl]: { ...cached, reviewImage: "https://example.com/static.jpg" } },
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(usable.places[0].reviewImage, "https://example.com/static.jpg");
});

test("OG 이미지가 제거된 원문은 예전 사진을 계속 쓰지 않고 텍스트 카드로 남긴다", async () => {
  const result = await refreshReviewPreviews([place], {
    cache: { [sourceUrl]: { reviewImage: "https://example.com/deleted.jpg" } },
    fetchImpl: async () => new Response('<meta property="og:title" content="사진 없는 리뷰">'),
  });
  assert.equal(result.places[0].reviewTitle, "사진 없는 리뷰");
  assert.equal(result.places[0].reviewImage, "");
});

test("빌드는 원본 JSON을 바꾸지 않고 공개 파일과 OG 주소만 내보낸다", async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "foodimap-build-test-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, "data"));
  await mkdir(path.join(rootDir, "assets"));
  await writeFile(path.join(rootDir, "index.html"), "<html></html>");
  await writeFile(path.join(rootDir, ".nojekyll"), "");
  await writeFile(path.join(rootDir, "assets", "app.js"), "// public");
  await writeFile(path.join(rootDir, ".env.local"), "PRIVATE=must-not-publish");
  const source = JSON.stringify([place]);
  await writeFile(path.join(rootDir, "data", "places.json"), source);
  await buildSite({ rootDir, now, fetchImpl: async () => new Response(html) });
  assert.equal(await readFile(path.join(rootDir, "data", "places.json"), "utf8"), source);
  const built = JSON.parse(await readFile(path.join(rootDir, "_site", "data", "places.json"), "utf8"));
  assert.match(built[0].reviewImage, /^https:/);
  assert.deepEqual((await readdir(path.join(rootDir, "_site"))).sort(), [".nojekyll", "assets", "data", "index.html"]);
  assert.deepEqual(await readdir(path.join(rootDir, "_site", "assets")), ["app.js"]);
});
