import fs from 'node:fs';
import { Readable } from 'node:stream';
import { ensureSchema, sql, dateString, getUserById } from './_lib/db.js';
import { projectWeekCount } from './_lib/dates.js';
import {
  clearSessionCookie, getSessionSubject, hashPassword, hasPermission, normalizePermissions,
  parsePermissions, randomPassword, sameOrigin, setSessionCookie, verifyPassword,
} from './_lib/security.js';

export const config = { api: { bodyParser: false } };

const MAX_EXCEL_SIZE = 4 * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf','doc','docx','hwp','hwpx','xls','xlsx','ppt','pptx','txt','png','jpg','jpeg']);

function json(res, status, body) { res.status(status).json(body); }
function value(field) { return Array.isArray(field) ? String(field[0] ?? '') : String(field ?? ''); }
function clean(valueToClean, length = 1000) { return String(valueToClean ?? '').trim().slice(0, length); }
function numberValue(valueToParse, fallback = 0) {
  const parsed = Number(valueToParse);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}
function routeOf(req) { return clean(req.query.route || '', 300).replace(/^\/+|\/+$/g, ''); }

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function parseForm(req, options = {}) {
  const { default: formidable } = await import('formidable');
  const form = formidable({ multiples: true, maxFiles: 20, maxFileSize: options.maxFileSize || MAX_FILE_SIZE, allowEmptyFiles: false });
  return new Promise((resolve, reject) => form.parse(req, (error, fields, files) => error ? reject(error) : resolve({ fields, files })));
}

function fileList(files, key) {
  if (!files?.[key]) return [];
  return Array.isArray(files[key]) ? files[key] : [files[key]];
}

async function currentUser(req) {
  return getUserById(getSessionSubject(req));
}

function requireUser(res, user, permission, admin = false, allowFirstLogin = false) {
  if (!user) { json(res, 401, { success: false, message: '로그인이 필요합니다.' }); return false; }
  if (user.is_first_login && !allowFirstLogin) { json(res, 428, { success: false, message: '먼저 비밀번호를 변경해야 합니다.' }); return false; }
  if (admin && !user.is_admin) { json(res, 403, { success: false, message: '관리자 권한이 필요합니다.' }); return false; }
  if (permission && !hasPermission(user, permission)) { json(res, 403, { success: false, message: '화면 접근 권한이 없습니다.' }); return false; }
  return true;
}

function dateFields(row) {
  return { ...row, start_date: dateString(row.start_date), end_date: dateString(row.end_date) };
}

async function configHandler(req, res, user) {
  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM project_config WHERE id=1`;
    const row = rows[0] || {};
    return json(res, 200, {
      project_title: row.project_title || '', target_date: dateString(row.target_date),
      start_date: dateString(row.start_date), end_date: dateString(row.end_date),
      logo_url: row.logo_url || '', favicon_url: row.favicon_url || '',
    });
  }
  if (!requireUser(res, user, 'project')) return;
  const { fields, files } = await parseForm(req, { maxFileSize: MAX_EXCEL_SIZE });
  let logoUrl = null;
  let faviconUrl = null;
  const logo = fileList(files, 'logo')[0];
  const favicon = fileList(files, 'favicon')[0];
  const blobStorage = logo || favicon ? await import('@vercel/blob') : null;
  if (logo) {
    if (!/^image\/(png|jpeg|webp)$/.test(logo.mimetype || '')) return json(res, 400, { success:false, message:'로고는 JPG, PNG, WEBP만 사용할 수 있습니다.' });
    const blob = await blobStorage.put(`branding/logo-${Date.now()}-${clean(logo.originalFilename, 100)}`, fs.readFileSync(logo.filepath), { access:'private', contentType:logo.mimetype, addRandomSuffix:true });
    logoUrl = blob.url;
  }
  if (favicon) {
    if (!/^(image\/png|image\/x-icon|image\/vnd.microsoft.icon)$/.test(favicon.mimetype || '')) return json(res, 400, { success:false, message:'파비콘은 ICO 또는 PNG만 사용할 수 있습니다.' });
    const blob = await blobStorage.put(`branding/favicon-${Date.now()}-${clean(favicon.originalFilename, 100)}`, fs.readFileSync(favicon.filepath), { access:'private', contentType:favicon.mimetype, addRandomSuffix:true });
    faviconUrl = blob.url;
  }
  await sql`UPDATE project_config SET project_title=${clean(value(fields.project_title),100)}, target_date=${value(fields.target_date)||null},
    start_date=${value(fields.start_date)||null}, end_date=${value(fields.end_date)||null},
    logo_url=COALESCE(${logoUrl}, logo_url), favicon_url=COALESCE(${faviconUrl}, favicon_url) WHERE id=1`;
  return json(res, 200, { success:true });
}

async function usersHandler(req, res, user) {
  if (!requireUser(res, user, null, true)) return;
  if (req.method === 'GET') {
    const rows = await sql`SELECT id,name,affiliation,team_name,job_role,phone,email,start_date,end_date,screen_permissions,is_first_login,is_admin
      FROM users ORDER BY is_admin DESC,name,id`;
    return json(res, 200, rows.map(row => ({...dateFields(row), is_first_login:Boolean(row.is_first_login), is_admin:Boolean(row.is_admin)})));
  }
  const data = await readJson(req);
  const id = clean(data.id, 50);
  if (req.method === 'DELETE') {
    if (!id) return json(res,400,{success:false,message:'삭제할 사용자 아이디가 필요합니다.'});
    if (id === user.id) return json(res,400,{success:false,message:'현재 로그인한 계정은 삭제할 수 없습니다.'});
    const target = await getUserById(id);
    if (target?.is_admin) {
      const count = await sql`SELECT COUNT(*)::int AS count FROM users WHERE is_admin=TRUE`;
      if (count[0].count <= 1) return json(res,400,{success:false,message:'마지막 관리자 계정은 삭제할 수 없습니다.'});
    }
    await sql`DELETE FROM users WHERE id=${id}`;
    return json(res,200,{success:true});
  }
  const name = clean(data.name,50);
  if (id.length < 3 || !name) return json(res,400,{success:false,message:'아이디(3~50자)와 이름은 필수입니다.'});
  const existing = await getUserById(id);
  const permissions = normalizePermissions(data.screen_permissions);
  if (existing) {
    await sql`UPDATE users SET name=${name}, affiliation=${clean(data.affiliation,100)}, team_name=${clean(data.team_name,50)},
      job_role=${clean(data.job_role,50)}, phone=${clean(data.phone,30)}, email=${clean(data.email,100)},
      start_date=${data.start_date||null}, end_date=${data.end_date||null}, screen_permissions=${permissions}, updated_at=NOW() WHERE id=${id}`;
    return json(res,200,{success:true,created:false});
  }
  const temporaryPassword = randomPassword();
  await sql`INSERT INTO users (id,password,name,affiliation,team_name,job_role,phone,email,start_date,end_date,screen_permissions,is_first_login,is_admin)
    VALUES (${id},${hashPassword(temporaryPassword)},${name},${clean(data.affiliation,100)},${clean(data.team_name,50)},${clean(data.job_role,50)},
    ${clean(data.phone,30)},${clean(data.email,100)},${data.start_date||null},${data.end_date||null},${permissions},TRUE,FALSE)`;
  return json(res,201,{success:true,created:true,temporary_password:temporaryPassword});
}

async function userResetHandler(req,res,user,userId) {
  if (!requireUser(res,user,null,true)) return;
  const temporaryPassword=randomPassword();
  const rows=await sql`UPDATE users SET password=${hashPassword(temporaryPassword)},is_first_login=TRUE,updated_at=NOW() WHERE id=${userId} RETURNING id`;
  if (!rows.length) return json(res,404,{success:false,message:'사용자를 찾을 수 없습니다.'});
  return json(res,200,{success:true,temporary_password:temporaryPassword});
}

async function userImportHandler(req,res,user) {
  if (!requireUser(res,user,null,true)) return;
  const { files }=await parseForm(req,{maxFileSize:MAX_EXCEL_SIZE});
  const file=fileList(files,'file')[0];
  if (!file || !/\.xlsx$/i.test(file.originalFilename||'')) return json(res,400,{success:false,message:'엑셀(.xlsx) 파일을 선택해주세요.'});
  const { parseUserWorkbook } = await import('./_lib/excel.js');
  const rows=await parseUserWorkbook(file.filepath);
  const created=[];
  let imported=0;
  await sql.begin(async tx=>{
    for(const row of rows){
      const id=clean(row.id||row['아이디']||row['사용자아이디'],50); const name=clean(row.name||row['성명']||row['이름'],50);
      if(id.length<3||!name) continue;
      const exists=await tx`SELECT id FROM users WHERE id=${id}`;
      if(exists.length){
        await tx`UPDATE users SET name=${name},affiliation=${clean(row.affiliation||row['소속'],100)},team_name=${clean(row.team_name||row['팀명'],50)},
          job_role=${clean(row.job_role||row['직무'],50)},phone=${clean(row.phone||row['휴대폰'],30)},email=${clean(row.email||row['이메일'],100)},updated_at=NOW() WHERE id=${id}`;
      }else{
        const temporaryPassword=randomPassword(); created.push({id,temporary_password:temporaryPassword});
        await tx`INSERT INTO users(id,password,name,affiliation,team_name,job_role,phone,email,screen_permissions,is_first_login,is_admin)
          VALUES(${id},${hashPassword(temporaryPassword)},${name},${clean(row.affiliation||row['소속'],100)},${clean(row.team_name||row['팀명'],50)},
          ${clean(row.job_role||row['직무'],50)},${clean(row.phone||row['휴대폰'],30)},${clean(row.email||row['이메일'],100)},${normalizePermissions(row.screen_permissions||row['화면권한']||{})},TRUE,FALSE)`;
      }
      imported+=1;
    }
  });
  return json(res,200,{success:true,message:`${imported}명의 회원 정보를 반영했습니다.`,temporary_passwords:created});
}

async function codesHandler(req,res,user){
  if(!requireUser(res,user))return;
  if(req.method==='GET'){
    const category=clean(req.query.category,50);
    const rows=category?await sql`SELECT * FROM common_codes WHERE category_code=${category} ORDER BY sort_order,id`:await sql`SELECT * FROM common_codes ORDER BY category_code,sort_order,id`;
    return json(res,200,rows);
  }
  if(!user.is_admin)return json(res,403,{success:false,message:'관리자 권한이 필요합니다.'});
  const data=await readJson(req);
  if(req.method==='DELETE'){await sql`DELETE FROM common_codes WHERE id=${Number(data.id)||0}`;return json(res,200,{success:true});}
  const categoryCode=clean(data.category_code,50),codeValue=clean(data.code_value,50),codeName=clean(data.code_name,100);
  if(!categoryCode||!codeValue||!codeName)return json(res,400,{success:false,message:'분류코드, 코드값, 코드명은 필수입니다.'});
  if(data.id)await sql`UPDATE common_codes SET category_code=${categoryCode},category_code_name=${clean(data.category_code_name,100)},code_value=${codeValue},code_name=${codeName},sort_order=${Number(data.sort_order)||0} WHERE id=${Number(data.id)}`;
  else await sql`INSERT INTO common_codes(category_code,category_code_name,code_value,code_name,sort_order)VALUES(${categoryCode},${clean(data.category_code_name,100)},${codeValue},${codeName},${Number(data.sort_order)||0})`;
  return json(res,200,{success:true});
}

async function getWbs(res,user){
  const rows=await sql`SELECT * FROM wbs_progress ORDER BY system_name,phase_name`;
  const state={};
  rows.forEach(row=>{const item={weight:Number(row.weight||0),plan:Number(row.plan_rate||0),actual:Number(row.actual_rate||0),start_date:dateString(row.start_date),end_date:dateString(row.end_date),date:dateString(row.input_date)};
    if(hasPermission(user,'dashboard')){item.delay_reason=row.delay_reason||'';item.recovery_plan=row.recovery_plan||'';}
    state[`${row.system_name}_${row.phase_name}`]=item;});
  return json(res,200,state);
}

async function wbsHandler(req,res,user){
  if(req.method==='GET')return getWbs(res,user);
  if(!requireUser(res,user,'input'))return;
  const data=await readJson(req);
  if(req.method==='DELETE'){
    const rows=await sql`DELETE FROM wbs_progress WHERE system_name=${clean(data.system_name,100)} AND phase_name=${clean(data.phase_name,100)} RETURNING system_name`;
    return rows.length?json(res,200,{success:true}):json(res,404,{success:false,message:'해당 WBS 항목을 찾을 수 없습니다.'});
  }
  if(!Array.isArray(data))return json(res,400,{success:false,message:'저장할 WBS 목록이 필요합니다.'});
  await sql.begin(async tx=>{for(const item of data){
    const system=clean(item.system_name,100),phase=clean(item.phase_name,100);if(!system||!phase)throw new Error('시스템명과 단계명은 필수입니다.');
    if(item.original_system&&item.original_phase&&(item.original_system!==system||item.original_phase!==phase))await tx`DELETE FROM wbs_progress WHERE system_name=${item.original_system} AND phase_name=${item.original_phase}`;
    await tx`INSERT INTO wbs_progress(system_name,phase_name,weight,plan_rate,actual_rate,start_date,end_date,input_date,updated_at)
      VALUES(${system},${phase},${numberValue(item.weight)},${numberValue(item.plan)},${numberValue(item.actual)},${item.start_date||null},${item.end_date||null},${item.date||null},NOW())
      ON CONFLICT(system_name,phase_name)DO UPDATE SET weight=EXCLUDED.weight,plan_rate=EXCLUDED.plan_rate,actual_rate=EXCLUDED.actual_rate,start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,input_date=EXCLUDED.input_date,updated_at=NOW()`;
  }});return json(res,200,{success:true});
}

async function delayHandler(req,res,user){
  if(!requireUser(res,user,'dashboard'))return;
  if(req.method==='GET'){
    const rows=await sql`SELECT delay_reason,recovery_plan FROM wbs_progress WHERE system_name=${clean(req.query.system_name,100)} AND phase_name=${clean(req.query.phase_name,100)}`;
    return rows.length?json(res,200,{delay_reason:rows[0].delay_reason||'',recovery_plan:rows[0].recovery_plan||''}):json(res,404,{success:false,message:'해당 WBS 항목을 찾을 수 없습니다.'});
  }
  const data=await readJson(req);
  const rows=await sql`UPDATE wbs_progress SET delay_reason=${clean(data.delay_reason,10000)},recovery_plan=${clean(data.recovery_plan,10000)},updated_at=NOW()
    WHERE system_name=${clean(data.system_name,100)} AND phase_name=${clean(data.phase_name,100)} RETURNING system_name`;
  return rows.length?json(res,200,{success:true}):json(res,404,{success:false,message:'해당 WBS 항목을 찾을 수 없습니다.'});
}

async function wbsImportHandler(req,res,user){
  if(!requireUser(res,user,'input'))return;const {fields,files}=await parseForm(req,{maxFileSize:MAX_EXCEL_SIZE});const file=fileList(files,'file')[0];
  if(!file||!/\.xlsx$/i.test(file.originalFilename||''))return json(res,400,{success:false,message:'엑셀(.xlsx) 파일을 선택해주세요.'});
  const { parseWbsWorkbook } = await import('./_lib/excel.js');
  const parsed=await parseWbsWorkbook(file.filepath);const mode=value(fields.mode)||'preview';
  if(mode!=='apply')return json(res,200,{success:true,preview:true,wbs_count:parsed.wbs.length,weekly_count:parsed.weekly.length,rows:parsed.wbs.slice(0,8),sheet_names:parsed.sheetNames});
  await sql.begin(async tx=>{
    await tx`DELETE FROM wbs_progress`;
    for(const row of parsed.wbs)await tx`INSERT INTO wbs_progress(system_name,phase_name,weight,plan_rate,actual_rate,start_date,end_date,input_date,delay_reason,recovery_plan)
      VALUES(${row.system_name},${row.phase_name},${row.weight},${row.plan},${row.actual},${row.start_date||null},${row.end_date||null},${row.date||null},${row.delay_reason},${row.recovery_plan})`;
    if(parsed.weekly.length){await tx`DELETE FROM wbs_weekly`;for(const row of parsed.weekly)await tx`INSERT INTO wbs_weekly(week_no,plan_rate,actual_rate)VALUES(${row.week_no},${row.plan_rate},${row.actual_rate})`;}
    await tx`INSERT INTO wbs_imports(file_name,wbs_rows,weekly_rows,imported_by)VALUES(${clean(file.originalFilename,255)},${parsed.wbs.length},${parsed.weekly.length},${user.id})`;
  });
  return json(res,200,{success:true,message:`WBS ${parsed.wbs.length}행${parsed.weekly.length?`, 주차별 ${parsed.weekly.length}행`:''}을 반영했습니다.`});
}

async function weeklyHandler(req,res,user){
  if(req.method==='GET'){
    const [rows,configRows]=await Promise.all([sql`SELECT * FROM wbs_weekly ORDER BY week_no`,sql`SELECT start_date,end_date FROM project_config WHERE id=1`]);
    const project=configRows[0]||{};
    const totalWeeks=projectWeekCount(dateString(project.start_date),dateString(project.end_date));
    const visibleRows=totalWeeks?rows.filter(row=>Number(row.week_no)<=totalWeeks):rows;
    return json(res,200,{labels:visibleRows.map(r=>`${r.week_no}주차`),plan:visibleRows.map(r=>Number(r.plan_rate||0)),actual:visibleRows.map(r=>r.actual_rate===null?null:Number(r.actual_rate))});
  }
  if(!requireUser(res,user,'weekly'))return;const data=await readJson(req);if(!Array.isArray(data)||!data.length)return json(res,400,{status:'error',message:'저장할 주차별 데이터가 없습니다.'});
  await sql.begin(async tx=>{for(const item of data){const week=Number(String(item.week_no??item.week).match(/\d+/)?.[0]);if(!week)throw new Error('주차 값이 올바르지 않습니다.');await tx`INSERT INTO wbs_weekly(week_no,plan_rate,actual_rate,updated_at)VALUES(${week},${numberValue(item.plan_rate??item.plan)},${item.actual_rate==null||item.actual_rate===''?null:numberValue(item.actual_rate??item.actual)},NOW())ON CONFLICT(week_no)DO UPDATE SET plan_rate=EXCLUDED.plan_rate,actual_rate=EXCLUDED.actual_rate,updated_at=NOW()`;}});
  return json(res,200,{status:'success',message:'성공적으로 저장되었습니다.'});
}

async function meetingsHandler(req,res,user){
  if(!requireUser(res,user,'meetings'))return;
  if(req.method==='GET'){
    const date=clean(req.query.date,10);const rows=date?await sql`SELECT id,title,meeting_date,meeting_time,location,attendees,agenda,content,summary,others FROM meetings WHERE meeting_date=${date} ORDER BY meeting_time,title`:await sql`SELECT id,title,meeting_date,meeting_time,location,attendees,agenda,content,summary,others FROM meetings ORDER BY meeting_date DESC,meeting_time,title`;
    for(const row of rows){row.meeting_date=dateString(row.meeting_date);row.meeting_time=String(row.meeting_time||'');row.files=await sql`SELECT id,file_name,file_size FROM meeting_files WHERE meeting_id=${row.id} ORDER BY id`;}
    return json(res,200,rows);
  }
  const data=await readJson(req);const title=clean(data.title,150),meetingDate=clean(data.meeting_date,10),meetingTime=clean(data.meeting_time,8),password=String(data.password||'');
  if(!title||!meetingDate||!meetingTime)return json(res,400,{success:false,message:'회의명, 날짜, 시간은 필수입니다.'});
  if(password.length<4)return json(res,400,{success:false,message:'회의 수정·삭제 비밀번호는 4자 이상이어야 합니다.'});
  const rows=await sql`INSERT INTO meetings(title,meeting_date,meeting_time,location,attendees,agenda,password,content,summary,others,created_by)
    VALUES(${title},${meetingDate},${meetingTime},${clean(data.location,100)},${clean(data.attendees,255)},${clean(data.agenda,20000)},${hashPassword(password)},${clean(data.content,50000)},${clean(data.summary,20000)},${clean(data.others,10000)},${user.id}) RETURNING id`;
  return json(res,201,{success:true,id:Number(rows[0].id)});
}

async function meetingItemHandler(req,res,user,id){
  if(!requireUser(res,user,'meetings'))return;const existing=(await sql`SELECT * FROM meetings WHERE id=${id}`)[0];if(!existing)return json(res,404,{success:false,message:'회의를 찾을 수 없습니다.'});
  const data=await readJson(req);
  if(req.method==='DELETE'){
    if(!verifyPassword(existing.password,data.password))return json(res,403,{success:false,message:'비밀번호가 일치하지 않습니다.'});
    const files=await sql`SELECT blob_url FROM meeting_files WHERE meeting_id=${id}`;
    if(files.length){const { del }=await import('@vercel/blob');await del(files.map(f=>f.blob_url));}
    await sql`DELETE FROM meetings WHERE id=${id}`;return json(res,200,{success:true});
  }
  const title=clean(data.title,150);if(!title)return json(res,400,{success:false,message:'회의명은 필수입니다.'});
  const passwordHash=data.password?hashPassword(String(data.password)):existing.password;
  await sql`UPDATE meetings SET title=${title},meeting_date=${data.meeting_date},meeting_time=${data.meeting_time},location=${clean(data.location,100)},attendees=${clean(data.attendees,255)},agenda=${clean(data.agenda,20000)},password=${passwordHash},content=${clean(data.content,50000)},summary=${clean(data.summary,20000)},others=${clean(data.others,10000)},updated_at=NOW() WHERE id=${id}`;
  return json(res,200,{success:true,id});
}

async function fileHandler(req,res,user,id,download){
  if(!requireUser(res,user,'meetings'))return;const row=(await sql`SELECT * FROM meeting_files WHERE id=${id}`)[0];if(!row)return json(res,404,{success:false,message:'파일을 찾을 수 없습니다.'});
  if(download){const { get }=await import('@vercel/blob');const response=await get(row.blob_url,{access:'private'});if(!response||response.statusCode!==200)return json(res,404,{success:false,message:'저장된 파일이 없습니다.'});res.statusCode=200;res.setHeader('Content-Type',row.content_type||response.blob.contentType||'application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);Readable.fromWeb(response.stream).pipe(res);return;}
  const { del }=await import('@vercel/blob');await del(row.blob_url);await sql`DELETE FROM meeting_files WHERE id=${id}`;return json(res,200,{success:true});
}

async function brandingHandler(res,type){
  const rows=await sql`SELECT logo_url,favicon_url FROM project_config WHERE id=1`;
  const url=type==='favicon'?rows[0]?.favicon_url:rows[0]?.logo_url;
  if(!url){res.statusCode=302;res.setHeader('Location',type==='favicon'?'/assets/kpetro-app-icon.png':'/assets/kpetro-ci.png');return res.end();}
  const { get }=await import('@vercel/blob');
  const response=await get(url,{access:'private'});if(!response||response.statusCode!==200){return json(res,404,{success:false,message:'브랜딩 파일을 찾을 수 없습니다.'});}
  res.statusCode=200;res.setHeader('Content-Type',response.blob.contentType||'image/png');res.setHeader('Cache-Control','public, max-age=300');Readable.fromWeb(response.stream).pipe(res);
}

async function blobUploadHandler(req,res,user){
  const body=await readJson(req);
  if(body?.type==='blob.generate-client-token'&&!requireUser(res,user,'meetings'))return;
  const { handleUpload }=await import('@vercel/blob/client');
  const result=await handleUpload({body,request:req,onBeforeGenerateToken:async(pathname,clientPayload)=>{
    const payload=JSON.parse(clientPayload||'{}');const meetingId=Number(payload.meetingId);if(!meetingId)throw new Error('회의 ID가 필요합니다.');const exists=await sql`SELECT id FROM meetings WHERE id=${meetingId}`;if(!exists.length)throw new Error('회의를 찾을 수 없습니다.');
    const extension=String(payload.fileName||pathname).split('.').pop().toLowerCase();if(!ALLOWED_EXTENSIONS.has(extension))throw new Error('허용되지 않는 첨부파일 형식입니다.');
    return{maximumSizeInBytes:MAX_FILE_SIZE,addRandomSuffix:true,tokenPayload:JSON.stringify({meetingId,fileName:clean(payload.fileName,255)})};
  },onUploadCompleted:async({blob,tokenPayload})=>{const payload=JSON.parse(tokenPayload||'{}');await ensureSchema();await sql`INSERT INTO meeting_files(meeting_id,file_name,blob_url,pathname,content_type,file_size)VALUES(${payload.meetingId},${payload.fileName},${blob.url},${blob.pathname||''},${blob.contentType||''},${blob.size||0})`;}});
  return json(res,200,result);
}

export default async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.status(204).end();return;}if(!['GET','HEAD'].includes(req.method)&&!sameOrigin(req))return json(res,403,{success:false,message:'허용되지 않은 요청입니다.'});
  try{
    await ensureSchema();const route=routeOf(req);const user=await currentUser(req);
    if(route==='session'&&req.method==='GET')return user?json(res,200,{authenticated:true,user_id:user.id,user_name:user.name,is_admin:Boolean(user.is_admin),is_first_login:Boolean(user.is_first_login),screen_permissions:parsePermissions(user.screen_permissions)}):json(res,200,{authenticated:false});
    if(route==='login'&&req.method==='POST'){const data=await readJson(req);const found=await getUserById(clean(data.id,50));if(found?.locked_until&&new Date(found.locked_until)>new Date())return json(res,429,{success:false,message:'로그인 시도가 잠시 제한되었습니다. 10분 후 다시 시도해주세요.'});if(!found||!verifyPassword(found.password,data.password)){if(found)await sql`UPDATE users SET failed_login_count=COALESCE(failed_login_count,0)+1,locked_until=CASE WHEN COALESCE(failed_login_count,0)+1>=5 THEN NOW()+INTERVAL '10 minutes' ELSE NULL END WHERE id=${found.id}`;return json(res,401,{success:false,message:'아이디 또는 비밀번호가 올바르지 않습니다.'});}await sql`UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=${found.id}`;setSessionCookie(res,found);return json(res,200,{success:true,is_first_login:Boolean(found.is_first_login),is_admin:Boolean(found.is_admin)});}
    if(route==='logout'&&req.method==='POST'){clearSessionCookie(res);return json(res,200,{success:true});}
    if(route==='first-password'&&req.method==='POST'){if(!requireUser(res,user,null,false,true))return;const data=await readJson(req);const newPassword=String(data.password||'');if(newPassword.length<10||!/[A-Za-z]/.test(newPassword)||!/\d/.test(newPassword)||!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(newPassword))return json(res,400,{success:false,message:'새 비밀번호는 영문·숫자·특수문자를 포함한 10자 이상이어야 합니다.'});await sql`UPDATE users SET password=${hashPassword(newPassword)},is_first_login=FALSE,updated_at=NOW() WHERE id=${user.id}`;return json(res,200,{success:true});}
    if(route==='forgot-password'&&req.method==='POST')return json(res,200,{success:true,message:'관리자에게 임시 비밀번호 발급을 요청해주세요.'});
    if(route==='config')return configHandler(req,res,user);
    if(route==='branding/logo'&&req.method==='GET')return brandingHandler(res,'logo');
    if(route==='branding/favicon'&&req.method==='GET')return brandingHandler(res,'favicon');
    if(route==='users')return usersHandler(req,res,user);
    if(route==='users/import'&&req.method==='POST')return userImportHandler(req,res,user);
    let match=route.match(/^users\/(.+)\/reset-password$/);if(match&&req.method==='POST')return userResetHandler(req,res,user,decodeURIComponent(match[1]));
    if(route==='codes')return codesHandler(req,res,user);
    if(route==='wbs')return wbsHandler(req,res,user);
    if(route==='wbs/delay'&&['GET','POST'].includes(req.method))return delayHandler(req,res,user);
    if(route==='wbs/import'&&req.method==='POST')return wbsImportHandler(req,res,user);
    if(route==='wbs/template'&&req.method==='GET'){if(!requireUser(res,user,'input'))return;const { makeWbsTemplate }=await import('./_lib/excel.js');const buffer=await makeWbsTemplate();res.statusCode=200;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''KPetro_WBS_import_template.xlsx");return res.end(buffer);}
    if(route==='weekly')return weeklyHandler(req,res,user);
    if(route==='meetings')return meetingsHandler(req,res,user);
    match=route.match(/^meetings\/(\d+)$/);if(match&&['PUT','DELETE'].includes(req.method))return meetingItemHandler(req,res,user,Number(match[1]));
    match=route.match(/^meeting-files\/(\d+)(\/download)?$/);if(match)return fileHandler(req,res,user,Number(match[1]),Boolean(match[2]));
    if(route==='blob-upload'&&req.method==='POST')return blobUploadHandler(req,res,user);
    return json(res,404,{success:false,message:'API 경로를 찾을 수 없습니다.'});
  }catch(error){console.error(error);if(error?.code==='23505')return json(res,409,{success:false,message:'이미 존재하는 값입니다.'});return json(res,500,{success:false,message:error?.message?.includes('행')?error.message:'서버 처리 중 오류가 발생했습니다.'});}
}
