# 데모 — 2분, 10단계

[English](README.md) · [繁體中文](README_ZH.md) · [简体中文](README_CN.md) · [日本語](README_JP.md)

스스로 설명하며 진행하는 스크립트로, 실제 MCP 서버를 stdio로 구동합니다. 고객 앞에서 바로 실행해도
안전합니다. Spine **trial**만으로 끝까지 동작하고, `demo/out/`에만 쓰며, 실행할 때마다 그 폴더를
초기화합니다.

## 실행

```bash
npm install
npm run build
npm run demo
```

선택 의존성 두 개를 설치하면 데모가 완전해집니다. 없어도 동작하며, 무엇을 건너뛰었는지 말해 줍니다.

```bash
uv sync --project python          # 2단계, PSD 부분
npx playwright install chromium   # 5~7단계, 비주얼 부분
```

워밍업된 머신에서 약 5초입니다. 끝나면 이것들을 여세요. 데모의 핵심입니다.

```
demo/out/generated/images/  어태치먼트별 개별 PNG — File -> Import Data가 참조하는 대상
demo/out/preview/           애니메이션 렌더링 4프레임
demo/out/regression-diff/   atlas 3픽셀 이동을 잡아낸 diff 이미지
demo/out/preview/hero.html  더블클릭만 하면 됩니다. 어떤 브라우저에서도 재생되고 서버가 필요 없습니다
```

## 단계별로 할 말

| 단계 | 화면에 나오는 것 | 그대로 말할 수 있는 한 문장 |
|---|---|---|
| 1. 환경 점검 | trial 감지, 7개 작업 차단, Python 사이드카 준비됨 | "시간을 낭비하기 전에, 못 하는 일을 먼저 알려 줍니다." |
| 2. PSD → 리그 | 본 20개, 어태치먼트 16개, 가상 본 4개(`root`, `neck`, `shoulder_left`, `shoulder_right`), `cape` 건너뜀, 그리고 개별 PNG 16장이 담긴 `generated/images/` 폴더 | "아트를 넣으면 리그가 나옵니다. 그리고 Spine 에디터를 한 번도 열지 않았습니다. 그래서 이 부분은 trial에서도 동작합니다. JSON 옆의 `images/` 폴더가 바로 `File -> Import Data`를 성립시키는 것입니다. 에디터는 atlas가 아니라 이 개별 이미지로 어태치먼트를 해석합니다." |
| 3. 검사 + 린트 | atlas 교차 검사 통과, 수정 방법이 붙은 경고 2건 | "가치 있는 건 교차 검사입니다. 스켈레톤이 필요한데 atlas에 없는 영역은 런타임에서 '아무것도' 그려지지 않고, 어디에도 오류가 나지 않습니다." |
| 4. 애니메이터가 동작 추가 | `+ animations: idle, wave` | "내보낸 JSON의 텍스트 diff는 읽을 수 없습니다. 이건 리뷰어가 실제로 묻고 싶은 질문에 답합니다." |
| 5. 렌더링 | 240×240 4프레임, 픽셀 커버리지 보고 | "실제 Spine 웹 런타임으로 헤드리스 렌더링합니다. 커버리지가 있으니 '조용히 아무것도 안 그려졌다'를 감지할 수 있습니다." |
| 6. 베이스라인 + 비교 | 4/4 프레임이 허용 범위 내 | "변경마다 파이프라인이 통과시키는 게이트가 바로 이것입니다." |
| 7. 일부러 깨뜨리기 | 4/4 프레임 FAIL, 픽셀 수와 diff 이미지 | "atlas 영역 하나를 3픽셀 옮겼습니다. 스켈레톤 데이터는 전혀 바뀌지 않았습니다. 비주얼 검사만 잡아낼 수 있습니다." |
| 8. Unity 스캐폴드 | `hero.atlas → hero.atlas.txt`, mix 테이블, 컨트롤러 | "spine-unity는 순수 `.atlas`를 로드할 수 없습니다. 이 규칙은 누군가의 기억이 아니라 도구 안에 있습니다." |
| 9. 라이선스 경계 | `CAPABILITY_DENIED`와 실행하려던 명령줄 | "trial에서는 거부합니다. 그리고 실행하려던 명령을 그대로 건네주니, 구매 후 똑같이 다시 실행하면 됩니다." |
| 10. 고객에게 건넬 파일 하나 | `demo/out/preview/hero.html`, 약 236 KB | "더블클릭해 보세요. 런타임, 스켈레톤, atlas, 이미지가 모두 이 파일 하나에 들어 있습니다. 서버도 설치도 필요 없고 외부에서 아무것도 받아오지 않습니다. 타임라인을 끌어 보세요. 단, Spine Runtimes를 내장하므로 누군가에게 건네려면 본인의 Spine 라이선스가 필요합니다." |

## 라이브로 보여주기

Power를 Kiro에 설치했다면 다음 프롬프트로 같은 흐름을 대화로 재현할 수 있습니다. 먼저
`npm run demo`를 한 번 실행해 `demo/out/`에 파일을 만들어 두면 매끄럽습니다.

```
지금 이 머신의 Spine 환경에서 무엇을 할 수 있나요?

demo/out/hero.psd를 Spine 리그로 만들어 demo/out/generated에 출력해 주세요.

demo/out/generated/hero.json을 atlas와 함께 감사하고 문제를 알려 주세요.

wave 애니메이션 프레임 4장을 렌더링해서 저장해 주세요.

비주얼 베이스라인을 만들고 그것과 비교해 주세요.

이 애셋을 Unity 프로젝트에서 쓰려면 무엇이 필요한가요?
```

마지막 질문이 마무리에 좋습니다. 필요한 파일명 변경, 맞는 런타임 브랜치, 그리고 이 스켈레톤 자신의
애니메이션에서 도출한 mix 테이블이 포함된 컨트롤러를 답해 줍니다.

## 먼저 솔직하게 말해 둘 것

- **샘플 캐릭터는 코드가 그립니다.** 모든 형태와 외곽선, 음영이 `make-sample-psd.py`의
  좌표에서 나오며, 외부 아트 애셋은 전혀 쓰지 않고 누구의 그림도 따라 그리지 않았습니다.
  보여주는 것은 리깅 규칙(관절 피벗, 가상 본, 드로우 순서)이지 아트 방향성이 아닙니다.
- **export, pack, import는 구매 라이선스가 필요합니다.** 9단계가 그 경계를 의도적으로 보여줍니다.
  데모의 나머지는 trial에서 동작합니다.
- **렌더링 프레임은 Spine 웹 런타임**에서 나온 것이며, Spine 자체의 이미지 내보내기가 아닙니다.
  Spine의 내보내기가 공식 비주얼 출력이고, 이 경로는 데스크톱 세션 없이 파이프라인이 스스로
  검증하기 위해 존재합니다.

## 문제 해결

| 증상 | 조치 |
|---|---|
| `dist/server.js is missing` | `npm run build` |
| 2단계에서 uv를 쓸 수 없다고 나옴 | `uv sync --project python`, 또는 내장된 작은 리그로 계속 진행 |
| 5~7단계가 건너뛰어짐 | `npx playwright install chromium` |
| Spine 에디터에서 `File -> Import Data` 후 캔버스가 빈 화면 | 에디터는 가져온 JSON을 기준으로 각 어태치먼트를 `<skeleton.images>/<attachmentName>.png`로 해석하며 `.atlas`는 전혀 읽지 않습니다. `demo/out/generated/images/`가 `hero.json` 옆에 있고 어태치먼트마다 PNG가 있는지 확인하세요. 폴더가 없으면 `emitLooseImages` true(기본값)로 다시 실행합니다. 직접 그 폴더에 넣은 PNG는 `foreignImagesKept`로 보고되고 그대로 남습니다. 알려진 신체 부위 이름의 이미지만 정리됩니다 |
| 어느 단계에서 `CLI_TIMEOUT` | 열려 있는 Spine 에디터 창을 모두 닫으세요. 런처가 실행 중인 에디터에 CLI 요청을 넘기고 돌아오지 않습니다 |
| 텍스트 기록이 필요함 | `NO_COLOR=1 npm run demo > demo-transcript.txt` |
