import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { refreshReviewPreviews } from "./review-preview.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// 공개 파일만 _site로 복사하고 OG 정보는 배포용 JSON과 주소 캐시에만 기록합니다.
export async function buildSite({ rootDir = projectRoot, fetchImpl = fetch, now = Date.now() } = {}) {
  const root = path.resolve(rootDir);
  const output = path.resolve(root, "_site");
  const cacheFile = path.join(root, ".cache", "review-previews.json");
  const source = JSON.parse(await readFile(path.join(root, "data", "places.json"), "utf8"));
  let cache = {};
  try { cache = JSON.parse(await readFile(cacheFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const refreshed = await refreshReviewPreviews(source, { cache, fetchImpl, now });
  // 삭제 대상은 이 프로젝트 바로 아래의 생성 전용 폴더로 제한합니다.
  if (path.dirname(output) !== root || path.basename(output) !== "_site") throw new Error("빌드 출력 경로를 확인해주세요.");
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, "data"), { recursive: true });
  for (const name of ["index.html", ".nojekyll", "assets"]) {
    await cp(path.join(root, name), path.join(output, name), { recursive: true });
  }
  await writeFile(path.join(output, "data", "places.json"), `${JSON.stringify(refreshed.places, null, 2)}\n`);
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(refreshed.cache, null, 2)}\n`);
  return refreshed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await buildSite();
    for (const warning of result.warnings) console.warn(warning);
    console.log(`_site에 식당 ${result.places.length}개를 준비했습니다. OG 원문 ${Object.keys(result.cache).length}개, 경고 ${result.warnings.length}개. 사진 파일은 다운로드하지 않습니다.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
