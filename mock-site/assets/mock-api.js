(function () {
    'use strict';

    var STORAGE_PREFIX = 'wbs_stage1_mock_v1_';

    var DEFAULT_CONFIG = {
        project_title: '통합관제 프로젝트 (화면 목업)',
        target_date: '2026-11-01',
        start_date: '2026-08-01',
        end_date: '2026-12-31'
    };

    var DEFAULT_WBS = {
        '1. 통합업무시스템_1. 공통': { weight: 10, plan: 35, actual: 35, start_date: '2026-08-03', end_date: '2026-08-28', date: '2026-08-21' },
        '1. 통합업무시스템_2. 요구분석': { weight: 15, plan: 30, actual: 28, start_date: '2026-08-17', end_date: '2026-09-18', date: '2026-08-21' },
        '1. 통합업무시스템_3. 설계': { weight: 20, plan: 12, actual: 10, start_date: '2026-09-07', end_date: '2026-10-09', date: '2026-08-21' },
        '1. 통합업무시스템_4. 구현': { weight: 35, plan: 5, actual: 4, start_date: '2026-09-28', end_date: '2026-11-27', date: '2026-08-21' },
        '1. 통합업무시스템_5. 테스트': { weight: 10, plan: 0, actual: 0, start_date: '2026-11-02', end_date: '2026-12-18', date: '2026-08-21' },
        '1. 통합업무시스템_6. 이행': { weight: 10, plan: 0, actual: 0, start_date: '2026-11-23', end_date: '2026-12-23', date: '2026-08-21' },
        '2. AI 상담시스템_1. 요구분석': { weight: 20, plan: 25, actual: 25, start_date: '2026-08-17', end_date: '2026-09-18', date: '2026-08-21' },
        '2. AI 상담시스템_2. 설계': { weight: 20, plan: 10, actual: 8, start_date: '2026-09-14', end_date: '2026-10-16', date: '2026-08-21' },
        '2. AI 상담시스템_3. 구현': { weight: 40, plan: 0, actual: 0, start_date: '2026-10-05', end_date: '2026-12-04', date: '2026-08-21' },
        '2. AI 상담시스템_4. 테스트': { weight: 10, plan: 0, actual: 0, start_date: '2026-11-09', end_date: '2026-12-18', date: '2026-08-21' },
        '2. AI 상담시스템_5. 이행': { weight: 10, plan: 0, actual: 0, start_date: '2026-11-30', end_date: '2026-12-23', date: '2026-08-21' },
        '3. 통합상황실_1. 요구정의분석': { weight: 20, plan: 28, actual: 28, start_date: '2026-08-17', end_date: '2026-09-18', date: '2026-08-21' },
        '3. 통합상황실_2. 상황판 설계 및 심의': { weight: 20, plan: 8, actual: 7, start_date: '2026-09-14', end_date: '2026-10-16', date: '2026-08-21' },
        '3. 통합상황실_3. 상황판 설치 및 시험': { weight: 30, plan: 0, actual: 0, start_date: '2026-10-05', end_date: '2026-11-27', date: '2026-08-21' },
        '3. 통합상황실_4. 시스템 장비설치': { weight: 20, plan: 0, actual: 0, start_date: '2026-11-02', end_date: '2026-12-11', date: '2026-08-21' },
        '3. 통합상황실_5. 오픈': { weight: 10, plan: 0, actual: 0, start_date: '2026-12-01', end_date: '2026-12-23', date: '2026-08-21' },
        '4. 사업관리_1. 사업관리 전반': { weight: 100, plan: 18, actual: 17, start_date: '2026-08-03', end_date: '2026-12-31', date: '2026-08-21' }
    };

    var DEFAULT_WEEKLY = {
        plan: [5, 9, 14, 18, 23, 28, 34, 40, 47, 54, 61, 68, 74, 80, 85, 89, 93, 96, 98, 100, 100],
        actual: [5, 9, 13, 17, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
    };

    var DEFAULT_MEETINGS = [
        {
            id: 1,
            title: '주간 진척회의 (샘플)',
            meeting_date: '2026-08-21',
            meeting_time: '10:00:00',
            location: '대회의실',
            attendees: '김담당, 이책임, 박매니저',
            agenda: '시스템별 주간 진척 및 주요 이슈 점검',
            password: '1234',
            content: '단계별 진행 현황을 공유하고 지연 항목의 조치계획을 논의합니다.',
            summary: '요구분석 일정과 외부 연계 일정을 우선 점검하기로 했습니다.',
            others: '이 화면의 데이터는 모두 목업용 샘플입니다.',
            files: [{ id: 1, file_name: '주간진척현황_샘플.txt' }]
        },
        {
            id: 2,
            title: '상황판 디자인 검토 (샘플)',
            meeting_date: '2026-08-20',
            meeting_time: '14:00:00',
            location: '온라인',
            attendees: '디자인 담당자, 상황실 담당자',
            agenda: '상황판 정보구조 및 색상 검토',
            password: '1234',
            content: 'TV 해상도별 가독성과 주요 지표 배치를 검토합니다.',
            summary: '실제 TV에서 1920x1080 및 1280x720 테스트가 필요합니다.',
            others: '',
            files: []
        }
    ];

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function load(name, fallback) {
        try {
            var raw = window.localStorage.getItem(STORAGE_PREFIX + name);
            return raw ? JSON.parse(raw) : clone(fallback);
        } catch (error) {
            return clone(fallback);
        }
    }

    function save(name, value) {
        window.localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
    }

    function MockResponse(data, status) {
        this._data = data;
        this.status = status || 200;
        this.ok = this.status >= 200 && this.status < 300;
    }

    MockResponse.prototype.json = function () {
        return Promise.resolve(clone(this._data));
    };

    MockResponse.prototype.text = function () {
        return Promise.resolve(typeof this._data === 'string' ? this._data : JSON.stringify(this._data));
    };

    function response(data, status) {
        return Promise.resolve(new MockResponse(data, status));
    }

    function getFormValue(body, key) {
        if (!body || typeof body.get !== 'function') return '';
        var value = body.get(key);
        return value === null || typeof value === 'undefined' ? '' : value;
    }

    function getJsonBody(options) {
        if (!options || !options.body) return null;
        if (typeof options.body === 'string') {
            try { return JSON.parse(options.body); } catch (error) { return null; }
        }
        return options.body;
    }

    function getPath(input) {
        var raw = typeof input === 'string' ? input : input.url;
        var parser = document.createElement('a');
        parser.href = raw;
        return { pathname: parser.pathname, search: parser.search };
    }

    function meetingFromForm(body, existing) {
        var meeting = existing || {};
        var fields = ['title', 'meeting_date', 'meeting_time', 'location', 'attendees', 'agenda', 'password', 'content', 'summary', 'others'];
        fields.forEach(function (field) {
            meeting[field] = String(getFormValue(body, field) || '');
        });
        if (meeting.meeting_time && meeting.meeting_time.length === 5) meeting.meeting_time += ':00';
        if (!meeting.files) meeting.files = [];

        if (body && typeof body.getAll === 'function') {
            body.getAll('file').forEach(function (file) {
                if (file && file.name) {
                    var nextFileId = Date.now() + Math.floor(Math.random() * 1000);
                    meeting.files.push({ id: nextFileId, file_name: file.name });
                }
            });
        }
        return meeting;
    }

    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

    window.fetch = function (input, options) {
        var target = getPath(input);
        var path = target.pathname;
        var method = String((options && options.method) || 'GET').toUpperCase();

        if (path.indexOf('/api/') !== 0) {
            if (nativeFetch) return nativeFetch(input, options);
            return response({ error: '지원하지 않는 요청입니다.' }, 404);
        }

        if (path === '/api/config') {
            if (method === 'GET') return response(load('config', DEFAULT_CONFIG));
            var config = load('config', DEFAULT_CONFIG);
            config.project_title = String(getFormValue(options.body, 'project_title') || config.project_title);
            config.target_date = String(getFormValue(options.body, 'target_date') || config.target_date);
            config.start_date = String(getFormValue(options.body, 'start_date') || config.start_date);
            config.end_date = String(getFormValue(options.body, 'end_date') || config.end_date);
            save('config', config);
            return response({ success: true, mock: true });
        }

        if (path === '/api/wbs') {
            if (method === 'GET') return response(load('wbs', DEFAULT_WBS));
            var wbs = load('wbs', DEFAULT_WBS);
            var wbsPayload = getJsonBody(options);
            if (method === 'DELETE' && wbsPayload) {
                delete wbs[wbsPayload.system_name + '_' + wbsPayload.phase_name];
                save('wbs', wbs);
                return response({ success: true, mock: true });
            }
            if (Array.isArray(wbsPayload)) {
                wbsPayload.forEach(function (item) {
                    var oldKey = item.original_system && item.original_phase ? item.original_system + '_' + item.original_phase : '';
                    var newKey = item.system_name + '_' + item.phase_name;
                    if (oldKey && oldKey !== newKey) delete wbs[oldKey];
                    wbs[newKey] = {
                        weight: Number(item.weight) || 0,
                        plan: Number(item.plan) || 0,
                        actual: Number(item.actual) || 0,
                        start_date: item.start_date || '',
                        end_date: item.end_date || '',
                        date: item.date || ''
                    };
                });
                save('wbs', wbs);
            }
            return response({ success: true, mock: true });
        }

        if (path === '/api/weekly') {
            var weekly = load('weekly', DEFAULT_WEEKLY);
            if (method === 'GET') {
                return response({
                    labels: weekly.plan.map(function (_, index) { return (index + 1) + '주차'; }),
                    plan: weekly.plan,
                    actual: weekly.actual
                });
            }
            var weeklyPayload = getJsonBody(options) || [];
            weeklyPayload.forEach(function (item) {
                var index = Number(item.week_no) - 1;
                if (index < 0) return;
                weekly.plan[index] = item.plan_rate === null ? null : Number(item.plan_rate);
                weekly.actual[index] = item.actual_rate === null ? null : Number(item.actual_rate);
            });
            save('weekly', weekly);
            return response({ status: 'success', message: '목업 데이터가 이 브라우저에 저장되었습니다.' });
        }

        if (path === '/api/meetings' && method === 'GET') {
            var meetings = load('meetings', DEFAULT_MEETINGS);
            var dateMatch = target.search.match(/[?&]date=([^&]+)/);
            if (dateMatch) {
                var selectedDate = decodeURIComponent(dateMatch[1]);
                meetings = meetings.filter(function (item) { return item.meeting_date === selectedDate; });
            }
            meetings.sort(function (a, b) {
                return (b.meeting_date + b.meeting_time).localeCompare(a.meeting_date + a.meeting_time);
            });
            return response(meetings);
        }

        if (path === '/api/meetings' && method === 'POST') {
            var meetingList = load('meetings', DEFAULT_MEETINGS);
            var created = meetingFromForm(options.body, {});
            created.id = meetingList.reduce(function (max, item) { return Math.max(max, item.id); }, 0) + 1;
            meetingList.push(created);
            save('meetings', meetingList);
            return response({ success: true, mock: true });
        }

        var meetingMatch = path.match(/^\/api\/meetings\/(\d+)$/);
        if (meetingMatch) {
            var meetingId = Number(meetingMatch[1]);
            var storedMeetings = load('meetings', DEFAULT_MEETINGS);
            var meetingIndex = storedMeetings.findIndex(function (item) { return item.id === meetingId; });
            if (meetingIndex < 0) return response({ success: false, message: '회의를 찾을 수 없습니다.' }, 404);
            if (method === 'PUT') {
                storedMeetings[meetingIndex] = meetingFromForm(options.body, storedMeetings[meetingIndex]);
                save('meetings', storedMeetings);
                return response({ success: true, mock: true });
            }
            if (method === 'DELETE') {
                var deleteBody = getJsonBody(options) || {};
                if (storedMeetings[meetingIndex].password !== deleteBody.password) {
                    return response({ success: false, message: '비밀번호가 일치하지 않습니다. 샘플 비밀번호는 1234입니다.' }, 403);
                }
                storedMeetings.splice(meetingIndex, 1);
                save('meetings', storedMeetings);
                return response({ success: true, mock: true });
            }
        }

        var fileMatch = path.match(/^\/api\/meeting-files\/(\d+)$/);
        if (fileMatch && method === 'DELETE') {
            var fileId = Number(fileMatch[1]);
            var meetingsWithFiles = load('meetings', DEFAULT_MEETINGS);
            meetingsWithFiles.forEach(function (meetingItem) {
                meetingItem.files = (meetingItem.files || []).filter(function (file) { return file.id !== fileId; });
            });
            save('meetings', meetingsWithFiles);
            return response({ success: true, mock: true });
        }

        return response({ error: '목업에서 지원하지 않는 API입니다.' }, 404);
    };

    window.downloadMockFile = function (fileId, fileName) {
        var content = '화면 검토용 목업 첨부파일입니다.\n파일 ID: ' + fileId + '\n실제 파일 저장 기능은 2단계에서 구현합니다.';
        var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName || 'mock-file.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    };

    window.resetWbsMock = function () {
        if (!window.confirm('이 브라우저에 저장된 목업 입력 내용을 초기화하시겠습니까?')) return;
        Object.keys(window.localStorage).forEach(function (key) {
            if (key.indexOf(STORAGE_PREFIX) === 0) window.localStorage.removeItem(key);
        });
        window.location.reload();
    };

    document.addEventListener('DOMContentLoaded', function () {
        var badge = document.createElement('div');
        badge.className = 'wbs-mock-badge';
        badge.innerHTML = '<strong>1단계 화면 목업</strong><span>입력은 이 브라우저에만 임시 저장</span><button type="button" onclick="resetWbsMock()">초기화</button>';
        document.body.appendChild(badge);

        var style = document.createElement('style');
        style.textContent = '.wbs-mock-badge{position:fixed;right:14px;top:10px;z-index:99999;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #d9b44a;border-radius:7px;background:rgba(20,20,20,.94);color:#fff;font:11px/1.2 Malgun Gothic,sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.45)}.wbs-mock-badge strong{color:#f1d16f}.wbs-mock-badge span{color:#bbb}.wbs-mock-badge button{border:1px solid #666;border-radius:4px;background:#333;color:#ddd;padding:3px 7px;cursor:pointer}@media print{.wbs-mock-badge{display:none!important}}';
        document.head.appendChild(style);
    });
})();
