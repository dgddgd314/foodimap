# foodimap · 맛집지도

내 티스토리 리뷰를 네이버 지도에 표시하는 정적 사이트입니다. [dgddgd314/foodimap](https://github.com/dgddgd314/foodimap) 저장소에서 관리하며, 저장소 루트를 GitHub Pages로 독립 배포할 수 있습니다. 기존 블로그 저장소와의 연동은 보류합니다.

## 파일 구조

| 경로 | 역할 |
| --- | --- |
| `data/places.json` | 지도에서 읽는 식당 데이터 원본. 실제 기록은 이 파일에 저장됩니다. |
| `examples/place-draft.json` | 새 식당을 등록할 때 복사해서 쓰는 입력 템플릿. 지도에서는 읽지 않습니다. |
| `assets/config.js` | 공개 지도 Client ID, 발행한 스타일 ID, 상단 메뉴 주소 |
| `assets/naver-map.js` | 네이버 지도 SDK 연결, 마커, 지도 이동, 현재 위치 표시 |
| `assets/map-controls.js` | 이름을 띄엄띄엄 배치하는 로직과 위치 요청 |
| `assets/app.js`, `assets/style.css`, `index.html` | 지도 화면과 식당 상세 정보 |
| `scripts/add-place.mjs`, `scripts/place-registration.mjs` | 식당 입력 → 주소 좌표 변환 → 데이터 저장 |
| `.env.local` | 로컬 등록 도구의 API 키. Git 및 미리보기 서버에서 제외됩니다. |
| `.local/`, `.preview/` | 개인 입력 초안·서버 로그·화면 확인 자료. Git에서 제외됩니다. |

## 로컬 실행

UI 글꼴은 [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9)의 가변 폰트를 로컬에서 불러옵니다. 폰트와 SIL Open Font License는 `assets/fonts/`에 있습니다. 네이버 지도 버튼의 흰색 로고는 [네이버 공식 브랜드 리소스](https://www.navercorp.com/company/brandGuide)에서 내려받은 원본 SVG(`assets/naver-logo-white.svg`)이며, 버튼 배경은 공식 네이버 그린 `#03C75A`입니다.

Node.js 22 이상에서 프로젝트 폴더를 열고 실행합니다. 패키지 설치나 빌드는 필요하지 않습니다.

```sh
npm run dev
```

[지도 미리보기](http://127.0.0.1:4173/foodimap/)를 엽니다. 직접 실행한 터미널은 미리보기를 사용하는 동안 열어둡니다. 서버가 이미 실행 중이라면 주소만 열면 됩니다.

```sh
npm run check
npm test
```

문법 검사와 등록·지도 기능 자동 테스트를 실행합니다.

## 식당 추가

**새 식당은 `npm run add-place`로 등록하고, 수정은 `data/places.json`에서 합니다.** 주소를 좌표로 바꾸는 작업은 등록할 때 한 번 실행되며, 방문자는 저장된 좌표만 읽습니다.

### 대화형으로 등록

1. 프로젝트 폴더에서 `npm run add-place`를 실행합니다.
2. 아래 항목을 순서대로 입력합니다. 선택 항목은 Enter로 건너뛸 수 있습니다.
3. 주소 변환 결과를 확인합니다. 후보가 여러 개면 해당하는 주소 번호를 선택합니다.
4. 최종 확인에서 `y`를 입력하면 **`data/places.json`에 새 식당이 추가됩니다**.
5. 미리보기를 새로고침해 위치·이름·리뷰 링크를 확인합니다. 변경된 파일을 `foodimap` 저장소에 커밋·푸시합니다. Pages를 활성화한 이후에는 공개 사이트에도 반영됩니다.

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

팝업은 지역 표시와 식당 제목을 왼쪽에 세로로 묶고 평점을 오른쪽 가운데에 표시합니다. NAVER 지도 링크 아래 구분선 다음에는 리뷰의 대표이미지와 글 제목·게시일을 표시하며, 카드 전체를 누르면 원문이 새 탭에서 열립니다. 지역 표시와 식당 제목 사이 여백은 0px입니다.

등록된 리뷰의 `reviewTitle`, `reviewDate`, `reviewImage`는 `data/places.json`에서 설정합니다. `reviewDate`는 원문 게시일을 `YYYY-MM-DD` 형식으로 입력하면 제목 아래 `YYYY.MM.DD`로 표시하며, 없으면 날짜를 생략합니다. `reviewImage`에는 `./assets/reviews/파일명.png` 같은 로컬 경로나 웹 이미지 주소를 넣을 수 있습니다. 제목이 없으면 식당 이름과 ‘리뷰’를 표시하고, 이미지가 없거나 로드에 실패하면 텍스트만 표시합니다. 현재 하쿠텐라멘의 제목·게시일·대표이미지는 연결된 글에서 가져왔으며, 만료되는 이미지 주소 대신 `assets/reviews/hakuten-ramen.png`를 사용합니다. 글의 제목·게시일·대표이미지를 바꿔도 자동으로 동기화되지는 않습니다.

`address`만 Geocoding API에 전달하며, `addressDetail`은 입력한 내용대로 별도 저장합니다. 네이버 링크에서 주소를 추출하지 않습니다. `naver.me` 단축 링크는 브라우저에서 식당을 연 뒤 주소창의 최종 장소 링크를 복사합니다.

### 파일을 작성한 뒤 등록

`examples/place-draft.json`을 복사해 `.local/my-place.json`으로 저장하고 값을 채웁니다. 필수 항목은 비워 둔 템플릿이므로 실제 식당 정보와 본인 점수를 입력해야 합니다.

```sh
npm run add-place -- --input .local/my-place.json
```

입력한 값이 질문의 기본값으로 표시됩니다. 그대로 쓰려면 Enter, 바꾸려면 새 값을 입력합니다. 주소 변환·최종 확인을 거쳐 같은 `data/places.json`에 저장됩니다. 입력 초안 자체는 지도에 표시되지 않습니다.

기존 `.local/recordpizza-draft.json`에는 레코드피자 신림점의 링크·이름·주소만 준비되어 있습니다. 평점과 리뷰 링크는 본인이 채워야 하며 아직 실제 지도 기록으로 등록하지 않았습니다.

### 자동으로 저장되는 정보

등록 도구는 네이버 링크에서 `naverPlaceId`를 추출하고 `id`를 `naver-장소ID`로 만듭니다. 링크는 불필요한 화면 설정을 제거한 `naverUrl`로 저장합니다. 주소 변환 뒤 `lat`(위도), `lng`(경도), `geocoding`(변환 출처·일치 주소·시간)을 추가하고 `isExample`을 `false`로 저장합니다.

API 키는 식당 데이터에 저장하지 않습니다. `.env.local` 설정이 없으면 `.env.example`을 참고해 `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`을 입력합니다. 이미 설정한 `.env.local`은 그대로 사용합니다.

### 기존 식당 수정·삭제

`data/places.json`의 배열에서 해당 `id`를 찾아 이름·상세주소·총점·메모·리뷰 링크를 수정합니다. 삭제하려면 해당 식당 객체를 제거합니다. 같은 네이버 장소 ID를 등록 도구로 다시 추가하면 중복으로 거부하며 기존 기록은 보존합니다.

- 기본 `address`를 바꾸면 `lat`, `lng`도 새 주소에 맞게 갱신해야 합니다. 상세주소의 층·호수만 바꾸는 경우 좌표를 다시 구할 필요는 없습니다.
- JSON의 따옴표·쉼표 형식을 유지하고, 항목이 없으면 `[]`로 둡니다.
- 현재 기록은 가상의 예시 6개(`isExample: true`)와 하쿠텐라멘 실제 리뷰 1개(`isExample: false`)입니다. 실제 기록을 채우면서 예시 객체를 제거하면 됩니다.
- 현재 구현은 **지점 하나에 총점·메모·리뷰 링크 하나**를 저장합니다. 앞서 구상한 지점 1:N 리뷰, 세부 평가 기준, 태그·페르소나는 아직 구현하지 않았습니다. `reviews` 배열을 임의로 추가해도 현재 화면에 표시되지 않습니다.

## 지도 설정

`assets/config.js`의 `naverClientId`는 네이버 Maps 애플리케이션의 공개 Client ID이며 웹 SDK에서 `ncpKeyId`로 사용합니다. Client Secret은 `.env.local`에만 보관합니다. 지도를 표시하려면 Dynamic Map, 등록 도구에서 주소를 변환하려면 Geocoding이 필요합니다.

Web 서비스 URL에는 배포 호스트 `https://dgddgd314.github.io`와 로컬 테스트 호스트 `http://127.0.0.1`를 등록합니다. `/foodimap/` 경로나 포트는 제외합니다.

`naverStyleId`에는 제공받은 My Style ID가 설정되어 있습니다. 배경 음식점·카페 등의 표시 여부는 Style Editor에서 발행한 설정을 따릅니다. 스타일을 수정한 뒤 다시 발행하면 같은 ID로 연결합니다. [네이버 공식 스타일 연동 안내](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Style-Editor.html)

지도의 기본 위치 네 개는 `assets/app.js`의 `VIEWS`에서 설정합니다. 현재 위치 버튼은 누를 때만 브라우저 위치 권한을 요청하며, 위치 좌표를 파일이나 브라우저 저장소에 저장하지 않습니다.

## GitHub 저장소와 Pages 배포

1. [dgddgd314/foodimap](https://github.com/dgddgd314/foodimap) 저장소의 `main` 브랜치에 프로젝트를 올립니다.
2. 웹사이트 공개가 필요할 때 Settings → Pages에서 `Deploy from a branch`, `main`, `/(root)`를 선택합니다.
3. `.nojekyll`을 포함해 저장소 루트의 `index.html`, `assets/`, `data/`를 그대로 배포합니다. 별도 빌드·파일 내보내기 단계가 없습니다.
4. Pages 활성화 후 지도 주소는 `https://dgddgd314.github.io/foodimap/`입니다.

GitHub 업로드와 Pages 활성화는 별도 단계입니다. `.env.local`, `.local/`, `.preview/`는 `.gitignore`에 따라 업로드하지 않습니다.

## 블로그 연결 (보류)

현재는 기존 블로그 저장소를 수정하거나 맛집지도 메뉴를 추가하지 않습니다. 추후 블로그에서 연결할 때 사용할 경로는 `/foodimap/`입니다.

지도 상단의 블로그·태그 메뉴는 각각 `https://dgddgd314.github.io/blog/`, `https://dgddgd314.github.io/blog/tags/`로 연결됩니다. 티스토리 글은 식당 상세 화면의 리뷰 링크로 연결됩니다. 현재 태그 메뉴는 기존 블로그의 태그 페이지이며 지도 내부 필터는 아닙니다.
