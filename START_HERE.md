# cal.dudu-works.com 시작하기

예약 기간은 2026-09-09부터 2026-09-22까지입니다. 오전 09:00, 오후 13:00, 저녁 18:00, 총 42슬롯입니다.

## 1. ZIP을 풀고 VS Code에서 폴더 열기

ZIP을 풀어 package.json과 AGENTS.md가 있는 cal-dudu-starter 폴더를 엽니다. Node.js와 npm이 설치되어 있어야 합니다. Terminal 메뉴에서 New Terminal을 엽니다.

## 2. 같은 의존성 설치

Mac 터미널:

```sh
npm ci
npm test
npm run build
npm run dev
```

Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

각 명령이 종료된 뒤 다음 명령을 입력합니다. 마지막 명령은 서버를 계속 실행하므로 종료하지 않습니다. 브라우저에서 터미널의 Local 주소를 엽니다. 기본 주소는 http://localhost:5187 입니다. 가상 서비스 이름 cal.dudu-works.com은 실제 배포 주소가 아닙니다.

## 3. 공통 예약 시나리오

1. 고객 C01: 9/9 오전, 9/9 오후를 순서대로 신청합니다.
2. 고객 C02: 9/9 오전 하나를 신청합니다.
3. 어드민: C01의 9/9 오전을 확정합니다.
4. 고객 C02: 재선택 안내를 확인하고 9/10 오전을 신청합니다.
5. 어드민: C02의 9/10 오전을 확정합니다.
6. 어드민의 실행 기록에서 결과를 확인합니다.
7. 확정 고객이 취소를 요청하고, 어드민이 승인한 뒤 슬롯이 다시 열리는지 확인합니다.

희망 신청만으로 슬롯이 마감되지 않습니다. 확정된 슬롯에 다른 고객을 확정할 수 없습니다. 다른 희망이 하나라도 남아 있으면 접수 상태를 유지합니다.

## 4. Supabase SQL 설치

새 실습용 Supabase 프로젝트의 SQL Editor에서 New query를 엽니다. `sql/00_supabase.sql` 전체를 붙여 넣고 Run을 누릅니다. 테이블, 함수, 권한, 42슬롯이 함께 생성됩니다. 이전 버전의 SQL을 추가 실행하지 않습니다.

```sql
select count(*) as slots, min(date) as first_day, max(date) as last_day from public.slots;
```

예상 결과: 42, 2026-09-09, 2026-09-22.

RPC(앱에서 호출하는 DB 함수)는 submit_request, confirm_request, resubmit_request입니다. 고객은 Supabase Auth의 사용자 UUID로 식별합니다. 관리자 권한은 서버가 관리하는 app_metadata.role='admin'을 확인합니다. 고객이 수정할 수 있는 user_metadata에 관리자 권한을 넣지 않습니다.

### 테스트 로그인 사용자 준비

빠른 로그인 버튼은 사용자를 자동으로 만들지 않습니다. Supabase Dashboard의 Authentication > Users에서 아래 사용자를 먼저 생성하고, 이메일 확인을 완료된 상태로 설정합니다.

- 고객: `c01@test.com` / `password123`
- 고객: `c02@test.com` / `password123`
- 관리자: `admin@test.com` / `password123`

앱 로그인 화면에는 이메일 대신 일반 아이디 `c01`, `c02` 또는 `admin`을 입력합니다. 앱이 Supabase 인증용 이메일로 내부 변환합니다.

관리자 사용자를 만든 뒤 SQL Editor에서 `sql/01_set_admin.sql` 전체를 실행합니다. 이 스크립트는 관리자 역할을 `user_metadata`가 아니라 서버에서만 관리되는 `app_metadata`에 저장합니다. 실행 후 앱에서 반드시 로그아웃하고 다시 로그인합니다.

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'admin@test.com';
```

로그인 후 고객이 접수하면 Table Editor의 `public.requests`에 신청 1행, `public.candidates`에 선택한 희망 수만큼 행, `public.operation_logs`에 성공 기록 1행이 생깁니다. `public.slots`는 접수만으로 마감되지 않고 관리자가 확정한 뒤에만 바뀝니다.

Table Editor와 어드민 화면에서 UUID 대신 `c01`, `c02` 같은 아이디를 함께 보려면 SQL Editor에서 `sql/02_customer_login_ids.sql`을 한 번 실행합니다. `customer_id`는 권한 검증용 UUID로 유지되고, 사람이 확인하는 값은 `customer_login_id`에 저장됩니다. 이 스크립트는 기존 신청도 함께 채웁니다.

어드민 화면에서 개별 접수 삭제와 전체 초기화를 사용하려면 SQL Editor에서 `sql/03_admin_cleanup.sql`을 한 번 실행합니다. 두 작업은 `app_metadata.role='admin'`인 로그인 사용자만 호출할 수 있습니다. 개별 삭제 시 해당 확정 슬롯도 다시 열리며, 전체 초기화는 접수·후보·확정·실행 기록을 비우고 42개 슬롯을 모두 `available`로 되돌립니다.

Table Editor의 `confirmations`에서도 UUID 대신 로그인 아이디를 바로 확인하려면 `sql/04_readable_confirmation_ids.sql`을 한 번 실행합니다. 기존 UUID 열은 관계 보존용으로 유지되고, `customer_login_id`와 `admin_login_id` 열에 `c01`, `c02`, `admin`이 함께 저장됩니다. 기존 확정 기록도 가능한 범위에서 자동으로 채웁니다.

확정 실패의 오류 위치 기록을 위해 `sql/05_confirmation_failure_logs.sql`, 고객 취소 요청과 관리자 승인·거절을 위해 `sql/06_cancellation_workflow.sql`을 번호 순서대로 각각 한 번 실행합니다. 취소 승인 전에는 슬롯이 계속 마감 상태이며, 승인 후에만 다시 열립니다. 기존 확정 행은 삭제하지 않고 취소 시각과 함께 보존됩니다.

고객 선택 메모를 사용하려면 이어서 `sql/07_booking_notes.sql`을 실행합니다. 메모는 선택 사항이며 최대 500자이고 신청·후보와 같은 트랜잭션으로 저장됩니다.

현재 ZIP의 화면은 한 브라우저의 localStorage를 사용하는 공통 예약 실습 화면입니다. SQL 설치는 Supabase DB를 준비하는 단계입니다. 환경 변수 입력만으로 이 화면이 자동으로 Supabase에 연결되지는 않습니다. 로그인 화면과 DB 호출 연결은 아래 프롬프트로 이어갑니다.

## 5. VS Code의 Haiku에 넣는 연결 프롬프트

```text
AGENTS.md, PRD.md와 sql/00_supabase.sql을 읽어라. 고정 슬롯과 판정 함수를 다시 만들지 마라. 기존 로컬 모드는 유지하고 명시적인 Supabase 모드를 연결하라. 고객 로그인은 Supabase Auth를 사용하고 submit_request, confirm_request, resubmit_request를 호출하라. 관리자 여부는 서버의 app_metadata.role로 판정한다. DB 직접 쓰기는 하지 않는다. 인증·조회·저장 오류를 화면에 표시하고 실패 시 로컬 모드로 몰래 전환하지 마라. 위 공통 시나리오를 두 시험 사용자로 실행해 실제 결과를 기록하라.
```

.env.example을 참고하여 .env.local에 프로젝트 URL과 공개용 키를 입력합니다. service_role 키와 DB 비밀번호를 VITE_ 변수에 넣지 않습니다. .env.local은 제출하거나 Git에 올리지 않습니다.

## 6. 본인 기능 얹기

공통 시나리오가 통과하면 Git에 기본 버전을 저장합니다. 고객 카드에서 한 장면을 선택하여 Journey, Service Blueprint, 기능 선택 이유를 적습니다. UI의 희망 선택 상한 3과 1처럼 설정 하나만 바꾸고 동일 입력의 결과를 비교합니다. 42슬롯과 슬롯당 확정 한 명이라는 DB 규칙은 유지합니다.
