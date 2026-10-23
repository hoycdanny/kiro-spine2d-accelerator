# kiro-spine2d-accelerator

[Spine](https://esotericsoftware.com) 2D 애셋 작업을 위한 Kiro Power입니다. 레이어로 나뉜 그림을
리그 가능한 스켈레톤으로 바꾸고, 내보낸 스켈레톤 데이터를 검사·린트하고, 헤드리스로 렌더링해
차이를 비교하고, Spine CLI를 오케스트레이션하고, Unity／Web／Godot 런타임 통합을 스캐폴딩합니다.

[English](README.md) · [繁體中文](README_ZH.md) · [简体中文](README_CN.md) · [日本語](README_JP.md)

![왼쪽은 레이어로 나뉜 PSD의 캐릭터, 오른쪽은 그것에서 생성한 스켈레톤과 atlas로 렌더링한 같은 캐릭터](docs/images/psd-to-rig.png)

*왼쪽: `demo/out/hero.psd`. 17개 레이어 전부를 `demo/make-sample-psd.py`가 절차적으로 그립니다.
오른쪽: `psd_to_skeleton`이 그 PSD에서 생성한 20본 스켈레톤과 atlas로 렌더링한 한 프레임이며,
Spine 에디터는 한 번도 열지 않았습니다. 오른쪽에서 보라색 망토가 사라진 점을 보세요. `cape`는 알려진
신체 부위와 일치하지 않으므로, 어디에 붙을지 추측하지 않고 "건너뜀"으로 보고됩니다.*

## 이것이 무엇인가

두 개의 레이어가 함께 설치됩니다.

**지식 레이어.** [`POWER.md`](POWER.md)와 [`steering/`](steering)의 도메인 가이드 13개 — 내보내기
자동화, 텍스처 패킹, 린트 규칙, 비주얼 리그레션, 엔진별 통합, 버전 호환성, CI. AI는 행동하기 전에
이것을 읽으므로, 추측이 아니라 문서화된 동작에서 출발합니다.

**실행 레이어.** stdio로 동작하는 MCP 서버이며 22개 도구를 노출합니다.

**Spine에는 에디터 내 API가 없습니다.** 공식 자동화 수단은 명령줄뿐이고, 그 동작은 "별도의 Spine
프로세스를 시작 → 파일 단위 작업 하나를 수행 → 종료"입니다. 열려 있는 에디터 창을 제어하거나,
본을 추가하거나, 슬롯을 선택할 수는 없습니다. 그래서 실행 레이어는 실제로 가능한 두 가지만 합니다.
공식 CLI를 감싸는 것, 그리고 문서화된 데이터 형식(`.json` 스켈레톤 내보내기, `.atlas`,
`pack.json`, 내보내기 설정)을 직접 다루는 것입니다.

## 무엇에 쓸모가 있는가

### 에디터를 열지 않고, 그림에서 리그 가능한 스켈레톤으로

`psd_to_skeleton`은 레이어 PSD를 읽고, 각 레이어를 신체 부위 표와 맞추고, 관절 가장자리를 축으로
본 체인을 만들고, 부위들을 atlas로 패킹하고, 스켈레톤 JSON을 씁니다. 위 이미지가 그 경로의 처음과
끝입니다. Spine을 한 번도 실행하지 않으므로 Spine 라이선스가 필요하지 않습니다.

![그 PSD에서 생성한 캐릭터가 움직이는 루프. 두 팔이 1초 동안 내려갔다가 다시 올라오는 모습](docs/images/hero-wave.gif)

*같은 생성 리그가 움직이는 모습입니다. 데모의 1.00초 `wave` 20프레임을 `render_preview`가
`generated/hero-animated.json`과 그 옆의 atlas에서 프레임당 50ms로 렌더링했습니다.
모든 픽셀이 절차적으로 그린 PSD에서 나왔고, Spine 에디터는 한 번도 열지 않았습니다.*

![어태치먼트 이름이 붙은 16개의 개별 PNG 파일을 4×4로 배치하고 파일명을 표시한 이미지](docs/images/attachment-images.png)

*`generated/images/` 폴더: 어태치먼트마다 PNG 한 장이고, 파일명이 곧 어태치먼트 이름입니다.
`File -> Import Data`가 동작하는 이유가 바로 이 폴더입니다. Spine 에디터는 각 어태치먼트를 가져온
JSON 옆의 `<skeleton.images>/<attachmentName>.png`로 해석하며 `.atlas`는 읽지 않습니다. 이 폴더가
없으면 에디터는 빈 캔버스를 열고 아무 말도 하지 않습니다.*

### 데이터로는 보이지 않는 변화를 잡는 자동 비주얼 검사

atlas를 다시 패킹하면 영역이 몇 픽셀 움직입니다. 스켈레톤 JSON은 1바이트도 바뀌지 않으므로 텍스트
diff, 해시 비교, 린트가 모두 "아무 일도 없었다"고 보고합니다.

![왼쪽은 캐릭터의 베이스라인 렌더, 오른쪽은 이동한 가슴 영역을 마젠타로 표시한 diff 이미지](docs/images/visual-regression-diff.png)

*왼쪽: 기록된 베이스라인. 오른쪽: atlas 영역 하나를 리팩과 같은 방식으로 3픽셀 옮긴 뒤
`visual_regression`이 쓴 diff 이미지입니다. 마젠타 픽셀이 리그레션이고 회색은 변하지 않은 부분입니다.
데모에서는 이 게이트가 4개 프레임 전부를 실패시키고, 차이는 픽셀의 0.89–0.91%이며 0이 아닌 코드로
종료합니다. CI가 필요로 하는 것이 바로 이것입니다.*

### 데이터 검사, 린트, 의미적 diff

`skeleton_inspect`는 본과 계층 깊이, 슬롯과 블렌드 모드, 스킨, 어태치먼트 유형, 메시 정점 수,
컨스트레인트, 이벤트, 애니메이션별 길이와 타임라인 수를 보고하고, "스켈레톤이 요구하는 영역"과
"atlas가 제공하는 영역"을 교차 검사합니다. 스켈레톤이 요구하는데 atlas에 없는 영역은 아무것도
렌더링되지 않고 어디에도 오류가 나지 않습니다. 이 검사는 내보내기마다 돌릴 가치가 있습니다.

`skeleton_diff`는 "해시가 바뀜"과 "데이터가 바뀜"을 구분합니다. `skeleton_lint`는 구조 불변식,
네이밍 규칙, 예산을 적용하고 모든 지적에 수정 방법을 붙이며 CI 게이트가 됩니다.

### 보여줄 수 있고 그대로 넘길 수 있는 리그

![내보낸 단일 HTML 페이지. 체크무늬 스테이지 위의 캐릭터와 그 아래 재생·타임라인·애니메이션·속도·루프·본 컨트롤 줄](docs/images/interactive-preview.png)

*`preview_export_html`은 자체 완결된 HTML 한 장을 씁니다. 런타임, 스켈레톤, atlas, 페이지 이미지가
모두 data URL로 내장되고 외부에서 아무것도 가져오지 않습니다. 컨트롤 줄은 재생/일시정지, 타임라인
스크럽, 애니메이션 선택, 속도, 루프, 본 디버그 표시입니다. 여기서는 1.00초 애니메이션의 0.50초에서
일시정지했습니다. 이 파일은 Spine Runtimes를 내장하므로 누군가에게 넘기려면 본인의 Spine
라이선스가 필요합니다. [라이선스](#라이선스)를 참고하세요.*

### 리그를 리뷰하기 위한 자리표시 모션

![생성된 walk의 루프 재생. 다리가 한 걸음을 내딛고 돌아오는 동작을 반복하는 모습](docs/images/generated-walk.gif)

*`skeleton_animate`가 쓴 `walk` 템플릿, 1.00초 루프의 20프레임 전부입니다. 아래의 세 프레임은
같은 동작이며, GIF를 재생하지 않는 환경을 위해 남겨 둡니다.*

![생성된 walk의 0.00·0.25·0.50초 세 프레임. 다리가 한 걸음을 내딛는 모습](docs/images/generated-walk.png)

*`skeleton_animate`가 쓴 `walk`의 세 시점입니다. 축, 그리기 순서, 계층이 움직여도 성립하는지
확인하기에는 충분하며, 리그 리뷰가 묻는 것이 바로 그 질문입니다. 이것은 완성된 애니메이션이
아닙니다. [솔직한 한계](#솔직한-한계)를 참고하세요.*

### 엔진별 스캐폴딩, 그리고 먼저 실패하는 라이선스 경계

`runtime_scaffold`는 각 런타임이 요구하는 이름 변경(spine-unity는 순수 `.atlas`를 임포트하지 못하고
`.atlas.txt`여야 합니다), 이 스켈레톤 자신의 애니메이션에서 도출한 mix 테이블이 포함된 컨트롤러,
그리고 단계별 README를 내놓습니다.

Spine 트라이얼이 막는 작업 — 저장, export, pack, unpack, import, cleanup — 은 프로세스가 생성되기
**전에** `capability-gate`가 거부하며, 실행하려 했던 명령줄을 그대로 출력합니다.

```
CAPABILITY_DENIED: Blocked operations: exporting skeleton data (export).
Hint: Purchase a Spine license (Essential or Professional) and install the licensed build.
{
  "edition": "trial",
  "capability": "canExport",
  "wouldHaveRun": "\"C:\\Program Files\\Spine Trial\\SpineTrial.com\" -i ...\\hero-animated.json -e binary"
}
```

그 명령줄이 산출물입니다. 라이선스를 구입한 설치가 준비되면 같은 작업을 글자 그대로 다시 실행할 수
있습니다.

## 설정

### 요구 사항

서버 자체의 유일한 필수 요구 사항은 **Node.js 18 이상**입니다.

```bash
npm install
npm run build        # tsc -> dist/
```

### Kiro 또는 임의의 MCP 클라이언트에 연결하기

이 저장소의 [`mcp.json`](mcp.json)이 참조 형태입니다.

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["./dist/server.js"],
      "transport": "stdio",
      "env": {
        "SPINE_EXECUTABLE": "",
        "SPINE_USER_DATA": ""
      },
      "disabled": false
    }
  }
}
```

서버는 stdio로만 통신하며 네트워크 포트를 열지 않으므로, 인증이 필요한 수신 영역이 없습니다.

| 환경 변수 | 용도 | 비워 두면 |
|---|---|---|
| `SPINE_EXECUTABLE` | Spine CLI 실행 파일의 명시적 경로. Windows에서는 `.com`을 가리키세요. exit code를 반환하는 쪽이 그것이고 `.exe`는 반환하지 않습니다. | 서버가 표준 설치 위치를 직접 찾습니다. 찾지 못하면 CLI 계열 도구가 "설치를 찾지 못했다"고 보고하고, 데이터·생성·검증 도구는 전부 그대로 동작합니다. |
| `SPINE_USER_DATA` | Spine 사용자 데이터 디렉터리의 명시적 경로. `spine.log`, `version.txt`, `examples/`가 있는 곳이며 에디션과 버전 판별이 이것을 읽습니다. | 찾아낸 설치에서 유도합니다. 끝까지 얻지 못하면 `spine_env_probe`가 트라이얼과 정식판을 구분할 수 없으므로, 쓰기 도구는 가정하지 않고 거부합니다. |
| `SPINE_WORKSPACE_ROOT` | 모든 쓰기를 이 루트 안으로 제한합니다. 바깥에는 쓰지 않습니다. | 기본값은 작업 디렉터리입니다. |

### 어떤 기능에 무엇이 필요한가

기능은 하나씩 단계적으로 줄어듭니다. 전부 아니면 전무가 아닙니다.

| 쓰려는 것 | 필요한 것 |
|---|---|
| `skeleton_inspect`, `atlas_inspect`, `skeleton_diff`, `skeleton_lint`, `export_settings_build`, `pack_settings_build`, `runtime_scaffold`, `skeleton_animate` | Node 외에는 아무것도 필요 없습니다. Spine 설치도 라이선스도 필요 없습니다. |
| `psd_to_skeleton` | [`uv`](https://docs.astral.sh/uv/)와 Python — `uv sync --project python` |
| `render_preview`, `preview_export_html`, `visual_regression`, 그리고 `skeleton_document`의 실측 영향 범위 섹션 | 선택 의존성 `@esotericsoftware/spine-webgl`(4.2.120 고정)과 `playwright-core`(1.62.0 고정), 그리고 Chromium: `npx playwright-core install chromium`. `preview_export_html`은 런타임만 필요하고 브라우저는 필요 없습니다. |
| `spine_env_probe`, `spine_project_info`, `spine_export_settings_capture` | Spine 에디터 설치. 트라이얼로도 충분합니다. |
| `spine_export`, `spine_pack`, `spine_unpack`, `spine_import`, `spine_cleanup`, 그리고 이들을 담은 `spine_batch` | **정식 라이선스**의 Spine. 트라이얼이 막는 것이 정확히 이 묶음입니다. |

선택 의존성이 없으면 스택 트레이스가 아니라, 고치는 명령을 알려주는 `DEPENDENCY_MISSING` 오류가
돌아옵니다.

```
DEPENDENCY_MISSING: Chromium failed to launch (...). Install the browser with: npx playwright-core install chromium
Headless preview needs playwright-core plus a Chromium build. Everything else in this Power works without them.
```

### 한 시간을 잃기 전에 알아 둘 만한 함정

**CLI 계열 도구를 실행하기 전에 Spine 에디터를 닫으세요.** 에디터 창이 열려 있으면 런처가 요청을
기존 인스턴스에 넘기고 `Started.`를 출력한 뒤 돌아오지 않습니다. 여기의 도구에는 모두 타임아웃이
있고 그 설명과 함께 `CLI_TIMEOUT`을 보고하지만, 해결 방법은 에디터를 닫는 것입니다.

## 빠른 시작

```bash
npm install
npm run build
node demo/run-demo.js        # 또는: npm run demo
```

10단계, 약 5초. 실제 서버를 stdio로 구동하면서 스스로 해설합니다. 환경 프로브, PSD에서 리그,
검사와 린트, 의미적 diff, 4프레임 렌더링, 베이스라인, 일부러 옮긴 atlas를 diff 이미지로 포착,
Unity 스캐폴드, 라이선스 거부, 그리고 자체 완결 HTML 페이지. **Spine 라이선스가 필요 없고**,
`demo/out/`에만 쓰며, 실행마다 그 폴더를 초기화합니다. `uv`가 없으면 PSD 대신 작은 리그를
합성하고, Chromium이 없으면 시각 단계 3개를 건너뛰며 그렇다고 알려줍니다.

각 단계에서 무엇을 말할지는 [`demo/README_KR.md`](demo/README_KR.md)에 있습니다
([English](demo/README.md) · [繁體中文](demo/README_ZH.md) · [简体中文](demo/README_CN.md) ·
[日本語](demo/README_JP.md)).

[`docs/USAGE.md`](docs/USAGE.md) — **Using the Spine 2D Power**, 상세 사용 가이드입니다: 구동하는
세 가지 방법, 네 가지 엔드투엔드 작업 흐름, 실제 인자 스키마, 문제 해결 표. **영어만 제공됩니다**.

## 22개 도구

### CLI 오케스트레이션

| 도구 | 라이선스 필요 |
|---|---|
| `spine_env_probe` — 버전, 에디션, 기능 매트릭스, 런타임 브랜치, 사이드카 상태 | 아니오 |
| `spine_project_info` — 프로젝트의 Spine 버전, 스켈레톤·애니메이션 수 | 아니오 |
| `spine_export` — 스켈레톤 데이터 내보내기 | **예** |
| `spine_pack` / `spine_unpack` — 텍스처 atlas 패킹／언패킹 | **예** |
| `spine_import` — 데이터를 `.spine` 프로젝트로 가져오기 | **예** |
| `spine_cleanup` — 애니메이션 정리. 프로젝트를 저장하므로 `confirm: true` 필요 | **예** |
| `spine_export_settings_capture` — 프로젝트의 실제 내보내기 설정을 기록 | 아니오 |
| `spine_batch` — 여러 명령을 한 번의 호출로 | 내용에 따라 |

### 데이터 레이어 (Spine 설치 불필요)

| 도구 | 제공하는 것 |
|---|---|
| `skeleton_inspect` | 본과 계층 깊이, 슬롯과 블렌드 모드, 스킨, 어태치먼트 유형, 메시 정점 수, 컨스트레인트, 이벤트, 애니메이션별 길이와 타임라인 수, nonessential data 유무, 선택적 atlas 교차 검사 |
| `atlas_inspect` | 페이지, 포맷, 필터, premultiplied alpha, 회전·여백 제거된 영역, 채움률, 이름 중복, 2의 거듭제곱이 아닌 페이지 |
| `skeleton_diff` | 두 내보내기의 의미적 차이. "해시가 바뀜"과 "데이터가 바뀜"을 구분합니다 |
| `skeleton_lint` | 구조 불변식, 네이밍, 예산, 내보내기 설정과 atlas 문제. 각 항목에 수정 방법 포함. CI 게이트로 사용 가능 |
| `export_settings_build` | 템플릿 차이로 내보내기 설정 생성. 템플릿에 없는 키는 거부합니다 |
| `pack_settings_build` | `pack.json` 생성. 모든 필드를 타입·범위·열거값으로 검증합니다 |

### 생성·검증·통합

| 도구 | 하는 일 |
|---|---|
| `psd_to_skeleton` | 레이어 PSD → 스켈레톤 JSON + atlas + 페이지 이미지, 그리고 어태치먼트별 개별 PNG가 담긴 `generated/images/` 폴더. 생성 후 검사와 린트까지 수행 |
| `skeleton_animate` | 다섯 가지 템플릿(`idle`, `walk`, `wave`, `jump`, `turn_head`)으로 Spine 4.2 애니메이션을 만들어 별도의 JSON 파일에 씁니다. 템플릿이 요구하는 본이 없으면 다른 본으로 대체하지 않고 실패하며, 리그가 실제로 가진 본 이름을 알려줍니다. 이것은 기계적으로 그럴듯한 자리표시 모션이며 아티스트가 다듬은 품질이 아닙니다: 선형 키프레임뿐이고 커브 조정, 2차 모션, 체중 이동, 발 고정이 없습니다. Spine 에디터에서 열어 다듬으세요 |
| `render_preview` | 헤드리스 Chromium에서 spine-ts로 애니메이션 프레임을 렌더링하고, 프레임별 픽셀 커버리지를 보고해 "조용히 아무것도 렌더링하지 않음"을 감지할 수 있게 합니다 |
| `visual_regression` | 베이스라인과 비교하고 diff 이미지를 기록. 실패 시 게이트를 닫습니다 |
| `preview_export_html` | 모든 것이 들어 있는 단일 HTML 파일. 어떤 브라우저에서도 스켈레톤을 재생하며 재생/일시정지, 타임라인 스크럽, 애니메이션 선택, 속도, 루프, 본 디버그 표시를 제공합니다. 런타임, 스켈레톤, atlas, 페이지 이미지가 모두 내장 — 서버도 외부 요청도 필요 없습니다. 이 파일을 배포하려면 자신의 Spine 라이선스가 필요합니다 |
| `skeleton_document` | `.spine-doc.md`와 `.spine-doc.json`을 써서 이 리그가 무엇을 하는지 설명합니다: 월드 트랜스폼이 포함된 계층, 데이터에서 본별로 해석한 컨스트레인트, 다시 렌더링해 실측한 본별 영향 범위, 애니메이션별 모션 프로파일. 내용 fingerprint도 함께 기록합니다. `skeleton.hash` 만으로는 변경을 감지할 수 없기 때문입니다 |
| `runtime_scaffold` | 타깃별 파일명 요구사항, mix 테이블이 포함된 컨트롤러 코드, 단계별 README |

## 두 도구가 스스로 말하는 내용

둘 다 데모가 생성한 리그에서 실제로 실행한 결과입니다.

`skeleton_document`를 `hero.json` + `hero.atlas`에 대해 실행하면 20본(깊이 8), 16슬롯,
애니메이션 1개, 컨스트레인트 0개를 보고하고, `rotate` 모드로 20회 프로브를 0.7초에 수행하며,
"눈에 보이는 효과가 없는 본"은 하나도 없다고 보고합니다. `hero.spine-doc.md`(본 계층 트리, 본별
기하 테이블, 실측 영향 범위 테이블)와 같은 내용의 JSON을 씁니다. 그 테이블의 두 행을 발췌하면
다음과 같습니다.

```
head        -> head 0.0386        [overlap] chest
thigh_left  -> thigh_left, shin_left, foot_left
               [overlap] hip, thigh_right, hand_left, forearm_left
```

`[overlap]` 라벨이 핵심입니다. 영향 범위는 본 하나를 흔들고 축 정렬 바운딩 박스를 비교해서
측정하므로, 움직인 박스와 단지 겹칠 뿐인 슬롯은 "움직였다"고 보고되는 대신 측정의 부산물로
표시됩니다.

`skeleton_animate`에 `animations: [{template: 'idle'}, {template: 'wave'}, {template: 'walk'}]`를
주면 세 애니메이션을 두 번째 파일에 씁니다. `idle`은 2.00초이고 루프를 의도하며 6본, `wave`는
1.00초 원샷이며 5본, `walk`는 1.00초이고 루프를 의도하며 8본, 합계 19개 타임라인과 79개
키프레임입니다. 기존 `setup` 애니메이션을 보존하고 `skeleton.hash`를 다시 계산하며, 그 알고리즘이
에디터의 것이 아니라 이 프로젝트 자체의 것임을 파일에 명시합니다.

## 전형적인 흐름

```
spine_env_probe                       # 이 머신에서 실제로 가능한 것은?
skeleton_inspect  input, atlas        # 데이터에 무엇이 있고 atlas에 빠진 영역은 없는지
skeleton_lint     input, atlas        # 팀 규칙과 예산에 비추어 올바른지
render_preview    skeleton, atlas     # 실제로 렌더링되는지
visual_regression skeleton, atlas     # 외형이 바뀌지 않았는지
preview_export_html skeleton, atlas   # 클라이언트가 그냥 열기만 하는 단일 파일, 서버 불필요
runtime_scaffold  target=unity        # 엔진 쪽에 필요한 것은?
```

여기까지는 모두 trial 라이선스에서 동작합니다. export, pack, import에는 정식 라이선스가 필요합니다.

## CI

`templates/ci/`에 GitHub Actions 워크플로와 PowerShell 스크립트가 있으며, `dist/ci-cli.js`가 같은
게이트를 서브커맨드로 제공합니다.

```bash
node dist/ci-cli.js lint       --export-dir export --fail-on error
node dist/ci-cli.js regression --export-dir export --baseline-dir baseline --diff-dir diff
node dist/ci-cli.js export     --projects-dir art --out-dir export --update 4.2.xx
node dist/ci-cli.js diff       --from old.json --to new.json
```

exit code는 0이 통과, 1이 게이트 실패, 2가 사용법 또는 작업 오류입니다. 기본 CI 구성은 내보낸
산출물이 커밋되어 있다고 가정하므로 러너에 라이선스가 필요하지 않습니다(`steering/ci-pipeline.md` 참고).

## 솔직한 한계

- **생성되는 애니메이션은 자리표시입니다.** `skeleton_animate`가 쓰는 것은 기계적으로 그럴듯한
  자리표시 모션이며 아티스트가 다듬은 품질이 아닙니다: 선형 키프레임, 커브 조정 없음, 2차 모션
  없음, 체중 이동 없음, 발 고정 없음, 메시 디폼 없음. Spine 에디터에서 열어 다듬으세요. 도구가
  실제로 출력하는 원문은
  `mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.` 입니다
- **생성되는 리그는 리전 어태치먼트뿐입니다.** 가중치 메시, IK, 트랜스폼 컨스트레인트가 없습니다.
  가중치, 메시, 손으로 만든 애니메이션은 에디터의 일이고, 여기는 그 직전 단계입니다.
- **export / pack / import 묶음은 정식 라이선스 설치로 검증되지 않았습니다.** 이 프로젝트는
  트라이얼에서 개발했습니다. 명령줄 조립, capability gate, 단위 테스트는 모두 있지만 라이선스
  버전의 성공 실행은 여기서 관측하지 못했습니다.
- **영향 범위는 바운딩 박스로 측정합니다.** `skeleton_document`는 본을 하나씩 흔들어 축 정렬 슬롯
  박스를 비교하므로, 다른 서브트리의 본에 돌아간 기여는 `[overlap]`으로 표시됩니다. 그것은 측정의
  부산물이지 실제 움직임이 아닙니다.
- **지금까지의 검증은 단일 플랫폼입니다.** 시각 관련 부분은 모두 win32 x64,
  Windows 10.0.19045, Node v24.14.0, playwright-core 1.62.0, Chromium 151.0.7922.34,
  `@esotericsoftware/spine-webgl` 4.2.120에서 확인했습니다. macOS, Linux, 다른 GPU／드라이버
  조합은 아무것도 검증하지 않았습니다.
- **바이너리 `.skel`은 범위 밖입니다.** 데이터 레이어는 JSON 내보내기를 읽습니다.
- **내보내기 설정의 필드명은 공개 문서가 없습니다.** 템플릿은 내보내기 대화상자 문서를 바탕으로
  만들었으므로 `spine_export_settings_capture`로 보정하세요. `pack.json`에는 이 문제가 없습니다.
- **Godot 통합은 실행된 적이 없습니다.** 파일명 규칙과 설치 경로는 Esoteric의 문서에서 가져왔으며,
  실제 Godot 프로젝트가 출력을 소비한 적은 없습니다.

| 실제로 검증된 것 | 방법 |
|---|---|
| Trial 감지, 기능 매트릭스, CLI `--version` | 실제 Spine 4.3.26 Trial |
| 에디터가 CLI 요청을 가져가 멈추는 동작 | 재현한 뒤 타임아웃과 전용 힌트로 구현 |
| 헤드리스 렌더링, 결정성, 리그레션 탐지 | 실제 헤드리스 Chromium |
| PSD → 스켈레톤 + atlas | psd-tools로 만든 실제 PSD 파일 |
| Python 사이드카 브리지 | 실제 `uv run` 왕복 |

| 아직 검증되지 않은 것 | 이유 |
|---|---|
| export / pack / import / cleanup의 성공 실행 | 여기에는 정식 라이선스 에디터가 없습니다 |
| 내보내기 설정의 필드명 | 공개 문서가 없으며 `spine_export_settings_capture`로 보정하세요 |
| 바이너리 `.skel` 파싱 | 현재 범위 밖입니다 |
| Godot 통합 | 규칙은 문서에서 가져왔고 실제 프로젝트에서는 실행하지 않았습니다 |
| 플랫폼 하나와 Chromium 하나를 넘어서는 범위 | 위에 적은 대로 검증은 단일 플랫폼입니다 |

## 저장소 구조

```
POWER.md              Power 정의: 아키텍처, 기본 동작, 도구 목록, 워크플로
steering/             AI가 행동 전에 읽는 13개 도메인 가이드
templates/            export-settings, pack-settings, lint-rules, ci
hooks/                이 Power를 활성화하는 promptSubmit 훅
src/                  실행 레이어(TypeScript, stdio MCP 서버)
python/               PSD → 리그 사이드카(uv, psd-tools, Pillow, rectpack)
docs/images/          이 페이지의 스크린샷과, 그것을 다시 만드는 스크립트
demo/                 2분짜리 스크립트 데모
tests/                단위·속성·통합 테스트
```

## 개발

```bash
npm run typecheck
npm test                         # 41개 스위트, 931개 테스트
npm run test:unit
npm run test:integration         # Spine CLI와 Chromium이 있으면 실제로 실행합니다
uv run --project python pytest   # 89개 테스트
```

통합 테스트는 Spine이나 Chromium이 없으면 스스로 건너뛰므로 깨끗한 머신에서도 스위트가 통과합니다.
`SPINE_CLI_LIVE=1` 선택 계층은 모든 Spine 에디터 창을 닫아야 합니다.

### 이 페이지의 이미지를 다시 만들기

`docs/images/`의 모든 이미지는 이 프로젝트 자신의 출력이며, 하나의 스크립트가 만듭니다.

```bash
npm run build
npm run docs:images        # node docs/make-doc-images.mjs
```

`demo/run-demo.js`를 실행하고, 생성된 walk를 위해 서버를 stdio로 구동하고,
`demo/out/preview/hero.html`을 Chromium에서 스크린샷하고, 라벨이 붙은 띠와 두 개의 루프 GIF를
Pillow([`docs/compose-doc-images.py`](docs/compose-doc-images.py))로 합성합니다. `--skip-demo`를 주면
기존 `demo/out/`을 재사용합니다. 데모에 필요한 모든 것을 필요로 하며, 절반만 다시 만들어진 상태를
남기는 대신 실패합니다. 외부 아트 애셋은 읽지 않습니다. 모든 픽셀은 `demo/make-sample-psd.py` 또는
거기서 렌더링된 프레임에서 시작합니다.

## 라이선스

이 저장소는 MIT입니다. [LICENSE](LICENSE)를 참고하세요.

Spine 자체는 Esoteric Software의 상용 소프트웨어이며, Spine Runtimes에는 별도의 라이선스가
있습니다. **Spine Runtimes를 제품에 통합하는 시점에 Spine 에디터 라이선스가 필요하며**, 통합
이후에는 라이선스가 나중에 만료되어도 그 제품을 계속 배포할 수 있습니다. Runtimes를 무료로
제공하는 개발 도구, SDK, 라이브러리에 통합하는 것은 명시적으로 허용되지만, **그 도구의 모든
사용자는 각자 Spine 라이선스를 보유해야 하며 그 사실을 안내받아야 합니다.** Spine 에디터 자체를
사용하지 않더라도 Spine Runtimes가 포함된 소프트웨어를 배포하려면 Spine 라이선스가 필요합니다.

이 저장소는 런타임을 포함하지 않습니다. `@esotericsoftware/spine-webgl`은 npm에서 설치하는
`optionalDependency`이며, Spine 코드나 런타임, 예제 애셋을 재배포하지 않습니다.
`preview_export_html`이 쓰는 HTML 파일은 그 런타임을 내장하므로, 그 파일을 배포하려면 본인의
라이선스가 필요합니다.

자세한 내용은 https://esotericsoftware.com/spine-purchase 를 참고하세요.
