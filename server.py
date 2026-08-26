from flask import Flask, jsonify, request, render_template, send_from_directory
from flask_cors import CORS
import pymysql
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import time

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / '.env')

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / 'templates'),
    static_folder=str(BASE_DIR / 'static')
)
CORS(app)

UPLOAD_FOLDER = BASE_DIR / os.getenv('UPLOAD_FOLDER', 'uploads')
STATIC_FOLDER = BASE_DIR / 'static'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_UPLOAD_MB', '20')) * 1024 * 1024

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

def get_connection():
    return pymysql.connect(
        host=DB_CONFIG['host'], port=DB_CONFIG['port'], user=DB_CONFIG['user'],
        password=DB_CONFIG['password'], database=DB_NAME, charset=DB_CONFIG['charset'],
        cursorclass=DB_CONFIG['cursorclass']
    )

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

            # 컬럼이 없을 경우 안전하게 추가
            try:
                cursor.execute("ALTER TABLE project_config ADD COLUMN start_date DATE")
            except:
                pass
            try:
                cursor.execute("ALTER TABLE project_config ADD COLUMN end_date DATE")
            except:
                pass

            cursor.execute("SELECT COUNT(*) as cnt FROM project_config")
            if cursor.fetchone()['cnt'] == 0:
                cursor.execute("""
                    INSERT INTO project_config (id, project_title, target_date, start_date, end_date)
                    VALUES (1, '석유통합관제센터 구축', '2026-11-01', '2026-08-01', '2026-12-31')
                """)

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

            try:
                cursor.execute("ALTER TABLE wbs_progress ADD COLUMN start_date DATE")
            except:
                pass
            try:
                cursor.execute("ALTER TABLE wbs_progress ADD COLUMN end_date DATE")
            except:
                pass

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
                    password VARCHAR(100) NOT NULL,
                    content TEXT,
                    summary TEXT,
                    others TEXT
                )
            """)
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

init_db()

@app.route('/')
def dashboard(): return render_template('1_wbs_dashboard.html')

@app.route('/input')
def data_input(): return render_template('2_wbs_data_input.html')

@app.route('/weekly-input')
def weekly_input(): return render_template('3_wbs_weekly_input.html')

@app.route('/meetings')
def meeting_page(): return render_template('4_wbs_meetings.html')

@app.route('/project-config')
def project_config_page(): return render_template('5_wbs_project_config.html')

@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if request.method == 'POST':
                title = request.form.get('project_title', '석유통합관제센터 구축')
                t_date = request.form.get('target_date', '2026-11-01')
                s_date = request.form.get('start_date', '2026-08-01')
                e_date = request.form.get('end_date', '2026-12-31')

                cursor.execute("""
                    INSERT INTO project_config (id, project_title, target_date, start_date, end_date)
                    VALUES (1, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        project_title = VALUES(project_title),
                        target_date = VALUES(target_date),
                        start_date = VALUES(start_date),
                        end_date = VALUES(end_date)
                """, (title, t_date, s_date, e_date))

                if 'logo' in request.files:
                    logo_file = request.files['logo']
                    if logo_file and logo_file.filename != '':
                        logo_file.save(os.path.join(STATIC_FOLDER, 'left.jpg'))

                if 'favicon' in request.files:
                    fav_file = request.files['favicon']
                    if fav_file and fav_file.filename != '':
                        fav_file.save(os.path.join(STATIC_FOLDER, 'favicon.ico'))

                conn.commit()
                return jsonify({"success": True})
            else:
                cursor.execute("SELECT * FROM project_config WHERE id = 1")
                row = cursor.fetchone()
                if row:
                    return jsonify({
                        "project_title": row['project_title'],
                        "target_date": row['target_date'].strftime('%Y-%m-%d') if row['target_date'] else '2026-11-01',
                        "start_date": row['start_date'].strftime('%Y-%m-%d') if row['start_date'] else '2026-08-01',
                        "end_date": row['end_date'].strftime('%Y-%m-%d') if row['end_date'] else '2026-12-31'
                    })
                else:
                    return jsonify({
                        "project_title": "석유통합관제센터 구축",
                        "target_date": "2026-11-01",
                        "start_date": "2026-08-01",
                        "end_date": "2026-12-31"
                    })
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
            for row in rows:
                key = f"{row['system_name']}_{row['phase_name']}"
                state[key] = {
                    "weight": float(row['weight']) if row['weight'] is not None else 0.0,
                    "plan": float(row['plan_rate']) if row['plan_rate'] is not None else 0.0,
                    "actual": float(row['actual_rate']) if row['actual_rate'] is not None else 0.0,
                    "start_date": row['start_date'].strftime('%Y-%m-%d') if row['start_date'] else "",
                    "end_date": row['end_date'].strftime('%Y-%m-%d') if row['end_date'] else "",
                    "date": row['input_date'].strftime('%Y-%m-%d') if row['input_date'] else ""
                }
            return jsonify(state)
    finally:
        conn.close()

@app.route('/api/wbs', methods=['POST'])
def save_wbs():
    data = request.json
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if isinstance(data, list):
                for item in data:
                    orig_sys = item.get('original_system')
                    orig_phase = item.get('original_phase')
                    sys = item.get('system_name')
                    phase = item.get('phase_name')

                    if orig_sys and orig_phase and (orig_sys != sys or orig_phase != phase):
                        cursor.execute(
                            "DELETE FROM wbs_progress WHERE system_name = %s AND phase_name = %s",
                            (orig_sys, orig_phase)
                        )

                    sql = """
                        INSERT INTO wbs_progress (system_name, phase_name, weight, plan_rate, actual_rate, start_date, end_date, input_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                        weight = VALUES(weight), plan_rate = VALUES(plan_rate),
                        actual_rate = VALUES(actual_rate), start_date = VALUES(start_date),
                        end_date = VALUES(end_date), input_date = VALUES(input_date)
                    """
                    cursor.execute(sql, (
                        sys, phase,
                        item.get('weight', 0.0),
                        item.get('plan'),
                        item.get('actual'),
                        item.get('start_date') or None,
                        item.get('end_date') or None,
                        item.get('date') or None
                    ))
            conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/weekly', methods=['GET', 'POST'])
def api_weekly():
    if request.method == 'POST':
        conn = None
        try:
            data = request.get_json()
            if not data:
                return jsonify({"status": "error", "message": "저장할 데이터가 없습니다."}), 400

            conn = get_connection()
            with conn.cursor() as cursor:
                for item in data:
                    week_raw = item.get('week_no') if item.get('week_no') is not None else item.get('week')
                    plan_rate = item.get('plan_rate') if item.get('plan_rate') is not None else item.get('plan', 0)
                    actual_rate = item.get('actual_rate') if item.get('actual_rate') is not None else item.get('actual', 0)

                    if isinstance(week_raw, str):
                        week_no = int(''.join(filter(str.isdigit, week_raw)))
                    else:
                        week_no = int(week_raw)

                    plan_rate = float(plan_rate) if plan_rate != "" and plan_rate is not None else 0.0
                    actual_rate = float(actual_rate) if actual_rate != "" and actual_rate is not None else 0.0

                    sql = """
                        INSERT INTO wbs_weekly (week_no, plan_rate, actual_rate)
                        VALUES (%s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            plan_rate = VALUES(plan_rate),
                            actual_rate = VALUES(actual_rate)
                    """
                    cursor.execute(sql, (week_no, plan_rate, actual_rate))

            conn.commit()
            return jsonify({"status": "success", "message": "성공적으로 저장되었습니다."})
        except Exception as e:
            if conn:
                conn.rollback()
            return jsonify({"status": "error", "message": str(e)}), 500
        finally:
            if conn:
                conn.close()
    else:
        try:
            conn = get_connection()
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT * FROM wbs_weekly ORDER BY week_no ASC")
                    rows = cursor.fetchall()
            finally:
                conn.close()

            labels = [f"{row['week_no']}주차" for row in rows]
            plan = [float(row['plan_rate']) if row['plan_rate'] is not None else 0.0 for row in rows]
            actual = [float(row['actual_rate']) if row['actual_rate'] is not None else 0.0 for row in rows]

            return jsonify({
                "labels": labels,
                "plan": plan,
                "actual": actual
            })
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/meetings', methods=['GET'])
def get_meetings():
    date_str = request.args.get('date')
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if date_str:
                cursor.execute("SELECT * FROM meetings WHERE meeting_date = %s ORDER BY meeting_time ASC, title ASC", (date_str,))
            else:
                cursor.execute("SELECT * FROM meetings ORDER BY meeting_date DESC, meeting_time ASC, title ASC")
            rows = cursor.fetchall()
            for r in rows:
                if r['meeting_date']:
                    r['meeting_date'] = r['meeting_date'].strftime('%Y-%m-%d')
                if r['meeting_time']:
                    r['meeting_time'] = str(r['meeting_time'])
                cursor.execute("SELECT id, file_name FROM meeting_files WHERE meeting_id = %s", (r['id'],))
                r['files'] = cursor.fetchall()
            return jsonify(rows)
    finally:
        conn.close()

@app.route('/api/meetings', methods=['POST'])
def create_meeting():
    title = request.form.get('title')
    meeting_date = request.form.get('meeting_date')
    meeting_time = request.form.get('meeting_time')
    location = request.form.get('location')
    attendees = request.form.get('attendees')
    agenda = request.form.get('agenda')
    password = request.form.get('password')
    content = request.form.get('content')
    summary = request.form.get('summary')
    others = request.form.get('others')

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            sql = """
                INSERT INTO meetings (title, meeting_date, meeting_time, location, attendees, agenda, password, content, summary, others)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                title, meeting_date, meeting_time, location, attendees, agenda, password, content, summary, others
            ))
            meeting_id = cursor.lastrowid

            if 'file' in request.files:
                files = request.files.getlist('file')
                for file in files:
                    if file and file.filename != '':
                        file_name = secure_filename(file.filename)
                        timestamp = str(int(time.time())) + "_" + str(os.urandom(2).hex())
                        saved_name = f"{timestamp}_{file_name}"
                        file_path = os.path.join(UPLOAD_FOLDER, saved_name)
                        file.save(file_path)
                        cursor.execute(
                            "INSERT INTO meeting_files (meeting_id, file_name, file_path) VALUES (%s, %s, %s)",
                            (meeting_id, file_name, file_path)
                        )
            conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/meetings/<int:meeting_id>', methods=['PUT'])
def update_meeting(meeting_id):
    title = request.form.get('title')
    meeting_date = request.form.get('meeting_date')
    meeting_time = request.form.get('meeting_time')
    location = request.form.get('location')
    attendees = request.form.get('attendees')
    agenda = request.form.get('agenda')
    password = request.form.get('password')
    content = request.form.get('content')
    summary = request.form.get('summary')
    others = request.form.get('others')

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            sql = """
                UPDATE meetings SET
                    title = %s, meeting_date = %s, meeting_time = %s, location = %s,
                    attendees = %s, agenda = %s, password = %s, content = %s, summary = %s, others = %s
                WHERE id = %s
            """
            cursor.execute(sql, (
                title, meeting_date, meeting_time, location, attendees, agenda, password, content, summary, others, meeting_id
            ))

            if 'file' in request.files:
                files = request.files.getlist('file')
                for file in files:
                    if file and file.filename != '':
                        file_name = secure_filename(file.filename)
                        timestamp = str(int(time.time())) + "_" + str(os.urandom(2).hex())
                        saved_name = f"{timestamp}_{file_name}"
                        file_path = os.path.join(UPLOAD_FOLDER, saved_name)
                        file.save(file_path)
                        cursor.execute(
                            "INSERT INTO meeting_files (meeting_id, file_name, file_path) VALUES (%s, %s, %s)",
                            (meeting_id, file_name, file_path)
                        )
            conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/meeting-files/<int:file_id>/download', methods=['GET'])
def download_meeting_file_single(file_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT file_name, file_path FROM meeting_files WHERE id = %s", (file_id,))
            row = cursor.fetchone()
            if row and row['file_path'] and os.path.exists(row['file_path']):
                directory = os.path.dirname(row['file_path'])
                filename = os.path.basename(row['file_path'])
                return send_from_directory(directory, filename, as_attachment=True, download_name=row['file_name'])
            else:
                return "파일이 존재하지 않습니다.", 404
    finally:
        conn.close()

@app.route('/api/meeting-files/<int:file_id>', methods=['DELETE'])
def delete_meeting_file(file_id):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT file_path FROM meeting_files WHERE id = %s", (file_id,))
            row = cursor.fetchone()
            if row and row['file_path'] and os.path.exists(row['file_path']):
                try:
                    os.remove(row['file_path'])
                except:
                    pass
            cursor.execute("DELETE FROM meeting_files WHERE id = %s", (file_id,))
            conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/meetings/<int:meeting_id>', methods=['DELETE'])
def delete_meeting(meeting_id):
    password = request.json.get('password')
    conn = get_keyword_conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT password FROM meetings WHERE id = %s", (meeting_id,))
            row = cursor.fetchone()
            if not row or row['password'] != password:
                return jsonify({"success": False, "message": "비밀번호가 일치하지 않습니다."}), 403

            cursor.execute("SELECT file_path FROM meeting_files WHERE meeting_id = %s", (meeting_id,))
            files = cursor.fetchall()
            for f in files:
                if f['file_path'] and os.path.exists(f['file_path']):
                    try:
                        os.remove(f['file_path'])
                    except:
                        pass

            cursor.execute("DELETE FROM meeting_files WHERE meeting_id = %s", (meeting_id,))
            cursor.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))
            conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

if __name__ == '__main__':
    debug_enabled = os.getenv('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes', 'on')
    app.run(
        host=os.getenv('APP_HOST', '127.0.0.1'),
        port=int(os.getenv('APP_PORT', '3000')),
        debug=debug_enabled
    )
