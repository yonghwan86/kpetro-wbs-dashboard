# WBS 1단계 화면 목업

기존 Flask 원본을 수정하지 않고 화면 검토를 위해 분리한 정적 사이트입니다.

## 범위

- 대시보드, 단계별 입력, 주차별 입력, 회의 관리, 프로젝트 설정 화면
- 샘플 데이터만 포함
- 입력 데이터는 각 브라우저의 `localStorage`에만 임시 저장
- 실제 DB, 사용자 인증, 서버 업로드, 엑셀 반영은 포함하지 않음
- 샘플 첨부파일 다운로드만 제공

## 로컬 확인

정적 파일 서버로 이 폴더를 서비스한 뒤 `index.html`을 엽니다.

## Vercel 배포

Vercel 프로젝트의 Root Directory를 `mock-site`로 지정합니다. Framework Preset은 `Other`, Build Command와 Output Directory는 비워 둡니다.

이 목업은 실제 업무자료를 저장하면 안 됩니다. 기능형 2단계 사이트는 별도의 인증, 외부 DB, 객체 저장소를 사용합니다.
