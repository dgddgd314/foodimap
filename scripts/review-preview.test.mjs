import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseReviewPreview, imageExpiresAt, refreshReviewPreviews, reviewRefreshNeeded } from "./review-preview.mjs";
import { buildSite } from "./build.mjs";

const sourceUrl = "https://example.com/review";
const now = Date.parse("2026-11-09T00:00:00Z");
const html = `<html><head>
  <META content='한 끼 &amp; &quot;리뷰&quot;' property='og:title'>
  <meta content='/photo.png?size=400&amp;signature=a%2Bb%3D' property='og:image'>
  <meta property="article:published_time" content="2026-11-08T23:55:00+09:00">
</head><body><meta property="og:image" content="https://wrong.example/body.png"></body></html>`;
const place = { id: "restaurant", reviewUrl: sourceUrl };

test("OG 속성 순서·HTML 엔티티·상대주소를 해석하고 서명과 현지 게시일을 유지한다", async () => {
  assert.deepEqual(await parseReviewPreview(html, sourceUrl), {
    reviewTitle: '한 끼 & "리뷰"', reviewDate: "2026-11-08",
    reviewImage: "https://example.com/photo.png?size=400&signature=a%2Bb%3D",
  });
  assert.equal((await parseReviewPreview('<meta property="og:image" content="javascript:alert(1)">', sourceUrl)).reviewImage, "");
  assert.equal((await parseReviewPreview('<meta property="og:image" content="data:image/png;base64,AAAA">', sourceUrl)).reviewImage, "");
});

test("수동 입력을 우선하고 빈 필드만 OG로 채우며 같은 원문은 한 번만 조회한다", async () => {
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

test("최근에 조회한 캐시라도 이미지 주소가 만료되면 최신 주소로 교체한다", async () => {
  const expired = `https://images.example/old.png?expires=${now / 1000 - 60}`;
  const fresh = `https://images.example/new.png?expires=${now / 1000 + 86400}`;
  const result = await refreshReviewPreviews([place], {
    now, cache: { [sourceUrl]: { reviewImage: expired, fetchedAt: new Date(now - 86400000).toISOString() } },
    fetchImpl: async () => new Response(`<meta property="og:image" content="${fresh}">`),
  });
  assert.equal(result.places[0].reviewImage, fresh);
  assert.equal(result.cache[sourceUrl].reviewImage, fresh);
});

test("유효기간이 충분하면 원문 요청 없이 캐시를 쓰고 만료 3일 전부터 갱신한다", async () => {
  const day = 86400000;
  const expiresAt = now + 20 * day;
  const cached = { reviewTitle: "기존 제목", reviewImage: `https://images.example/photo.png?expires=${expiresAt / 1000}`, fetchedAt: new Date(now).toISOString() };
  const cache = { [sourceUrl]: cached };
  const before = expiresAt - 3 * day - 1;
  assert.equal(reviewRefreshNeeded([place], cache, { now: before }), false);
  const reused = await refreshReviewPreviews([place], {
    cache, now: before, fetchImpl: async () => { throw new Error("이 시점에는 원문 요청 금지"); },
  });
  assert.equal(reused.fetchedCount, 0);
  assert.deepEqual(reused.warnings, []);
  assert.equal(reused.places[0].reviewImage, cached.reviewImage);
  assert.equal(reused.cache[sourceUrl].fetchedAt, cached.fetchedAt);
  const due = expiresAt - 3 * day;
  assert.equal(reviewRefreshNeeded([place], cache, { now: due }), true);
  const refreshed = await refreshReviewPreviews([place], { cache, now: due, fetchImpl: async () => new Response(html) });
  assert.equal(refreshed.fetchedCount, 1);
  assert.match(refreshed.places[0].reviewImage, /photo\.png\?size=400/);
});

test("만료 정보가 없거나 사진이 없는 리뷰는 7일마다 확인하며 새 리뷰는 즉시 조회한다", async () => {
  for (const reviewImage of ["https://images.example/static.png", ""]) {
    const cache = { [sourceUrl]: { reviewTitle: "제목", reviewImage, fetchedAt: new Date(now).toISOString() } };
    assert.equal(reviewRefreshNeeded([place], cache, { now: now + 7 * 86400000 - 1 }), false);
    const refreshed = await refreshReviewPreviews([place], {
      cache, now: now + 7 * 86400000, fetchImpl: async () => new Response(html),
    });
    assert.equal(refreshed.fetchedCount, 1);
  }
  assert.equal(reviewRefreshNeeded([place], {}, { now }), true);
  assert.equal(reviewRefreshNeeded([{ id: "no-review" }], {}, { now }), false);
});

test("수동 강제 갱신은 유효기간이 남은 캐시도 다시 읽는다", async () => {
  const cache = { [sourceUrl]: { reviewImage: `https://images.example/old.png?expires=${now / 1000 + 30 * 86400}`, fetchedAt: new Date(now).toISOString() } };
  assert.equal(reviewRefreshNeeded([place], cache, { now, forceRefresh: true }), true);
  const result = await refreshReviewPreviews([place], { cache, now, forceRefresh: true, fetchImpl: async () => new Response(html) });
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.places[0].reviewTitle, '한 끼 & "리뷰"');
});

test("원문 조회 실패 시 같은 URL의 캐시를 쓰되 중첩된 만료 이미지 주소는 숨긴다", async () => {
  const expired = `https://blog.example/image.png?expires=${now / 1000 - 1}&signature=unchanged`;
  const thumbnail = `https://thumb.example/?fname=${encodeURIComponent(expired)}`;
  assert.equal(imageExpiresAt(thumbnail), now - 1000);
  const cached = {
    reviewTitle: "저장된 제목", reviewDate: "2026-11-01", reviewImage: thumbnail,
    fetchedAt: new Date(now - 86400000).toISOString(),
  };
  const result = await refreshReviewPreviews([place, { ...place, id: "new", reviewUrl: "https://example.com/other" }], {
    now, cache: { [sourceUrl]: cached }, fetchImpl: async () => new Response("Unavailable", { status: 503 }),
  });
  assert.equal(result.places[0].reviewTitle, cached.reviewTitle);
  assert.equal(result.places[0].reviewDate, cached.reviewDate);
  assert.equal(result.places[0].reviewImage, "");
  assert.equal(result.places[1].reviewTitle, "");
  assert.ok(result.warnings.some(warning => warning.includes("HTTP 503")));
  assert.ok(result.warnings.some(warning => warning.includes("만료")));
  assert.equal(result.cache[sourceUrl].reviewImage, thumbnail);
  assert.equal(reviewRefreshNeeded([place], result.cache, { now: now + 86400000 }), true);
  const usable = await refreshReviewPreviews([place], {
    now, cache: { [sourceUrl]: {
      ...cached, reviewImage: "https://example.com/static.jpg", fetchedAt: new Date(now - 7 * 86400000).toISOString(),
    } },
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(usable.places[0].reviewImage, "https://example.com/static.jpg");
  assert.ok(usable.warnings.some(warning => warning.includes("offline")));
});

test("OG 이미지가 제거된 원문은 예전 사진을 계속 쓰지 않고 텍스트 카드로 남긴다", async () => {
  const result = await refreshReviewPreviews([place], {
    now, cache: { [sourceUrl]: { reviewImage: "https://example.com/deleted.jpg", fetchedAt: new Date(now - 7 * 86400000).toISOString() } },
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
  const check = await buildSite({ rootDir, now, checkOnly: true, fetchImpl: async () => { throw new Error("점검 중 원문 요청 금지"); } });
  assert.equal(check.refreshNeeded, true);
  assert.equal((await readdir(rootDir)).includes("_site"), false);
  await buildSite({ rootDir, now, fetchImpl: async () => new Response(html) });
  assert.equal((await buildSite({ rootDir, now, checkOnly: true })).refreshNeeded, false);
  assert.equal(await readFile(path.join(rootDir, "data", "places.json"), "utf8"), source);
  const built = JSON.parse(await readFile(path.join(rootDir, "_site", "data", "places.json"), "utf8"));
  assert.match(built[0].reviewImage, /^https:/);
  assert.deepEqual((await readdir(path.join(rootDir, "_site"))).sort(), [".nojekyll", "assets", "data", "index.html"]);
  assert.deepEqual(await readdir(path.join(rootDir, "_site", "assets")), ["app.js"]);
});
