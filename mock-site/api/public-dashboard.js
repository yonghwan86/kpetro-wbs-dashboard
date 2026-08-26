import { sql } from './_lib/sql.js';
import { projectWeekCount } from './_lib/dates.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { success: false, message: 'GET 요청만 허용됩니다.' });
  }

  try {
    const rows = await sql`
      SELECT
        COALESCE((
          SELECT jsonb_build_object(
            'project_title', COALESCE(project_title, ''),
            'target_date', COALESCE(to_char(target_date, 'YYYY-MM-DD'), ''),
            'start_date', COALESCE(to_char(start_date, 'YYYY-MM-DD'), ''),
            'end_date', COALESCE(to_char(end_date, 'YYYY-MM-DD'), ''),
            'has_custom_logo', NULLIF(logo_url, '') IS NOT NULL
          )
          FROM project_config WHERE id = 1
        ), '{}'::jsonb) AS project,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'system_name', system_name,
            'phase_name', phase_name,
            'weight', weight,
            'plan', plan_rate,
            'actual', actual_rate,
            'start_date', COALESCE(to_char(start_date, 'YYYY-MM-DD'), ''),
            'end_date', COALESCE(to_char(end_date, 'YYYY-MM-DD'), ''),
            'date', COALESCE(to_char(input_date, 'YYYY-MM-DD'), '')
          ) ORDER BY system_name, phase_name)
          FROM wbs_progress
        ), '[]'::jsonb) AS wbs,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'week_no', week_no,
            'plan', plan_rate,
            'actual', actual_rate
          ) ORDER BY week_no)
          FROM wbs_weekly
        ), '[]'::jsonb) AS weekly
    `;

    const snapshot = rows[0] || { project: {}, wbs: [], weekly: [] };
    const totalWeeks = projectWeekCount(snapshot.project.start_date, snapshot.project.end_date);
    const weeklyRows = totalWeeks
      ? snapshot.weekly.filter(item => Number(item.week_no) <= totalWeeks)
      : snapshot.weekly;
    const wbs = {};

    snapshot.wbs.forEach(item => {
      wbs[`${item.system_name}_${item.phase_name}`] = {
        weight: Number(item.weight || 0),
        plan: Number(item.plan || 0),
        actual: Number(item.actual || 0),
        start_date: item.start_date || '',
        end_date: item.end_date || '',
        date: item.date || '',
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400');
    return sendJson(res, 200, {
      config: snapshot.project,
      weekly: {
        labels: weeklyRows.map(item => `${item.week_no}주차`),
        plan: weeklyRows.map(item => Number(item.plan || 0)),
        actual: weeklyRows.map(item => item.actual === null ? null : Number(item.actual)),
      },
      wbs,
    });
  } catch (error) {
    console.error(error);
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 500, { success: false, message: '대시보드 데이터를 불러오지 못했습니다.' });
  }
}
