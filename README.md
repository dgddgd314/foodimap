# foodimap · 맛집지도

내 티스토리 리뷰를 네이버 지도에 표시하는 정적 사이트입니다. [dgddgd314/foodimap](https://github.com/dgddgd314/foodimap) 저장소에서 관리하며, GitHub Actions가 리뷰 미리보기를 갱신한 뒤 GitHub Pages로 배포합니다. 기존 블로그 저장소와의 연동은 보류합니다.

## 파일 구조

| 경로 | 역할 |
| --- | --- |
| `data/places.json` | 지도에서 읽는 식당 데이터 원본. 실제 기록은 이 파일에 저장됩니다. |
| `examples/place-draft.json` | 새 식당을 등록할 때 복사해서 쓰는 입력 템플릿. 지도에서는 읽지 않습니다. |
| `assets/config.js` | 공개 지도 Client ID, 발행한 스타일 ID, 로고의 블로그 연결 주소 |
| `assets/naver-map.js` | 네이버 지도 SDK 연결, 마커, 지도 이동, 현재 위치 표시 |
| `assets/map-controls.js` | 이름을 띄엄띄엄 배치하는 로직과 위치 요청 |
| `assets/app.js`, `assets/style.css`, `index.html` | 지도 화면과 식당 상세 정보 |
| `scripts/add-place.mjs`, `scripts/place-registration.mjs` | 식당 입력 → 주소 좌표 변환 → 데이터 저장 |
| `scripts/review-preview.mjs`, `scripts/build.mjs` | 원문의 OG 정보 조회 → 빈 리뷰 필드 보완 → `_site/` 생성 |
| `.github/workflows/pages.yml` | 푸시·수동 배포, 하루 한 번 만료 점검 후 필요할 때 OG 갱신·배포 |
| `_site/`, `.cache/review-previews.json` | 배포 결과와 이전 OG 정보 캐시. 사진 파일 없이 텍스트·URL만 생성하며 Git에서 제외됩니다. |
| `.env.local` | 로컬 등록 도구의 API 키. Git 및 미리보기 서버에서 제외됩니다. |
| `.local/`, `.preview/` | 개인 입력 초안·서버 로그·화면 확인 자료. Git에서 제외됩니다. |

## 로컬 실행

UI 글꼴은 [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9)의 가변 폰트를 로컬에서 불러옵니다. 폰트와 SIL Open Font License는 `assets/fonts/`에 있습니다. 네이버 지도 버튼의 흰색 로고는 [네이버 공식 브랜드 리소스](https://www.navercorp.com/company/brandGuide)에서 내려받은 원본 SVG(`assets/naver-logo-white.svg`)이며, 버튼 배경은 공식 네이버 그린 `#03C75A`입니다.

Node.js 22 이상에서 프로젝트 폴더를 열고 실행합니다. OG의 HTML을 해석하는 개발 의존성 `parse5`를 설치합니다. 브라우저에 추가 라이브러리를 전달하지는 않습니다.

```sh
npm ci
npm run dev
```

[지도 미리보기](http://127.0.0.1:4173/foodimap/)를 엽니다. `npm run dev`는 필요한 OG 정보만 갱신해 `_site/`를 만든 뒤 빌드 결과를 제공합니다. 직접 실행한 터미널은 미리보기를 사용하는 동안 열어둡니다. 데이터·화면 파일을 수정하면 별도 터미널에서 `npm run build`를 실행한 뒤 새로고침합니다. 원문의 제목·사진 변경을 즉시 반영하려면 `npm run build -- --force-reviews`로 캐시의 유효기간과 관계없이 조회합니다. 이전 버전의 원본 미리보기 서버가 실행 중이라면 한 번 종료하고 다시 실행합니다.

```sh
npm run check
npm test
```

문법 검사와 등록·지도·OG 자동 테스트를 실행합니다. 테스트에서는 실제 리뷰 서버에 요청하지 않습니다.

## 식당 추가

**새 식당은 `npm run add-place`로 등록하고, 수정은 `data/places.json`에서 합니다.** 주소를 좌표로 바꾸는 작업은 등록할 때 한 번 실행되며, 방문자는 저장된 좌표만 읽습니다.

### 대화형으로 등록

1. 프로젝트 폴더에서 `npm run add-place`를 실행합니다.
2. 아래 항목을 순서대로 입력합니다. 선택 항목은 Enter로 건너뛸 수 있습니다.
3. 주소 변환 결과를 확인합니다. 후보가 여러 개면 해당하는 주소 번호를 선택합니다.
4. 최종 확인에서 `y`를 입력하면 **`data/places.json`에 새 식당이 추가됩니다**.
5. `npm run build` 후 미리보기를 새로고침해 위치·이름·리뷰 링크를 확인합니다. 변경된 파일을 `foodimap` 저장소에 커밋·푸시하면 Actions가 OG 정보를 채워 공개 사이트에 배포합니다.

| 입력 항목 | 필수 | 예시 / 규칙 |
| --- | --- | --- |
| `naverUrl` | 필수 | 장소 ID가 있는 네이버 식당 링크. `https://map.naver.com/p/entry/place/장소ID` |
| `name` | 필수 | 식당 이름과 지점명 |
| `address` | 필수 | 도로명·건물 번호까지. 예: `서울 관악구 대학5길 23` |
| `addressDetail` | 선택 | 층·호수. 예: `1층`, `지하 1층 101호` |
| `area` | 선택 | 지역 표시. 예: `관악 · 서울대입구` |
| `score` | 필수 | 본인이 매긴 총점, 0~5. 소수 입력 가능 |
| `summary` | 선택 | 본인의 한 줄 메모 |
| `reviewUrl` | 선택 | 티스토리 **개별 리뷰 글** 주소. 미작성 시 빈 입력 / JSON에서는 `null` |
| `reviewTitle` | 선택 | 직접 지정할 리뷰 제목. 비우면 `og:title` 사용 |
| `reviewDate` | 선택 | `YYYY-MM-DD`. 비우면 원문의 `article:published_time` 사용 |
| `reviewImage` | 선택 | 직접 지정할 HTTP(S) 이미지 URL. 비우면 `og:image` 사용 |

팝업은 지역 표시와 식당 제목을 왼쪽에 세로로 묶고 평점을 오른쪽 가운데에 표시합니다. NAVER 지도 링크 아래 구분선 다음에는 리뷰의 대표이미지와 글 제목·게시일을 표시하며, 카드 전체를 누르면 원문이 새 탭에서 열립니다. 지역 표시와 식당 제목 사이 여백은 0px입니다.

리뷰의 각 필드는 **수동 입력 → OG 정보 → 기존 기본 표시** 순서로 결정합니다. 특히 `reviewImage`가 있으면 그대로 쓰고, 누락·빈 문자열이면 원문의 대표사진 주소를 사용합니다. OG로 알아낸 값을 원본 `data/places.json`에 수동 입력처럼 덮어쓰지 않으므로 만료가 가까워지면 자동 갱신됩니다. 수동 입력한 이미지 주소 자체는 자동 교체하지 않으니, 만료 주소는 복사해 넣지 말고 `reviewImage`를 비워 둡니다.

사진 파일은 다운로드하거나 저장소에 추가하지 않습니다. 브라우저가 외부 이미지 URL로 사진을 표시합니다. 게시일은 `YYYY.MM.DD`로 표시하며, 제목이 없으면 식당 이름과 ‘리뷰’, 이미지가 없거나 로드에 실패하면 텍스트만 표시합니다. 하쿠텐라멘의 기존 로컬 사진도 제거하고 OG 이미지를 사용합니다. 과거 Git 커밋에 있던 사진까지 삭제하는 기록 재작성은 포함하지 않습니다.

### OG 갱신 원리

1. GitHub Actions가 `main` 푸시, 수동 실행, **매일 한국 시간 09:17**에 시작합니다. 예약 실행은 먼저 캐시의 날짜만 확인하며, 갱신 대상이 없으면 의존성 설치·테스트·원문 조회·빌드·배포를 모두 생략합니다.
2. 캐시가 없는 새 리뷰는 즉시, 만료 시각이 있으면 **만료 3일 전부터**, 만료 시각이 없거나 OG 사진이 없으면 **마지막 성공 조회로부터 7일 후**에 원문을 조회합니다. 모든 필드가 수동 입력된 리뷰는 조회를 생략합니다. 조회해도 같은 만료 주소가 반환되면 만료가 가까운 동안 하루마다 다시 확인합니다.
3. 대상 리뷰의 HTML에서 `og:title`, `og:image`(HTTPS 보조 주소 포함), `article:published_time`을 읽고 빈 필드를 채워 `_site/data/places.json`으로 배포합니다. 푸시·수동 실행은 화면과 식당 데이터 변경도 반영해야 하므로 빌드·배포하되, OG 원문 조회에는 같은 갱신 기준을 적용합니다. 갱신 커밋이나 이미지 파일은 생성하지 않습니다.
4. 방문자는 배포된 JSON과 외부 이미지 URL을 읽습니다. 방문할 때마다 티스토리 HTML을 수집하는 서버는 필요하지 않으며 갱신 후 페이지를 다시 열면 새 데이터가 적용됩니다.

원문 조회가 실패하면 같은 리뷰 URL의 이전 정보 캐시를 사용하고 실행 로그에 경고를 남깁니다. 티스토리 썸네일의 중첩 `fname` 주소까지 `expires`를 확인해 이미 만료된 이미지는 화면에서 생략하되, 캐시의 만료 정보는 유지해 다음 점검 때 재시도합니다. 정상 조회에서 OG 사진이 사라졌으면 이전 사진을 재사용하지 않습니다. 캐시도 없으면 기본 텍스트 카드로 배포하므로 리뷰 하나의 장애로 지도 전체 배포가 막히지 않습니다.

Actions 일정은 정확한 시각을 보장하지 않으며, 공개 저장소에 60일간 활동이 없으면 예약 실행이 자동 비활성화될 수 있습니다. 이 경우 Actions에서 워크플로를 다시 활성화하고 **Run workflow**로 갱신합니다. 마지막 배포 뒤 만료·차단된 사진은 다음 성공적인 갱신까지 표시되지 않을 수 있습니다. [GitHub 예약 실행 안내](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

### 등록 도구의 주소 처리

`address`만 Geocoding API에 전달하며, `addressDetail`은 입력한 내용대로 별도 저장합니다. 네이버 링크에서 주소를 추출하지 않습니다. `naver.me` 단축 링크는 브라우저에서 식당을 연 뒤 주소창의 최종 장소 링크를 복사합니다.

### 파일을 작성한 뒤 등록

`examples/place-draft.json`을 복사해 `.local/my-place.json`으로 저장하고 값을 채웁니다. 필수 항목은 비워 둔 템플릿이므로 실제 식당 정보와 본인 점수를 입력해야 합니다.

```sh
npm run add-place -- --input .local/my-place.json
```

입력한 값이 질문의 기본값으로 표시됩니다. 그대로 쓰려면 Enter, 바꾸려면 새 값을 입력합니다. 주소 변환·최종 확인을 거쳐 같은 `data/places.json`에 저장됩니다. 입력 초안 자체는 지도에 표시되지 않습니다.

기존 `.local/recordpizza-draft.json`에는 레코드피자 신림점의 링크·이름·주소만 준비되어 있습니다. 평점과 리뷰 링크는 본인이 채워야 하며 아직 실제 지도 기록으로 등록하지 않았습니다.

### 자동으로 저장되는 정보

등록 도구는 네이버 링크에서 `naverPlaceId`를 추출하고 `id`를 `naver-장소ID`로 만듭니다. 링크는 불필요한 화면 설정을 제거한 `naverUrl`로 저장합니다. 주소 변환 뒤 `lat`(위도), `lng`(경도), `geocoding`(변환 출처·일치 주소·시간)을 추가합니다.

API 키는 식당 데이터에 저장하지 않습니다. `.env.local` 설정이 없으면 `.env.example`을 참고해 `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`을 입력합니다. 이미 설정한 `.env.local`은 그대로 사용합니다.

### 기존 식당 수정·삭제

`data/places.json`의 배열에서 해당 `id`를 찾아 이름·상세주소·총점·메모·리뷰 링크를 수정합니다. 삭제하려면 해당 식당 객체를 제거합니다. 같은 네이버 장소 ID를 등록 도구로 다시 추가하면 중복으로 거부하며 기존 기록은 보존합니다.

- 기본 `address`를 바꾸면 `lat`, `lng`도 새 주소에 맞게 갱신해야 합니다. 상세주소의 층·호수만 바꾸는 경우 좌표를 다시 구할 필요는 없습니다.
- JSON의 따옴표·쉼표 형식을 유지하고, 항목이 없으면 `[]`로 둡니다.
- 현재 구현은 **지점 하나에 총점·메모·리뷰 링크 하나**를 저장합니다. 앞서 구상한 지점 1:N 리뷰, 세부 평가 기준, 태그·페르소나는 아직 구현하지 않았습니다. `reviews` 배열을 임의로 추가해도 현재 화면에 표시되지 않습니다.

## 지도 설정

`assets/config.js`의 `naverClientId`는 네이버 Maps 애플리케이션의 공개 Client ID이며 웹 SDK에서 `ncpKeyId`로 사용합니다. Client Secret은 `.env.local`에만 보관합니다. 지도를 표시하려면 Dynamic Map, 등록 도구에서 주소를 변환하려면 Geocoding이 필요합니다.

Web 서비스 URL에는 배포 호스트 `https://dgddgd314.github.io`와 로컬 테스트 호스트 `http://127.0.0.1`를 등록합니다. `/foodimap/` 경로나 포트는 제외합니다.

`naverStyleId`에는 제공받은 My Style ID가 설정되어 있습니다. 배경 음식점·카페 등의 표시 여부는 Style Editor에서 발행한 설정을 따릅니다. 스타일을 수정한 뒤 다시 발행하면 같은 ID로 연결합니다. [네이버 공식 스타일 연동 안내](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Style-Editor.html)

지도의 기본 위치 네 개는 `assets/app.js`의 `VIEWS`에서 설정합니다. 현재 위치 버튼은 누를 때만 브라우저 위치 권한을 요청하며, 위치 좌표를 파일이나 브라우저 저장소에 저장하지 않습니다.

## GitHub 저장소와 Pages 배포

1. [dgddgd314/foodimap](https://github.com/dgddgd314/foodimap) 저장소의 `main` 브랜치에 프로젝트를 올립니다.
2. Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 선택합니다. 이전의 `Deploy from a branch` 방식은 OG 빌드 과정을 실행하지 않으므로 전환이 필요합니다.
3. `.github/workflows/pages.yml`이 검사·필요한 OG 조회·빌드 후 `_site/`만 배포합니다. `_site/`에는 `index.html`, `.nojekyll`, `assets/`, 배포용 `data/places.json`만 들어갑니다. 수동 실행은 Actions → **Refresh review previews and deploy** → **Run workflow**입니다. 원문 변경을 즉시 가져오려면 ‘만료 시각과 관계없이 OG 정보를 다시 조회’를 선택합니다.
4. Pages 활성화 후 지도 주소는 `https://dgddgd314.github.io/foodimap/`입니다.

GitHub 업로드와 Pages의 배포 소스 설정은 별도 단계입니다. `.env.local`, `.local/`, `.preview/`, `.cache/`, `_site/`, `node_modules/`는 Git에서 제외합니다. Actions 캐시에도 리뷰 제목·게시일·이미지 URL만 저장하며, OG 조회에 별도 API 키는 필요하지 않습니다. 워크플로에는 저장소 읽기와 Pages 배포에 필요한 권한만 부여합니다.

## 블로그 연결 (보류)

현재는 기존 블로그 저장소를 수정하거나 맛집지도 메뉴를 추가하지 않습니다. 추후 블로그에서 연결할 때 사용할 경로는 `/foodimap/`입니다.

지도는 화면 전체를 사용하며, 왼쪽 위 `dgddgd314` 로고를 누르면 `https://dgddgd314.github.io/blog/`로 이동합니다. 지역 프리셋은 로고 바로 아래에 왼쪽 정렬됩니다. 별도 헤더와 메뉴 탭은 없으며, 티스토리 글은 식당 상세 화면의 리뷰 링크로 연결됩니다.
