// 로컬에서만 실행합니다. GitHub Pages에는 좌표가 저장된 JSON만 필요합니다.
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { geocode, savePlace, validateDraft } from "./place-registration.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("사용법: npm run add-place [-- --input .local/restaurant.json]\n네이버 링크·이름·주소·상세주소·본인 평점·티스토리 리뷰 링크를 입력하고, 좌표를 확인해 저장합니다.\n좌표 변환에는 기본 주소만 사용하며 층·호수는 별도로 저장합니다. Client Secret은 .env.local에만 입력하세요.");
  process.exit(0);
}

let prompt;
try {
  if (args.length && (args.length !== 2 || args[0] !== "--input")) throw new Error("인수 형식을 확인해주세요. npm run add-place -- --help");
  try { process.loadEnvFile(path.join(root, ".env.local")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const clientId = process.env.NAVER_MAPS_CLIENT_ID;
  const clientSecret = process.env.NAVER_MAPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error(".env.example을 .env.local로 복사하고 네이버 Maps Client ID와 Client Secret을 입력해주세요.");
  const initial = args.length ? JSON.parse(await readFile(path.resolve(root, args[1]), "utf8")) : {};
  prompt = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, value = "") => (await prompt.question(`${label}${value !== "" && value != null ? ` [${value}]` : ""}: `)).trim() || (value ?? "");
  const draft = {
    naverUrl: await ask("네이버 지도 식당 링크", initial.naverUrl),
    name: await ask("식당 이름·지점명", initial.name),
    address: await ask("도로명 주소 (층·호수 제외)", initial.address),
    addressDetail: await ask("상세주소 (층·호수, 선택)", initial.addressDetail),
    area: await ask("지역 표시 (선택)", initial.area),
    score: await ask("본인 총점 (0~5)", initial.score),
    summary: await ask("한 줄 메모 (선택)", initial.summary),
    reviewUrl: await ask("티스토리 리뷰 링크 (선택)", initial.reviewUrl),
  };
  draft.score = draft.score === "" ? null : Number(draft.score);
  const validated = validateDraft(draft);
  const candidates = await geocode(validated.address, { clientId, clientSecret });
  console.log("\n주소 변환 결과:");
  candidates.forEach((item, index) => console.log(`${index + 1}. ${item.address} — 위도 ${item.lat}, 경도 ${item.lng}`));
  const choice = candidates.length === 1 ? 1 : Number(await prompt.question("해당 식당의 주소 번호: "));
  if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) throw new Error("올바른 주소 번호를 선택해주세요. 저장하지 않았습니다.");
  console.log(`\n${validated.name} · 총점 ${validated.score}\n주소: ${validated.address}\n상세주소: ${validated.addressDetail || "없음"}\n${validated.naverUrl}\n리뷰: ${validated.reviewUrl || "아직 없음"}`);
  if (!/^(y|yes)$/i.test((await prompt.question("주소·좌표와 기록이 맞으면 저장할까요? (y/N): ")).trim())) {
    console.log("저장하지 않았습니다.");
  } else {
    const result = await savePlace(path.join(root, "data", "places.json"), validated, candidates[choice - 1]);
    console.log(`저장했습니다: data/places.json (${result.id})\n미리보기에서 위치를 확인한 뒤 foodimap 저장소에 반영하면 됩니다.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { prompt?.close(); }
