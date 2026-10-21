# kiro-spine2d-accelerator

Spine 2D 애셋 작업을 위한 Kiro Power입니다. 내보낸 스켈레톤 데이터 검사와 린트, 텍스처 패커 설정
생성, Spine CLI를 통한 일괄 내보내기, 레이어로 나뉜 PSD에서 리그 생성, 헤드리스 애니메이션 렌더링,
비주얼 리그레션 탐지, 그리고 Unity／Web／Godot 런타임 통합 스캐폴딩을 제공합니다.

[English](README.md) · [繁體中文](README_ZH.md) · [简体中文](README_CN.md) · [日本語](README_JP.md)

## 이렇게 설계한 이유

**Spine에는 에디터 내 API가 없습니다.** 공식 자동화 수단은 명령줄 인터페이스뿐이며, CLI는 "별도의
Spine 프로세스를 시작 → 파일 단위 작업 수행 → 종료"하는 방식으로 동작합니다. 열려 있는 에디터 창을
제어하거나, 본을 추가하거나, 슬롯을 선택할 수는 없습니다.

그래서 이 Power는 실제로 가치를 낼 수 있는 지점에 기능을 둡니다.

- **CLI 오케스트레이션** — export, pack, unpack, import, cleanup. 한 번의 호출로 묶을 수 있고
  에디터 버전 고정도 지원합니다
- **결정적인 데이터 레이어** — 내보낸 스켈레톤과 atlas를 코드로 파싱·검사·린트·비교합니다. 모델이
  JSON을 직접 수정하게 하지 않습니다
- **생성** — 레이어 PSD에서 임포트 가능한 리그로. 에디터를 완전히 우회합니다
- **검증** — 헤드리스 렌더링과 픽셀 리그레션. CI 게이트로 바로 쓸 수 있습니다
- **통합** — 임포트를 조용히 망가뜨리는 런타임별 파일명 규칙과 연결 코드

실제 설치 환경에서 확인하여 도구 동작에 반영한 두 가지 사실:

1. **Spine 에디터가 열려 있으면 CLI가 영원히 기다립니다.** 런처가 기존 인스턴스에 요청을 넘기고
   `Started.`를 출력한 뒤 돌아오지 않습니다. 이 프로젝트의 모든 CLI 도구에는 타임아웃이 있고 이
   상황을 명확히 보고합니다.
2. **Trial은 모든 쓰기를 금지합니다.** 저장, 텍스처 패킹, 모든 내보내기가 비활성화됩니다. 쓰기 도구는
   먼저 에디션을 확인하고 "실행하려 했던 명령줄"과 함께 거부하므로, 라이선스를 구입한 뒤 그대로 다시
   실행할 수 있습니다.

## 설치

```bash
npm install
npm run build

# 선택 — PSD에서 리그 생성
uv sync --project python

# 선택 — 헤드리스 프리뷰와 비주얼 리그레션
npx playwright install chromium
```

MCP 설정(`mcp.json`)에 등록합니다.

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["./dist/server.js"],
      "transport": "stdio"
    }
  }
}
```

서버는 stdio로만 통신하며 네트워크 포트를 열지 않으므로, 인증이 필요한 수신 영역이 없습니다.

| 환경 변수 | 용도 |
|---|---|
| `SPINE_EXECUTABLE` | Spine CLI 경로를 명시합니다. Windows에서는 exit code를 반환하는 `.com`을 써야 합니다. |
| `SPINE_USER_DATA` | Spine 사용자 데이터 디렉터리(`spine.log`, `version.txt`, `examples/`). |
| `SPINE_WORKSPACE_ROOT` | 쓰기를 제한하는 루트. 기본값은 작업 디렉터리입니다. |

## 도구

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
| `psd_to_skeleton` | 레이어 PSD → 스켈레톤 JSON + atlas + 페이지 이미지. 생성 후 검사와 린트까지 수행 |
| `render_preview` | 헤드리스 Chromium에서 spine-ts로 애니메이션 프레임 렌더링 |
| `visual_regression` | 베이스라인과 비교하고 diff 이미지를 기록. 실패 시 게이트를 닫습니다 |
| `runtime_scaffold` | 타깃별 파일명 요구사항, mix 테이블이 포함된 컨트롤러 코드, 단계별 README |

## 전형적인 흐름

```
spine_env_probe                       # 이 머신에서 실제로 가능한 것은?
skeleton_inspect  input, atlas        # 데이터에 무엇이 있고 atlas에 빠진 영역은 없는지
skeleton_lint     input, atlas        # 팀 규칙과 예산에 비추어 올바른지
render_preview    skeleton, atlas     # 실제로 렌더링되는지
visual_regression skeleton, atlas     # 외형이 바뀌지 않았는지
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

## 저장소 구조

```
POWER.md              Power 정의: 아키텍처, 기본 동작, 도구 목록, 워크플로
steering/             AI가 행동 전에 읽는 13개 도메인 가이드
templates/            export-settings, pack-settings, lint-rules, ci
hooks/                이 Power를 활성화하는 promptSubmit 훅
src/                  실행 레이어(TypeScript, stdio MCP 서버)
python/               PSD → 리그 사이드카(uv, psd-tools, Pillow, rectpack)
tests/                단위·속성·통합 테스트
```

## 개발

```bash
npm run typecheck
npm test                      # 559개 테스트
npm run test:integration      # Spine CLI와 Chromium이 있으면 실제로 실행합니다
uv run --project python pytest   # 66개 테스트
```

통합 테스트는 Spine이나 Chromium이 없으면 스스로 건너뛰므로 깨끗한 머신에서도 스위트가 통과합니다.
`SPINE_CLI_LIVE=1` 선택 계층은 모든 Spine 에디터 창을 닫아야 합니다.

## 솔직한 현황

| 실제로 검증된 것 | 방법 |
|---|---|
| Trial 감지, 기능 매트릭스, CLI `--version` | 실제 Spine 4.3.26 Trial |
| 에디터가 CLI 요청을 가져가 멈추는 동작 | 재현한 뒤 타임아웃과 전용 힌트로 구현 |
| 헤드리스 렌더링, 결정성, 리그레션 탐지 | 실제 헤드리스 Chromium |
| PSD → 스켈레톤 + atlas | psd-tools로 만든 실제 PSD 파일 |
| Python 사이드카 브리지 | 실제 `uv run` 왕복 |

| 아직 검증되지 않은 것 | 이유 |
|---|---|
| export / pack / import / cleanup의 성공 실행 | 여기에는 정식 라이선스가 없습니다. 명령줄 조립, capability gate, 단위 테스트는 모두 있지만 라이선스 버전의 성공 실행은 관측하지 못했습니다. |
| 내보내기 설정의 필드명 | 공개 문서가 없습니다. 템플릿은 내보내기 대화상자 문서를 바탕으로 만들었으므로 `spine_export_settings_capture`로 보정하세요. `pack.json`에는 이 문제가 없습니다. |
| 바이너리 `.skel` 파싱 | 현재 범위 밖이며, 데이터 레이어는 JSON 내보내기를 읽습니다. |
| Godot 통합 | 파일명 규칙과 설치 경로는 공식 문서에서 가져왔지만 실제 Godot 프로젝트에서는 실행하지 않았습니다. |

## 라이선스

MIT. [LICENSE](LICENSE)를 참고하세요.

Spine 자체는 Esoteric Software의 상용 소프트웨어이며, Spine Runtimes에는 별도의 라이선스가
있습니다. Runtimes를 통합한 소프트웨어의 모든 사용자는 각자 Spine 라이선스를 보유해야 합니다.
이 Power는 Spine, 그 runtimes, 예제 애셋을 포함하거나 재배포하지 않습니다.
