# KPetro WBS Dashboard

Vercel 운영 대시보드와 이전 Flask 앱을 함께 보관한 개발 인수인계 저장소입니다. 현재 운영 화면은 `mock-site` 폴더의 Node.js 서버리스 API와 PostgreSQL을 사용합니다.

## 현재 Vercel 앱 빌드

Node.js 24 이상에서 실행합니다.

```powershell
Set-Location .\mock-site
npm install
npm test
npm run build
```

전체 API를 로컬에서 구동하려면 Vercel 프로젝트 환경변수 접근 권한과 Vercel CLI가 필요합니다.

## 전체 Flask 앱 실행

### 방법 A: Docker Desktop 사용 권장

```powershell
Copy-Item .env.example .env
docker compose up --build
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. MariaDB와 Flask 앱이 함께 실행되고 DB 데이터는 Docker 볼륨에 보존됩니다.

최초 실행 시 `.env`의 `INITIAL_ADMIN_ID`와 `INITIAL_ADMIN_PASSWORD`로 로그인합니다. 최초 로그인 직후 8자 이상의 새 비밀번호로 변경해야 합니다. 예시 비밀번호는 실제 운영에 사용하지 마세요.

종료:

```powershell
docker compose down
```

### 방법 B: Windows에 Python과 MariaDB를 직접 설치

1. Python 3.11 이상과 MariaDB 10.11 이상을 설치합니다.
2. MariaDB 관리자 계정으로 개발용 DB와 사용자를 한 번 생성합니다. 아래 비밀번호는 `.env`의 `DB_PASSWORD`와 동일하게 맞춥니다.

```sql
CREATE DATABASE wbs_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'wbs_user'@'%' IDENTIFIED BY 'change-this-password';
GRANT ALL PRIVILEGES ON wbs_db.* TO 'wbs_user'@'%';
FLUSH PRIVILEGES;
```

3. 아래 스크립트로 가상환경과 Python 패키지를 준비합니다.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-dev.ps1
```

4. 생성된 `.env`의 DB 주소·포트·계정·비밀번호를 실제 MariaDB 설정에 맞게 수정합니다.
5. 앱을 실행합니다.

```powershell
.\scripts\run-flask.ps1
```

## Vercel 운영 배포

Vercel에는 `mock-site`의 정적 화면과 서버리스 API를 배포합니다. 데이터는 PostgreSQL, 비공개 회의 첨부파일은 Vercel Blob에 저장됩니다. Flask/MariaDB 앱은 현재 Vercel 배포 대상이 아닙니다.

GitHub의 `main` 브랜치에 푸시하면 Vercel 운영 사이트가 자동 배포됩니다. 기능 작업은 별도 브랜치에서 진행하면 Pull Request마다 Vercel 미리보기 배포를 사용할 수 있습니다.

수동 배포가 필요하면 프로젝트 루트(`wbs_project`)에서 실행합니다. Vercel 프로젝트의 Root Directory가 이미 `mock-site`로 설정되어 있으므로 `mock-site` 안에서 실행하면 경로가 이중 적용됩니다.

```powershell
npx --yes vercel@latest login
npx --yes vercel@latest link --project kpetro-wbs-dashboard
npx --yes vercel@latest --prod
```

- 현재 공개 주소: <https://kpetrowbs.vercel.app/>
- 스마트 TV 전용 주소: <https://kpetrowbs.vercel.app/tv>
- GitHub 저장소: <https://github.com/yonghwan86/kpetro-wbs-dashboard>
- Vercel 계정 `yonghwan86s-projects`에 접근 권한이 있어야 기존 프로젝트로 배포할 수 있습니다.

TV에는 `/tv` 주소를 사용합니다. 이 경로는 HTML 캐시를 금지하고 하단 관리 메뉴를 숨깁니다. 화면은 매시간 새로고침되고 D-DAY 시계는 브라우저 안에서 매초 갱신됩니다.

## 주요 폴더

- `mock-site/`: Vercel 운영 화면, 서버리스 API, 테스트 및 빌드 설정
- `server.py`, `templates/`, `static/`: MariaDB를 사용하는 원본 Flask 앱
- `design-assets/`: CI 원본 이미지
- `tools/extract_ci.py`: CI·앱 아이콘 재생성 도구
- `uploads/`: 로컬 회의 첨부파일 저장 위치
- `legacy-node/`: 사용하지 않는 초기 Node.js 시도본

## CI 이미지 다시 만들기

Python 가상환경을 준비한 뒤 다음을 실행합니다.

```powershell
.\.venv\Scripts\python.exe .\tools\extract_ci.py
```

스크립트는 프로젝트 내부의 `design-assets/kpetro-corporate-symbol-original.jpg`를 사용하므로 PC 경로가 바뀌어도 동작합니다.

## 보안 주의

- `.env`는 다른 사람에게 전달하거나 Git에 올리지 않습니다. `.env.example`만 공유합니다.
- 실제 업무자료가 들어 있는 `uploads/`는 공개 저장소나 Vercel에 올리지 않습니다.
- 대시보드는 공개 읽기 화면이며 입력·회의·프로젝트·회원·코드 관리 화면은 로그인과 화면별 권한을 사용합니다.
- 운영 DB와 회의 첨부파일에는 실제 업무자료가 저장될 수 있으므로 계정 배포와 공개 범위는 사내 정보보안 정책에 따라 관리합니다.
- 원본 Flask 앱에는 로그인·화면 권한·회의 비밀번호 해시·20MB/확장자 업로드 제한이 적용되어 있습니다. 다만 실제 인터넷 운영 전에는 운영 DB, HTTPS, 백업, 비밀번호 초기화 전달 절차와 사내 정보보안 검토가 추가로 필요합니다.

## 다른 PC로 옮길 때

이 폴더 전체를 복사하거나, 함께 생성된 `wbs_project-portable.zip`을 옮기면 됩니다. 이동용 압축본에는 `.env`, 실제 `uploads` 자료, 가상환경과 캐시가 포함되지 않습니다.
