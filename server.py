from flask import Flask, jsonify, request, render_template, send_from_directory, redirect, url_for, session
from flask_cors import CORS
import pymysql
import logging
import os
import json
import secrets
import uuid
from functools import wraps
from pathlib import Path
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / '.env')

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / 'templates'),
    static_folder=str(BASE_DIR / 'static')
)
app.secret_key = os.getenv('SECRET_KEY', 'local-development-secret-change-me')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.getenv('SESSION_COOKIE_SECURE', 'false').lower() in ('1', 'true', 'yes', 'on'),
    PERMANENT_SESSION_LIFETIME=int(os.getenv('SESSION_LIFETIME_MINUTES', '480')) * 60,
)

cors_origins = [origin.strip() for origin in os.getenv('CORS_ORIGINS', '').split(',') if origin.strip()]
if cors_origins:
    CORS(app, origins=cors_origins, supports_credentials=True)


@app.after_request
def apply_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'no-referrer')
    if request.path.startswith('/api/') or 'user_id' in session:
        response.headers['Cache-Control'] = 'no-store'
    return response

UPLOAD_FOLDER = BASE_DIR / os.getenv('UPLOAD_FOLDER', 'uploads')
STATIC_FOLDER = BASE_DIR / 'static'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_UPLOAD_MB', '20')) * 1024 * 1024
PUBLIC_DASHBOARD = os.getenv('PUBLIC_DASHBOARD', 'true').lower() in ('1', 'true', 'yes', 'on')
ALLOWED_UPLOAD_EXTENSIONS = {
    extension.strip().lower()
    for extension in os.getenv(
        'ALLOWED_UPLOAD_EXTENSIONS',
        'pdf,doc,docx,hwp,hwpx,xls,xlsx,ppt,pptx,txt,png,jpg,jpeg'
    ).split(',')
    if extension.strip()
}

DB_NAME = os.getenv('DB_NAME', 'wbs_db')
if not DB_NAME.replace('_', '').isalnum():
    raise ValueError('DB_NAME에는 영문자, 숫자, 밑줄만 사용할 수 있습니다.')

DB_CONFIG = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'port': int(os.getenv('DB_PORT', '3303')),
    'user': os.getenv('DB_USER', 'wbs_user'),
    'password': os.getenv('DB_PASSWORD', 'change-this-password'),
    'charset': 'utf8mb4',
    'cursorclass': pymysql.cursors.DictCursor
}

SCREEN_PERMISSIONS = {
    'dashboard': '대시보드',
    'input': '단계별진척',
    'weekly': '주차별진척',
    'meetings': '회의관리',
    'project': '프로젝트관리',
    'users': '회원관리',
    'codes': '코드관리',
}


def parse_permissions(raw_permissions):
    if raw_permissions == 'all':
        return {'all': 'Y'}
    if isinstance(raw_permissions, dict):
        return raw_permissions
    try:
        parsed = json.loads(raw_permissions or '{}')
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def has_permission(permission_key):
    if 'user_id' not in session:
        return False
    permissions = session.get('screen_permissions') or {}
    return permissions.get('all') == 'Y' or permissions.get(SCREEN_PERMISSIONS[permission_key]) == 'Y'


def permission_required(permission_key=None, admin_only=False):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if 'user_id' not in session:
                if request.path.startswith('/api/'):
                    return jsonify({'success': False, 'message': '로그인이 필요합니다.'}), 401
                return redirect(url_for('login_page', next=request.path))
            if admin_only and not session.get('is_admin'):
                if request.path.startswith('/api/'):
                    return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
                return '관리자 권한이 필요합니다.', 403
            if permission_key and not has_permission(permission_key):
                if request.path.startswith('/api/'):
                    return jsonify({'success': False, 'message': '화면 접근 권한이 없습니다.'}), 403
                return '화면 접근 권한이 없습니다.', 403
            return view(*args, **kwargs)
        return wrapped
    return decorator


def api_permission_error(permission_key=None, admin_only=False):
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': '로그인이 필요합니다.'}), 401
    if admin_only and not session.get('is_admin'):
        return jsonify({'success': False, 'message': '관리자 권한이 필요합니다.'}), 403
    if permission_key and not has_permission(permission_key):
        return jsonify({'success': False, 'message': '화면 접근 권한이 없습니다.'}), 403
    return None


def normalize_permissions(raw_permissions):
    permissions = parse_permissions(raw_permissions)
    if permissions.get('all') == 'Y':
        return 'all'
    allowed_names = set(SCREEN_PERMISSIONS.values())
    normalized = {
        name: 'Y'
        for name, enabled in permissions.items()
        if name in allowed_names and enabled == 'Y'
    }
    return json.dumps(normalized, ensure_ascii=False)


def verify_stored_password(stored_password, submitted_password):
    stored_password = stored_password or ''
    submitted_password = submitted_password or ''
    if stored_password.startswith(('scrypt:', 'pbkdf2:')):
        try:
            return check_password_hash(stored_password, submitted_password)
        except (TypeError, ValueError):
            return False
    return secrets.compare_digest(stored_password, submitted_password)


def allowed_upload(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_UPLOAD_EXTENSIONS


def stored_file_path(stored_path):
    return UPLOAD_FOLDER / Path(stored_path or '').name

def get_connection():
    return pymysql.connect(
        host=DB_CONFIG['host'], port=DB_CONFIG['port'], user=DB_CONFIG['user'],
        password=DB_CONFIG['password'], database=DB_NAME, charset=DB_CONFIG['charset'],
        cursorclass=DB_CONFIG['cursorclass']
    )


def ensure_column(cursor, table_name, column_name, column_definition):
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
        """,
        (DB_NAME, table_name, column_name),
    )
    if cursor.fetchone()['count'] == 0:
        cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {column_definition}")


def init_db():
    try:
        conn = get_connection()
    except pymysql.err.OperationalError as exc:
        if not exc.args or exc.args[0] != 1049:
            raise
        bootstrap_conn = pymysql.connect(
            host=DB_CONFIG['host'], port=DB_CONFIG['port'],
            user=DB_CONFIG['user'], password=DB_CONFIG['password'],
            charset=DB_CONFIG['charset'], cursorclass=DB_CONFIG['cursorclass']
        )
        try:
            with bootstrap_conn.cursor() as cursor:
                cursor.execute(f"CREATE DATABASE `{DB_NAME}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            bootstrap_conn.commit()
        finally:
            bootstrap_conn.close()
        conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # 프로젝트 설정 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS project_config (
                    id INT PRIMARY KEY,
                    project_title VARCHAR(100),
                    target_date DATE
                )
            """)

            ensure_column(cursor, 'project_config', 'start_date', 'DATE')
            ensure_column(cursor, 'project_config', 'end_date', 'DATE')

            cursor.execute("SELECT COUNT(*) as cnt FROM project_config")
            if cursor.fetchone()['cnt'] == 0:
                cursor.execute("""
                    INSERT INTO project_config (id, project_title, target_date, start_date, end_date)
                    VALUES (1, '석유통합관제센터 구축', '2026-11-01', '2026-08-01', '2026-12-31')
                """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(50) PRIMARY KEY,
                    password VARCHAR(255) NOT NULL,
                    name VARCHAR(50) NOT NULL,
                    affiliation VARCHAR(100),
                    team_name VARCHAR(50),
                    job_role VARCHAR(50),
                    phone VARCHAR(30),
                    email VARCHAR(100),
                    start_date DATE,
                    end_date DATE,
                    screen_permissions TEXT,
                    is_first_login TINYINT DEFAULT 1,
                    is_admin TINYINT DEFAULT 0
                )
            """)
            ensure_column(cursor, 'users', 'is_admin', 'TINYINT DEFAULT 0')

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS common_codes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    category_code VARCHAR(50) NOT NULL,
                    category_code_name VARCHAR(100),
                    code_value VARCHAR(50) NOT NULL,
                    code_name VARCHAR(100) NOT NULL,
                    sort_order INT DEFAULT 0,
                    UNIQUE KEY uq_common_code (category_code, code_value)
                )
            """)

            admin_id = os.getenv('INITIAL_ADMIN_ID', 'admin')
            admin_password = os.getenv('INITIAL_ADMIN_PASSWORD', 'change-this-admin-password')
            admin_email = os.getenv('INITIAL_ADMIN_EMAIL', 'admin@example.invalid')
            cursor.execute("SELECT COUNT(*) AS count FROM users WHERE id = %s", (admin_id,))
            if cursor.fetchone()['count'] == 0:
                cursor.execute(
                    """
                    INSERT INTO users (
                        id, password, name, affiliation, team_name, job_role, email,
                        screen_permissions, is_first_login, is_admin
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'all', 1, 1)
                    """,
                    (
                        admin_id,
                        generate_password_hash(admin_password),
                        '시스템관리자',
                        '본사',
                        '관리자',
                        '시스템관리',
                        admin_email,
                    ),
                )
            else:
                cursor.execute(
                    "UPDATE users SET is_admin = 1, screen_permissions = 'all' WHERE id = %s",
                    (admin_id,),
                )

            cursor.execute("SELECT COUNT(*) AS count FROM common_codes")
            if cursor.fetchone()['count'] == 0:
                cursor.executemany(
                    """
                    INSERT INTO common_codes (
                        category_code, category_code_name, code_value, code_name, sort_order
                    ) VALUES (%s, %s, %s, %s, %s)
                    """,
                    [
                        ('TEAM', '팀명', 'DEV', '개발팀', 1),
                        ('TEAM', '팀명', 'PMO', 'PMO팀', 2),
                        ('TEAM', '팀명', 'OPS', '운영팀', 3),
                        ('TEAM', '팀명', 'SUP', '지원팀', 4),
                    ],
                )

            # WBS 진행 상태 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS wbs_progress (
                    system_name VARCHAR(50) NOT NULL,
                    phase_name VARCHAR(50) NOT NULL,
                    weight DECIMAL(5,1) DEFAULT 0.0,
                    plan_rate DECIMAL(5,1),
                    actual_rate DECIMAL(5,1),
                    start_date DATE,
                    end_date DATE,
                    input_date DATE,
                    PRIMARY KEY (system_name, phase_name)
                )
            """)

            ensure_column(cursor, 'wbs_progress', 'start_date', 'DATE')
            ensure_column(cursor, 'wbs_progress', 'end_date', 'DATE')
            ensure_column(cursor, 'wbs_progress', 'delay_reason', 'TEXT')
            ensure_column(cursor, 'wbs_progress', 'recovery_plan', 'TEXT')

            # 주차별 진척율 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS wbs_weekly (
                    week_no INT PRIMARY KEY,
                    plan_rate DECIMAL(5,1),
                    actual_rate DECIMAL(5,1)
                )
            """)

            # 회의 관리 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meetings (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(150) NOT NULL,
                    meeting_date DATE NOT NULL,
                    meeting_time TIME NOT NULL,
                    location VARCHAR(100),
                    attendees VARCHAR(255),
                    agenda TEXT,
                    password VARCHAR(255) NOT NULL,
                    content TEXT,
                    summary TEXT,
                    others TEXT
                )
            """)
            cursor.execute("ALTER TABLE meetings MODIFY COLUMN password VARCHAR(255) NOT NULL")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meeting_files (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    meeting_id INT NOT NULL,
                    file_name VARCHAR(255),
                    file_path VARCHAR(255)
                )
            """)

            cursor.execute("SELECT COUNT(*) as cnt FROM wbs_progress")
            if cursor.fetchone()['cnt'] == 0:
                initial_data = [
                    ('1. 수급가격통합시스템', '1. 공통', 10.0, 7.3, 7.3, '2026-08-19', '2026-09-02', '2026-08-19'),
                    ('1. 수급가격통합시스템', '2. 요구분석', 15.0, 8.2, 8.1, '2026-08-26', '2026-09-16', '2026-08-19'),
                    ('1. 수급가격통합시스템', '3. 설계', 20.0, 17.2, 16.2, '2026-09-09', '2026-10-07', '2026-08-19'),
                    ('1. 수급가격통합시스템', '4. 구현', 35.0, 30.5, 31.0, '2026-09-30', '2026-11-25', '2026-08-19'),
                    ('1. 수급가격통합시스템', '5. 테스트', 10.0, 21.5, 22.0, '2026-11-04', '2026-12-16', '2026-08-19'),
                    ('1. 수급가격통합시스템', '6. 이행', 10.0, 15.5, 16.0, '2026-11-18', '2026-12-23', '2026-08-19'),

                    ('2. AICC', '1. 요구분석', 20.0, 10.0, 10.0, '2026-09-02', '2026-09-23', '2026-08-19'),
                    ('2. AICC', '2. 설계', 20.0, 10.0, 10.0, '2026-09-16', '2026-10-14', '2026-08-19'),
                    ('2. AICC', '3. 구현', 40.0, 20.0, 20.0, '2026-10-07', '2026-12-02', '2026-08-19'),
                    ('2. AICC', '4. 테스트', 10.0, 5.0, 5.0, '2026-11-11', '2026-12-16', '2026-08-19'),
                    ('2. AICC', '5. 이행', 10.0, 5.0, 5.0, '2026-11-25', '2026-12-23', '2026-08-19'),

                    ('3. 상황실', '1. 요구정의분석', 20.0, 10.0, 10.0, '2026-09-02', '2026-09-23', '2026-08-19'),
                    ('3. 상황실', '2. 상황판 설계 및 심의', 20.0, 10.0, 10.0, '2026-09-16', '2026-10-14', '2026-08-19'),
                    ('3. 상황실', '3. 상황판 설치 및 시험', 30.0, 15.0, 15.0, '2026-10-07', '2026-11-25', '2026-08-19'),
                    ('3. 상황실', '4. 시스템 장비설치', 20.0, 10.0, 10.0, '2026-11-04', '2026-12-09', '2026-08-19'),
                    ('3. 상황실', '5. 오픈', 10.0, 5.0, 5.0, '2026-12-02', '2026-12-23', '2026-08-19'),

                    ('4. 사업관리', '1. 사업관리 전반', 100.0, 20.0, 20.0, '2026-08-19', '2026-12-31', '2026-08-19')
                ]
                cursor.executemany("""
                    INSERT INTO wbs_progress (system_name, phase_name, weight, plan_rate, actual_rate, start_date, end_date, input_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, initial_data)

            cursor.execute("SELECT COUNT(*) as cnt FROM wbs_weekly")
            if cursor.fetchone()['cnt'] == 0:
                default_weekly = [(i, i*5.0 if i<=20 else 100.0, None) for i in range(1, 22)]
                cursor.executemany("INSERT INTO wbs_weekly (week_no, plan_rate, actual_rate) VALUES (%s, %s, %s)", default_weekly)

        conn.commit()
    finally:
        conn.close()

if os.getenv('SKIP_DB_INIT', 'false').lower() not in ('1', 'true', 'yes', 'on'):
    init_db()


def page_context():
    return {
        'is_authenticated': 'user_id' in session,
        'is_admin': bool(session.get('is_admin')),
        'permissions': session.get('screen_permissions') or {},
        'can_edit_delay': has_permission('dashboard'),
        'can_input': has_permission('input'),
        'can_weekly': has_permission('weekly'),
        'can_meetings': has_permission('meetings'),
        'can_project': has_permission('project'),
    }


def save_meeting_uploads(cursor, meeting_id):
    saved_paths = []
    for uploaded_file in request.files.getlist('file'):
        if not uploaded_file or not uploaded_file.filename:
            continue
        if not allowed_upload(uploaded_file.filename):
            raise ValueError(f'허용되지 않는 첨부파일 형식입니다: {Path(uploaded_file.filename).suffix}')
        original_name = Path(uploaded_file.filename).name[:255]
        extension = original_name.rsplit('.', 1)[1].lower()
        stored_name = f'{uuid.uuid4().hex}.{extension}'
        destination = UPLOAD_FOLDER / stored_name
        uploaded_file.save(destination)
        saved_paths.append(destination)
        cursor.execute(
            "INSERT INTO meeting_files (meeting_id, file_name, file_path) VALUES (%s, %s, %s)",
            (meeting_id, original_name, stored_name),
        )
    return saved_paths


@app.errorhandler(413)
def upload_too_large(_error):
    return jsonify({'success': False, 'message': '첨부파일 전체 크기가 제한을 초과했습니다.'}), 413


@app.route('/')
def dashboard():
    if not PUBLIC_DASHBOARD and 'user_id' not in session:
        return redirect(url_for('login_page', next=request.path))
    return render_template('1_wbs_dashboard.html', **page_context())


@app.route('/login')
def login_page():
    if 'user_id' in session and not session.get('is_first_login'):
        return redirect(url_for('dashboard'))
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login_page'))


@app.route('/api/session', methods=['GET'])
def api_session():
    if 'user_id' not in session:
        return jsonify({'authenticated': False})
    return jsonify({
        'authenticated': True,
        'user_id': session.get('user_id'),
        'user_name': session.get('user_name'),
        'is_admin': bool(session.get('is_admin')),
        'is_first_login': bool(session.get('is_first_login')),
        'screen_permissions': session.get('screen_permissions') or {},
    })


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get('id') or '').strip()
    password = str(data.get('password') or '')
    if not user_id or not password:
        return jsonify({'success': False, 'message': '아이디와 비밀번호를 입력해주세요.'}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, password, name, screen_permissions, is_first_login, is_admin
                FROM users WHERE id = %s
                """,
                (user_id,),
            )
            user = cursor.fetchone()
            if not user or not verify_stored_password(user['password'], password):
                return jsonify({'success': False, 'message': '아이디 또는 비밀번호가 일치하지 않습니다.'}), 401

            if not user['password'].startswith(('scrypt:', 'pbkdf2:')):
                cursor.execute(
                    "UPDATE users SET password = %s WHERE id = %s",
                    (generate_password_hash(password), user_id),
                )
                conn.commit()

            session.clear()
            session.permanent = True
            session['user_id'] = user['id']
            session['user_name'] = user['name']
            session['screen_permissions'] = parse_permissions(user['screen_permissions'])
            session['is_first_login'] = bool(user['is_first_login'])
            session['is_admin'] = bool(user['is_admin'])
            return jsonify({'success': True, 'is_first_login': bool(user['is_first_login'])})
    finally:
        conn.close()


@app.route('/api/first-password', methods=['POST'])
@permission_required()
def api_first_password():
    data = request.get_json(silent=True) or {}
    new_password = str(data.get('password') or '')
    if len(new_password) < 8:
        return jsonify({'success': False, 'message': '새 비밀번호는 8자 이상이어야 합니다.'}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password = %s, is_first_login = 0 WHERE id = %s",
                (generate_password_hash(new_password), session['user_id']),
            )
        conn.commit()
        session['is_first_login'] = False
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/forgot-password', methods=['POST'])
def api_forgot_password():
    return jsonify({
        'success': True,
        'message': '등록된 정보와 일치하면 관리자에게 초기화 요청이 전달됩니다. 현재는 시스템 관리자에게 직접 문의해주세요.',
    })


@app.route('/input')
@permission_required('input')
def data_input():
    return render_template('2_wbs_data_input.html', **page_context())


@app.route('/weekly-input')
@permission_required('weekly')
def weekly_input():
    return render_template('3_wbs_weekly_input.html', **page_context())


@app.route('/meetings')
@permission_required('meetings')
def meeting_page():
    return render_template('4_wbs_meetings.html', **page_context())


@app.route('/project-config')
@permission_required('project')
def project_config_page():
    return render_template('5_wbs_project_config.html', **page_context())


@app.route('/users')
@permission_required(admin_only=True)
def users_page():
    return render_template('6_users.html', **page_context())


@app.route('/codes')
@permission_required(admin_only=True)
def codes_page():
    return render_template('7_codes.html', **page_context())


@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    if request.method == 'POST':
        error = api_permission_error('project')
        if error:
            return error

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if request.method == 'POST':
                title = request.form.get('project_title', '석유통합관제센터 구축').strip()[:100]
                target_date = request.form.get('target_date', '2026-11-01')
                start_date = request.form.get('start_date', '2026-08-01')
                end_date = request.form.get('end_date', '2026-12-31')
                cursor.execute(
                    """
                    INSERT INTO project_config (id, project_title, target_date, start_date, end_date)
                    VALUES (1, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        project_title = VALUES(project_title), target_date = VALUES(target_date),
                        start_date = VALUES(start_date), end_date = VALUES(end_date)
                    """,
                    (title, target_date, start_date, end_date),
                )

                logo_file = request.files.get('logo')
                if logo_file and logo_file.filename:
                    if Path(logo_file.filename).suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'}:
                        return jsonify({'success': False, 'message': '로고는 JPG, PNG, WEBP만 사용할 수 있습니다.'}), 400
                    logo_file.save(STATIC_FOLDER / 'left.jpg')

                favicon_file = request.files.get('favicon')
                if favicon_file and favicon_file.filename:
                    if Path(favicon_file.filename).suffix.lower() not in {'.ico', '.png'}:
                        return jsonify({'success': False, 'message': '파비콘은 ICO 또는 PNG만 사용할 수 있습니다.'}), 400
                    favicon_file.save(STATIC_FOLDER / 'favicon.ico')

                conn.commit()
                return jsonify({'success': True})

            cursor.execute("SELECT project_title, target_date, start_date, end_date FROM project_config WHERE id = 1")
            row = cursor.fetchone()
            if not row:
                return jsonify({
                    'project_title': '석유통합관제센터 구축',
                    'target_date': '2026-11-01',
                    'start_date': '2026-08-01',
                    'end_date': '2026-12-31',
                })
            return jsonify({
                'project_title': row['project_title'],
                'target_date': row['target_date'].strftime('%Y-%m-%d') if row['target_date'] else '2026-11-01',
                'start_date': row['start_date'].strftime('%Y-%m-%d') if row['start_date'] else '2026-08-01',
                'end_date': row['end_date'].strftime('%Y-%m-%d') if row['end_date'] else '2026-12-31',
            })
    finally:
        conn.close()


@app.route('/api/users', methods=['GET', 'POST', 'DELETE'])
@permission_required(admin_only=True)
def api_users():
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if request.method == 'GET':
                cursor.execute(
                    """
                    SELECT id, name, affiliation, team_name, job_role, phone, email,
                           start_date, end_date, screen_permissions, is_first_login, is_admin
                    FROM users ORDER BY is_admin DESC, name ASC, id ASC
                    """
                )
                rows = cursor.fetchall()
                for row in rows:
                    if row['start_date']:
                        row['start_date'] = row['start_date'].strftime('%Y-%m-%d')
                    if row['end_date']:
                        row['end_date'] = row['end_date'].strftime('%Y-%m-%d')
                    row['is_first_login'] = bool(row['is_first_login'])
                    row['is_admin'] = bool(row['is_admin'])
                return jsonify(rows)

            data = request.get_json(silent=True) or {}
            user_id = str(data.get('id') or '').strip()
            if request.method == 'DELETE':
                if not user_id:
                    return jsonify({'success': False, 'message': '삭제할 사용자 아이디가 필요합니다.'}), 400
                if user_id == session.get('user_id'):
                    return jsonify({'success': False, 'message': '현재 로그인한 계정은 삭제할 수 없습니다.'}), 400
                cursor.execute("SELECT is_admin FROM users WHERE id = %s", (user_id,))
                target = cursor.fetchone()
                if target and target['is_admin']:
                    cursor.execute("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1")
                    if cursor.fetchone()['count'] <= 1:
                        return jsonify({'success': False, 'message': '마지막 관리자 계정은 삭제할 수 없습니다.'}), 400
                cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
                conn.commit()
                return jsonify({'success': True})

            name = str(data.get('name') or '').strip()
            if not 3 <= len(user_id) <= 50 or not name:
                return jsonify({'success': False, 'message': '아이디(3~50자)와 이름은 필수입니다.'}), 400
            permissions = normalize_permissions(data.get('screen_permissions'))
            cursor.execute("SELECT id FROM users WHERE id = %s", (user_id,))
            exists = cursor.fetchone() is not None
            values = (
                name[:50], str(data.get('affiliation') or '').strip()[:100],
                str(data.get('team_name') or '').strip()[:50], str(data.get('job_role') or '').strip()[:50],
                str(data.get('phone') or '').strip()[:30], str(data.get('email') or '').strip()[:100],
                data.get('start_date') or None, data.get('end_date') or None, permissions, user_id,
            )
            if exists:
                cursor.execute(
                    """
                    UPDATE users SET name=%s, affiliation=%s, team_name=%s, job_role=%s,
                        phone=%s, email=%s, start_date=%s, end_date=%s, screen_permissions=%s
                    WHERE id=%s
                    """,
                    values,
                )
                temporary_password = None
            else:
                temporary_password = secrets.token_urlsafe(9)
                cursor.execute(
                    """
                    INSERT INTO users (
                        name, affiliation, team_name, job_role, phone, email, start_date, end_date,
                        screen_permissions, id, password, is_first_login, is_admin
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, 0)
                    """,
                    values + (generate_password_hash(temporary_password),),
                )
            conn.commit()
            response = {'success': True, 'created': not exists}
            if temporary_password:
                response['temporary_password'] = temporary_password
            return jsonify(response)
    except pymysql.err.IntegrityError:
        conn.rollback()
        return jsonify({'success': False, 'message': '이미 사용 중인 아이디이거나 중복된 값입니다.'}), 409
    finally:
        conn.close()


@app.route('/api/users/<user_id>/reset-password', methods=['POST'])
@permission_required(admin_only=True)
def reset_user_password(user_id):
    temporary_password = secrets.token_urlsafe(9)
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password = %s, is_first_login = 1 WHERE id = %s",
                (generate_password_hash(temporary_password), user_id),
            )
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404
        conn.commit()
        return jsonify({'success': True, 'temporary_password': temporary_password})
    finally:
        conn.close()


@app.route('/api/users/import', methods=['POST'])
@permission_required(admin_only=True)
def api_users_import():
    uploaded_file = request.files.get('file')
    if not uploaded_file or not uploaded_file.filename:
        return jsonify({'success': False, 'message': '엑셀 파일을 선택해주세요.'}), 400
    if Path(uploaded_file.filename).suffix.lower() not in {'.xlsx', '.xls'}:
        return jsonify({'success': False, 'message': 'XLSX 또는 XLS 파일만 사용할 수 있습니다.'}), 400

    try:
        import pandas as pd
        dataframe = pd.read_excel(uploaded_file)
    except Exception:
        logging.exception('회원 엑셀 파일 읽기 실패')
        return jsonify({'success': False, 'message': '엑셀 파일을 읽을 수 없습니다.'}), 400

    if not {'id', 'name'}.issubset(dataframe.columns):
        return jsonify({'success': False, 'message': '엑셀에는 id와 name 열이 필요합니다.'}), 400

    def excel_value(row, column):
        value = row.get(column)
        if pd.isna(value):
            return ''
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value).strip()

    created_passwords = []
    imported_count = 0
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            for _, row in dataframe.iterrows():
                user_id = excel_value(row, 'id')
                name = excel_value(row, 'name')
                if not 3 <= len(user_id) <= 50 or not name:
                    continue
                cursor.execute("SELECT id FROM users WHERE id = %s", (user_id,))
                exists = cursor.fetchone() is not None
                permissions = normalize_permissions(excel_value(row, 'screen_permissions') or '{}')
                start_date = row.get('start_date') if 'start_date' in dataframe.columns and pd.notna(row.get('start_date')) else None
                end_date = row.get('end_date') if 'end_date' in dataframe.columns and pd.notna(row.get('end_date')) else None
                common_values = (
                    name[:50], excel_value(row, 'affiliation')[:100], excel_value(row, 'team_name')[:50],
                    excel_value(row, 'job_role')[:50], excel_value(row, 'phone')[:30], excel_value(row, 'email')[:100],
                    start_date, end_date, permissions, user_id,
                )
                if exists:
                    cursor.execute(
                        """
                        UPDATE users SET name=%s, affiliation=%s, team_name=%s, job_role=%s,
                            phone=%s, email=%s, start_date=%s, end_date=%s, screen_permissions=%s
                        WHERE id=%s
                        """,
                        common_values,
                    )
                else:
                    temporary_password = secrets.token_urlsafe(9)
                    cursor.execute(
                        """
                        INSERT INTO users (
                            name, affiliation, team_name, job_role, phone, email, start_date, end_date,
                            screen_permissions, id, password, is_first_login, is_admin
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, 0)
                        """,
                        common_values + (generate_password_hash(temporary_password),),
                    )
                    created_passwords.append({'id': user_id, 'temporary_password': temporary_password})
                imported_count += 1
        conn.commit()
        return jsonify({
            'success': True,
            'message': f'{imported_count}명의 회원 정보를 반영했습니다.',
            'temporary_passwords': created_passwords,
        })
    except Exception:
        conn.rollback()
        logging.exception('회원 엑셀 반영 실패')
        return jsonify({'success': False, 'message': '회원 정보를 반영하지 못했습니다.'}), 500
    finally:
        conn.close()


@app.route('/api/codes', methods=['GET', 'POST', 'DELETE'])
@permission_required()
def api_codes():
    if request.method != 'GET':
        error = api_permission_error(admin_only=True)
        if error:
            return error
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if request.method == 'GET':
                category = request.args.get('category')
                if category:
                    cursor.execute(
                        "SELECT * FROM common_codes WHERE category_code = %s ORDER BY sort_order ASC, id ASC",
                        (category,),
                    )
                else:
                    cursor.execute("SELECT * FROM common_codes ORDER BY category_code ASC, sort_order ASC, id ASC")
                return jsonify(cursor.fetchall())

            data = request.get_json(silent=True) or {}
            if request.method == 'DELETE':
                code_id = data.get('id')
                if not code_id:
                    return jsonify({'success': False, 'message': '삭제할 코드가 필요합니다.'}), 400
                cursor.execute("DELETE FROM common_codes WHERE id = %s", (code_id,))
                conn.commit()
                return jsonify({'success': True})

            category_code = str(data.get('category_code') or '').strip()[:50]
            code_value = str(data.get('code_value') or '').strip()[:50]
            code_name = str(data.get('code_name') or '').strip()[:100]
            if not category_code or not code_value or not code_name:
                return jsonify({'success': False, 'message': '분류코드, 코드값, 코드명은 필수입니다.'}), 400
            values = (
                category_code, str(data.get('category_code_name') or '').strip()[:100],
                code_value, code_name, int(data.get('sort_order') or 0),
            )
            if data.get('id'):
                cursor.execute(
                    """
                    UPDATE common_codes SET category_code=%s, category_code_name=%s,
                        code_value=%s, code_name=%s, sort_order=%s WHERE id=%s
                    """,
                    values + (data['id'],),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO common_codes (category_code, category_code_name, code_value, code_name, sort_order)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    values,
                )
            conn.commit()
            return jsonify({'success': True})
    except pymysql.err.IntegrityError:
        conn.rollback()
        return jsonify({'success': False, 'message': '같은 분류에 이미 존재하는 코드값입니다.'}), 409
    finally:
        conn.close()


@app.route('/api/wbs', methods=['GET'])
def get_wbs():
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM wbs_progress")
            rows = cursor.fetchall()
            state = {}
            include_delay_details = has_permission('dashboard')
            for row in rows:
                key = f"{row['system_name']}_{row['phase_name']}"
                state[key] = {
                    'weight': float(row['weight']) if row['weight'] is not None else 0.0,
                    'plan': float(row['plan_rate']) if row['plan_rate'] is not None else 0.0,
                    'actual': float(row['actual_rate']) if row['actual_rate'] is not None else 0.0,
                    'start_date': row['start_date'].strftime('%Y-%m-%d') if row['start_date'] else '',
                    'end_date': row['end_date'].strftime('%Y-%m-%d') if row['end_date'] else '',
                    'date': row['input_date'].strftime('%Y-%m-%d') if row['input_date'] else '',
                }
                if include_delay_details:
                    state[key]['delay_reason'] = row.get('delay_reason') or ''
                    state[key]['recovery_plan'] = row.get('recovery_plan') or ''
            return jsonify(state)
    finally:
        conn.close()


@app.route('/api/wbs', methods=['POST'])
@permission_required('input')
def save_wbs():
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({'success': False, 'message': '저장할 WBS 목록이 필요합니다.'}), 400
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            for item in data:
                original_system = item.get('original_system')
                original_phase = item.get('original_phase')
                system_name = str(item.get('system_name') or '').strip()
                phase_name = str(item.get('phase_name') or '').strip()
                if not system_name or not phase_name:
                    raise ValueError('시스템명과 단계명은 필수입니다.')
                if original_system and original_phase and (original_system != system_name or original_phase != phase_name):
                    cursor.execute(
                        "DELETE FROM wbs_progress WHERE system_name = %s AND phase_name = %s",
                        (original_system, original_phase),
                    )
                cursor.execute(
                    """
                    INSERT INTO wbs_progress (
                        system_name, phase_name, weight, plan_rate, actual_rate, start_date, end_date, input_date
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        weight=VALUES(weight), plan_rate=VALUES(plan_rate), actual_rate=VALUES(actual_rate),
                        start_date=VALUES(start_date), end_date=VALUES(end_date), input_date=VALUES(input_date)
                    """,
                    (
                        system_name, phase_name, item.get('weight', 0), item.get('plan'), item.get('actual'),
                        item.get('start_date') or None, item.get('end_date') or None, item.get('date') or None,
                    ),
                )
        conn.commit()
        return jsonify({'success': True})
    except ValueError as exc:
        conn.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception:
        conn.rollback()
        logging.exception('WBS 저장 실패')
        return jsonify({'success': False, 'message': 'WBS를 저장하지 못했습니다.'}), 500
    finally:
        conn.close()


@app.route('/api/wbs', methods=['DELETE'])
@permission_required('input')
def delete_wbs():
    data = request.get_json(silent=True) or {}
    system_name = str(data.get('system_name') or '').strip()
    phase_name = str(data.get('phase_name') or '').strip()
    if not system_name or not phase_name:
        return jsonify({'success': False, 'message': '삭제할 시스템명과 단계명이 필요합니다.'}), 400
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM wbs_progress WHERE system_name = %s AND phase_name = %s",
                (system_name, phase_name),
            )
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'message': '해당 WBS 항목을 찾을 수 없습니다.'}), 404
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/wbs/delay', methods=['POST'])
@permission_required('dashboard')
def save_wbs_delay():
    data = request.get_json(silent=True) or {}
    system_name = str(data.get('system_name') or '').strip()
    phase_name = str(data.get('phase_name') or '').strip()
    if not system_name or not phase_name:
        return jsonify({'success': False, 'message': '시스템명과 단계명이 필요합니다.'}), 400
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE wbs_progress SET delay_reason=%s, recovery_plan=%s
                WHERE system_name=%s AND phase_name=%s
                """,
                (data.get('delay_reason'), data.get('recovery_plan'), system_name, phase_name),
            )
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'message': '해당 WBS 항목을 찾을 수 없습니다.'}), 404
        conn.commit()
        return jsonify({'success': True})
    finally:
        conn.close()


@app.route('/api/weekly', methods=['GET', 'POST'])
def api_weekly():
    if request.method == 'POST':
        error = api_permission_error('weekly')
        if error:
            return error
        data = request.get_json(silent=True)
        if not isinstance(data, list) or not data:
            return jsonify({'status': 'error', 'message': '저장할 주차별 데이터가 없습니다.'}), 400
        conn = get_connection()
        try:
            with conn.cursor() as cursor:
                for item in data:
                    raw_week = item.get('week_no', item.get('week'))
                    week_no = int(''.join(filter(str.isdigit, str(raw_week))))
                    plan_rate = float(item.get('plan_rate', item.get('plan', 0)) or 0)
                    actual_rate = float(item.get('actual_rate', item.get('actual', 0)) or 0)
                    cursor.execute(
                        """
                        INSERT INTO wbs_weekly (week_no, plan_rate, actual_rate) VALUES (%s, %s, %s)
                        ON DUPLICATE KEY UPDATE plan_rate=VALUES(plan_rate), actual_rate=VALUES(actual_rate)
                        """,
                        (week_no, plan_rate, actual_rate),
                    )
            conn.commit()
            return jsonify({'status': 'success', 'message': '성공적으로 저장되었습니다.'})
        except (TypeError, ValueError):
            conn.rollback()
            return jsonify({'status': 'error', 'message': '주차 또는 진척률 값이 올바르지 않습니다.'}), 400
        finally:
            conn.close()

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM wbs_weekly ORDER BY week_no ASC")
            rows = cursor.fetchall()
        return jsonify({
            'labels': [f"{row['week_no']}주차" for row in rows],
            'plan': [float(row['plan_rate'] or 0) for row in rows],
            'actual': [float(row['actual_rate'] or 0) for row in rows],
        })
    finally:
        conn.close()


@app.route('/api/meetings', methods=['GET'])
@permission_required('meetings')
def get_meetings():
    date_str = request.args.get('date')
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            columns = "id, title, meeting_date, meeting_time, location, attendees, agenda, content, summary, others"
            if date_str:
                cursor.execute(
                    f"SELECT {columns} FROM meetings WHERE meeting_date = %s ORDER BY meeting_time ASC, title ASC",
                    (date_str,),
                )
            else:
                cursor.execute(f"SELECT {columns} FROM meetings ORDER BY meeting_date DESC, meeting_time ASC, title ASC")
            rows = cursor.fetchall()
            for row in rows:
                if row['meeting_date']:
                    row['meeting_date'] = row['meeting_date'].strftime('%Y-%m-%d')
                if row['meeting_time']:
                    row['meeting_time'] = str(row['meeting_time'])
                cursor.execute("SELECT id, file_name FROM meeting_files WHERE meeting_id = %s", (row['id'],))
                row['files'] = cursor.fetchall()
            return jsonify(rows)
    finally:
        conn.close()


@app.route('/api/meetings', methods=['POST'])
@permission_required('meetings')
def create_meeting():
    title = str(request.form.get('title') or '').strip()
    password = str(request.form.get('password') or '')
    if not title or not request.form.get('meeting_date') or not request.form.get('meeting_time'):
        return jsonify({'success': False, 'message': '회의명, 날짜, 시간은 필수입니다.'}), 400
    if len(password) < 4:
        return jsonify({'success': False, 'message': '회의 수정·삭제 비밀번호는 4자 이상이어야 합니다.'}), 400

    saved_paths = []
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO meetings (
                    title, meeting_date, meeting_time, location, attendees, agenda, password, content, summary, others
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    title[:150], request.form.get('meeting_date'), request.form.get('meeting_time'),
                    request.form.get('location'), request.form.get('attendees'), request.form.get('agenda'),
                    generate_password_hash(password), request.form.get('content'), request.form.get('summary'),
                    request.form.get('others'),
                ),
            )
            saved_paths = save_meeting_uploads(cursor, cursor.lastrowid)
        conn.commit()
        return jsonify({'success': True})
    except ValueError as exc:
        conn.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception:
        conn.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
        logging.exception('회의 등록 실패')
        return jsonify({'success': False, 'message': '회의를 등록하지 못했습니다.'}), 500
    finally:
        conn.close()


@app.route('/api/meetings/<int:meeting_id>', methods=['PUT'])
@permission_required('meetings')
def update_meeting(meeting_id):
    title = str(request.form.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'message': '회의명은 필수입니다.'}), 400
    saved_paths = []
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT password FROM meetings WHERE id = %s", (meeting_id,))
            existing = cursor.fetchone()
            if not existing:
                return jsonify({'success': False, 'message': '회의를 찾을 수 없습니다.'}), 404
            submitted_password = str(request.form.get('password') or '')
            stored_password = generate_password_hash(submitted_password) if submitted_password else existing['password']
            cursor.execute(
                """
                UPDATE meetings SET title=%s, meeting_date=%s, meeting_time=%s, location=%s,
                    attendees=%s, agenda=%s, password=%s, content=%s, summary=%s, others=%s
                WHERE id=%s
                """,
                (
                    title[:150], request.form.get('meeting_date'), request.form.get('meeting_time'),
                    request.form.get('location'), request.form.get('attendees'), request.form.get('agenda'),
                    stored_password, request.form.get('content'), request.form.get('summary'), request.form.get('others'),
                    meeting_id,
                ),
            )
            saved_paths = save_meeting_uploads(cursor, meeting_id)
        conn.commit()
        return jsonify({'success': True})
    except ValueError as exc:
        conn.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception:
        conn.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
        logging.exception('회의 수정 실패')
        return jsonify({'success': False, 'message': '회의를 수정하지 못했습니다.'}), 500
    finally:
        conn.close()


@app.route('/api/meeting-files/<int:file_id>/download', methods=['GET'])
@permission_required('meetings')
def download_meeting_file_single(file_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT file_name, file_path FROM meeting_files WHERE id = %s", (file_id,))
            row = cursor.fetchone()
        if not row:
            return '파일이 존재하지 않습니다.', 404
        path = stored_file_path(row['file_path'])
        if not path.is_file():
            return '파일이 존재하지 않습니다.', 404
        return send_from_directory(UPLOAD_FOLDER, path.name, as_attachment=True, download_name=row['file_name'])
    finally:
        conn.close()


@app.route('/api/meeting-files/<int:file_id>', methods=['DELETE'])
@permission_required('meetings')
def delete_meeting_file(file_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT file_path FROM meeting_files WHERE id = %s", (file_id,))
            row = cursor.fetchone()
            cursor.execute("DELETE FROM meeting_files WHERE id = %s", (file_id,))
        conn.commit()
        if row:
            stored_file_path(row['file_path']).unlink(missing_ok=True)
        return jsonify({'success': True})
    except Exception:
        conn.rollback()
        logging.exception('회의 첨부파일 삭제 실패')
        return jsonify({'success': False, 'message': '첨부파일을 삭제하지 못했습니다.'}), 500
    finally:
        conn.close()


@app.route('/api/meetings/<int:meeting_id>', methods=['DELETE'])
@permission_required('meetings')
def delete_meeting(meeting_id):
    data = request.get_json(silent=True) or {}
    password = str(data.get('password') or '')
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT password FROM meetings WHERE id = %s", (meeting_id,))
            meeting = cursor.fetchone()
            if not meeting or not verify_stored_password(meeting['password'], password):
                return jsonify({'success': False, 'message': '비밀번호가 일치하지 않습니다.'}), 403
            cursor.execute("SELECT file_path FROM meeting_files WHERE meeting_id = %s", (meeting_id,))
            file_paths = [stored_file_path(row['file_path']) for row in cursor.fetchall()]
            cursor.execute("DELETE FROM meeting_files WHERE meeting_id = %s", (meeting_id,))
            cursor.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))
        conn.commit()
        for path in file_paths:
            path.unlink(missing_ok=True)
        return jsonify({'success': True})
    except Exception:
        conn.rollback()
        logging.exception('회의 삭제 실패')
        return jsonify({'success': False, 'message': '회의를 삭제하지 못했습니다.'}), 500
    finally:
        conn.close()

if __name__ == '__main__':
    debug_enabled = os.getenv('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes', 'on')
    app.run(
        host=os.getenv('APP_HOST', '127.0.0.1'),
        port=int(os.getenv('APP_PORT', '3000')),
        debug=debug_enabled
    )
