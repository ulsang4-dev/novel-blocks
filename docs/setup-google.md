# 구글 드라이브 연결하기 (한 번만, 약 10분)

## 1. Google Cloud 프로젝트 만들기
1. https://console.cloud.google.com 에 접속해 로그인합니다.
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 `덩어리` → 만들기.

## 2. Drive API 켜기
1. 왼쪽 메뉴 **API 및 서비스 → 라이브러리**.
2. `Google Drive API` 검색 → **사용**.

## 3. OAuth 동의 화면
1. **API 및 서비스 → OAuth 동의 화면**(또는 "Google 인증 플랫폼").
2. 사용자 유형 **외부** → 앱 이름 `덩어리`, 지원 이메일에 본인 메일.
3. **데이터 액세스(범위)** 에서 다음 두 개를 추가:
   - `.../auth/drive.appdata`
   - `.../auth/drive.file`
4. **대상(테스트 사용자)** 에 본인 구글 계정을 추가합니다. 게시 상태는 **테스트**로 둡니다(심사 불필요).

## 4. OAuth 클라이언트 ID 만들기
1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**.
2. 애플리케이션 유형 **웹 애플리케이션**.
3. **승인된 자바스크립트 원본**에 추가:
   - `http://localhost:5173`
   - `http://localhost:4173`
   - 배포 주소 (예: `https://<GitHub아이디>.github.io`)
4. 만들기 → 표시된 **클라이언트 ID**(`...apps.googleusercontent.com`)를 복사합니다.

## 5. 앱에 넣기
- 내 컴퓨터에서 실행할 때: 프로젝트 폴더에 `.env.local` 파일을 만들고
  ```
  VITE_GOOGLE_CLIENT_ID=복사한_클라이언트_ID
  ```
- GitHub Pages 배포: 저장소 **Settings → Secrets and variables → Actions → Variables** 에
  `VITE_GOOGLE_CLIENT_ID` 변수를 추가합니다.

## 참고
- 테스트 상태의 앱은 로그인할 때 "Google에서 확인하지 않은 앱" 경고가 나옵니다. 본인이 만든 앱이므로 **계속**을 누르면 됩니다.
- 로그인은 약 1시간마다 만료됩니다. 만료되면 상단에 "다시 로그인" 배너가 나오고, 그동안 쓴 글은 기기에 저장돼 있다가 로그인하면 올라갑니다.
- 앱은 드라이브의 앱 전용 숨김 폴더와 앱이 만든 “소설 원고” 폴더에만 접근합니다.
