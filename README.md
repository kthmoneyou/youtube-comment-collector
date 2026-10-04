# 댓글모아 — YouTube 댓글 수집기

https://kthmoneyou.github.io/youtube-comment-collector/

YouTube Data API v3를 이용하는 정적 웹 도구. 방문자가 자신의 API 키를 입력합니다. 키 없는 공용 수집 서버는 포함하지 않습니다.

## 기능

- 일반 영상, Shorts, youtu.be, 라이브 다시보기 주소 또는 영상 ID 입력 (최대 20개, 중복 제거)
- 영상별 원댓글 및 선택적 답글 수집, 페이지 순회, 중복 제거, 진행 상태, 중지, 부분 결과 보존
- 영상당 100 / 500 / 1,000 / 5,000개 제한 (답글 포함), 회당 API 요청 500회 제한
- 원댓글을 먼저 모으고 남은 개수만큼 답글을 수집. 댓글이 많은 영상의 낮은 제한에서는 답글이 포함되지 않을 수 있음
- 검색, 좋아요순/최신순/오래된순 정렬, 원댓글/답글 필터, 페이지당 30개 표시
- 현재 필터 전체 결과 CSV 다운로드 (UTF-8 BOM, 수식 삽입 방지)
- API 없이 사용하는 명시적 예시 모드. 예시는 실제 댓글이 아님

## API 키 준비

Google Cloud에서 프로젝트 생성 → YouTube Data API v3 사용 설정 → 사용자 인증 정보에서 API 키 생성.
API 제한을 YouTube Data API v3로 설정하고 웹사이트 제한에 `https://kthmoneyou.github.io/*`를 추가합니다. 브라우저가 출처만 전송하므로 경로 단위 제한 대신 도메인 기준이며 같은 도메인의 다른 사이트도 허용될 수 있습니다. 로컬 테스트 시 `http://127.0.0.1:8766/*`도 필요합니다.

API 키는 메모리에만 존재하고 `X-Goog-Api-Key` 헤더로 Google에 직접 전달됩니다. URL, 로그, 저장소, CSV에 키를 기록하지 않습니다. DOM에 붙여 넣은 키는 현재 브라우저 사용자와 확장프로그램이 접근할 수 있으므로 개인 키 제한을 적용하세요.

## 개발

빌드·설치 의존성이 없습니다. Node.js 22 이상에서 `npm test`, Python 3로 `npm start`를 실행하고 http://127.0.0.1:8766 에 접속합니다. 최신 Chrome, Edge, Safari, Firefox 권장 (`AbortSignal.any`, `AbortSignal.timeout` 사용).

GitHub Pages는 `main` 브랜치 루트에서 게시합니다. 기존 글자수 사이트와 분리된 저장소입니다.

## 데이터 처리

API 응답은 현재 탭 메모리에만 보관되며 새로고침 시 제거됩니다. Google/YouTube API 및 GitHub Pages의 자체 요청 처리는 각 서비스 정책에 따릅니다. 공개적으로 접근 가능한 댓글만 수집하며 실시간 채팅·삭제된 댓글·비공개/검토 대기 댓글은 제외됩니다. 수집 중 댓글 상태 변경으로 화면 수치와 다를 수 있습니다. CSV의 날짜는 UTC ISO 8601, 웹 표시 날짜는 브라우저 현지 시간입니다.

## 검증 범위

계산·필터·CSV·API 페이지 순회·부분 실패·중지 등은 테스트용 API 응답으로 검사합니다. 실제 키가 제공되지 않은 환경에서는 실제 영상의 성공 수집까지 검증했다고 간주하지 않습니다.

공식 참고: [댓글 스레드](https://developers.google.com/youtube/v3/docs/commentThreads/list), [답글](https://developers.google.com/youtube/v3/docs/comments/list), [키 제한](https://docs.cloud.google.com/docs/authentication/api-keys).
