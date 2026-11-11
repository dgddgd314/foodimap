// 로컬에서만 실행합니다. GitHub Pages에는 좌표가 저장된 JSON만 필요합니다.
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findPlace, geocode, savePlace, validateDraft } from "./place-registration.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("사용법: npm run add-place [-- --input .local/restaurant.json]\n네이버 링크로 새 식당을 등록하거나 기존 식당에 리뷰를 추가합니다.\n기존 식당은 좌표 변환 없이 이전 누적 평점과 새 평점을 절반씩 반영합니다.\n새 식당의 좌표 변환에는 기본 주소만 사용하며 층·호수는 별도로 저장합니다. Client Secret은 .env.local에만 입력하세요.");
  process.exit(0);
}

let prompt;
try {
  if (args.length && (args.length !== 2 || args[0] !== "--input")) throw new Error("인수 형식을 확인해주세요. npm run add-place -- --help");
  try { process.loadEnvFile(path.join(root, ".env.local")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const clientId = process.env.NAVER_MAPS_CLIENT_ID;
  const clientSecret = process.env.NAVER_MAPS_CLIENT_SECRET;
  const initial = args.length ? JSON.parse(await readFile(path.resolve(root, args[1]), "utf8")) : {};
  prompt = createInterface({ input: process.stdin, output: process.stdout });
  // 입력값을 묻고 Enter이면 초안의 기본값을 사용합니다.
  const ask = async (label, value = "") => (await prompt.question(`${label}${value !== "" && value != null ? ` [${value}]` : ""}: `)).trim() || (value ?? "");
  const file = path.join(root, "data", "places.json");
  const places = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(places)) throw new Error("기존 식당 데이터가 배열이 아닙니다.");
  const naverUrl = await ask("네이버 지도 식당 링크", initial.naverUrl);
  const previous = findPlace(places, naverUrl);
  if (previous) console.log(`\n${previous.name}에 리뷰를 추가합니다. 현재 누적 평점: ${previous.score}`);
  const draft = {
    naverUrl,
    name: previous ? previous.name : await ask("식당 이름·지점명", initial.name),
    address: previous ? previous.address : await ask("도로명 주소 (층·호수 제외)", initial.address),
    addressDetail: previous ? previous.addressDetail : await ask("상세주소 (층·호수, 선택)", initial.addressDetail),
    area: previous ? previous.area : await ask("지역 표시 (선택)", initial.area),
    score: await ask("이번 방문 평점 (0~5)", initial.score),
    summary: previous ? previous.summary : await ask("식당 한 줄 메모 (선택)", initial.summary),
    reviewUrl: await ask("티스토리 리뷰 링크 (선택)", initial.reviewUrl),
    reviewTitle: await ask("리뷰 제목 (비우면 OG 자동 입력)", initial.reviewTitle),
    reviewDate: await ask("리뷰 게시일 YYYY-MM-DD (비우면 자동 입력)", initial.reviewDate),
    reviewImage: await ask("대표사진 웹 주소 (비우면 OG 이미지)", initial.reviewImage),
  };
  draft.score = draft.score === "" ? null : Number(draft.score);
  const validated = validateDraft(draft);
  let location;
  if (!previous) {
    const candidates = await geocode(validated.address, { clientId, clientSecret });
    console.log("\n주소 변환 결과:");
    candidates.forEach((item, index) => console.log(`${index + 1}. ${item.address} — 위도 ${item.lat}, 경도 ${item.lng}`));
    const choice = candidates.length === 1 ? 1 : Number(await prompt.question("해당 식당의 주소 번호: "));
    if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) throw new Error("올바른 주소 번호를 선택해주세요. 저장하지 않았습니다.");
    location = candidates[choice - 1];
  }
  const score = previous ? (previous.score + validated.score) / 2 : validated.score;
  console.log(`\n${validated.name} · 이번 평점 ${validated.score} · 반영 후 총점 ${score}\n주소: ${validated.address}\n상세주소: ${validated.addressDetail || "없음"}\n${validated.naverUrl}\n리뷰: ${validated.reviewUrl || "아직 없음"}`);
  if (!/^(y|yes)$/i.test((await prompt.question("위 기록을 저장할까요? (y/N): ")).trim())) {
    console.log("저장하지 않았습니다.");
  } else {
    const result = await savePlace(file, validated, location);
    console.log(`저장했습니다: data/places.json (${result.id}) · 누적 평점 ${result.score}\n미리보기에서 기록을 확인한 뒤 foodimap 저장소에 반영하면 됩니다.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { prompt?.close(); }
