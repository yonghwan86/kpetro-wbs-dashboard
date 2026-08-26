import ExcelJS from 'exceljs';

const ALIASES = {
  system_name: ['system_name', '시스템명', '시스템', '대분류', '업무구분'],
  phase_name: ['phase_name', '단계명', '단계', '공정', '세부업무'],
  weight: ['weight', '가중치', '비중'],
  plan: ['plan', 'plan_rate', '계획진척률', '계획진척율', '계획률', '계획'],
  actual: ['actual', 'actual_rate', '실제진척률', '실제진척율', '실적진척률', '실적진척율', '실제', '실적'],
  start_date: ['start_date', '시작일', '시작일자', '착수일'],
  end_date: ['end_date', '종료일', '종료일자', '완료일'],
  date: ['date', 'input_date', '입력일', '기준일', '기준일자'],
  delay_reason: ['delay_reason', '지연사유', '지연원인'],
  recovery_plan: ['recovery_plan', '만회대책', '회복계획', '조치계획'],
  week_no: ['week_no', 'week', '주차', '주'],
  plan_rate: ['plan_rate', '계획진척률', '계획진척율', '계획률', '계획'],
  actual_rate: ['actual_rate', '실제진척률', '실제진척율', '실적진척률', '실적진척율', '실제', '실적'],
};

function normalizeHeader(value) { return String(value ?? '').trim().toLowerCase().replace(/[\s()%％._-]/g, ''); }

function cellValue(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return value.result;
    if ('text' in value) return value.text;
    if (Array.isArray(value.richText)) return value.richText.map(item => item.text).join('');
  }
  return value;
}

function worksheetRows(sheet) {
  if (!sheet || sheet.rowCount < 2) return [];
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cellValue(cell.value) ?? '').trim(); });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    headers.forEach((header, column) => { if (header) record[header] = cellValue(row.getCell(column).value); });
    if (Object.values(record).some(value => value !== '' && value !== null && value !== undefined)) rows.push(record);
  });
  return rows;
}

function findValue(row, field) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  for (const alias of ALIASES[field]) {
    const value = normalized.get(normalizeHeader(alias));
    if (value !== undefined) return value;
  }
  return undefined;
}

function text(value) { return String(value ?? '').trim(); }

function number(value, label, rowNumber, nullable = false) {
  if ((value === '' || value === null || value === undefined) && nullable) return null;
  const parsed = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(parsed)) throw new Error(`${rowNumber}행 ${label} 값이 숫자가 아닙니다.`);
  if (parsed < 0 || parsed > 100) throw new Error(`${rowNumber}행 ${label} 값은 0~100이어야 합니다.`);
  return parsed;
}

function excelDate(value, label, rowNumber, required = false) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw new Error(`${rowNumber}행 ${label}이 비어 있습니다.`);
    return '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const compact = String(value).trim().replace(/[./]/g, '-');
  const match = compact.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) throw new Error(`${rowNumber}행 ${label} 날짜 형식이 올바르지 않습니다.`);
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function locateSheet(workbook, names, required) {
  const wanted = names.map(normalizeHeader);
  const sheet = workbook.worksheets.find(item => wanted.includes(normalizeHeader(item.name)));
  return sheet || (required ? workbook.worksheets[0] : null);
}

export async function parseWbsWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath, { ignoreNodes: ['dataValidations'] });
  if (!workbook.worksheets.length) throw new Error('엑셀 파일에 시트가 없습니다.');
  const wbsSheet = locateSheet(workbook, ['WBS', '단계별', '단계별진척', '진척현황'], true);
  const weeklySheet = locateSheet(workbook, ['주차별', '주차별진척', 'WEEKLY'], false);
  const rawWbs = worksheetRows(wbsSheet);
  if (!rawWbs.length) throw new Error('WBS 시트에 데이터가 없습니다.');

  const wbs = rawWbs.map((row, index) => {
    const rowNumber = index + 2;
    const systemName = text(findValue(row, 'system_name'));
    const phaseName = text(findValue(row, 'phase_name'));
    if (!systemName || !phaseName) throw new Error(`${rowNumber}행의 시스템명과 단계명은 필수입니다.`);
    const startDate = excelDate(findValue(row, 'start_date'), '시작일', rowNumber);
    const endDate = excelDate(findValue(row, 'end_date'), '종료일', rowNumber);
    if (startDate && endDate && startDate > endDate) throw new Error(`${rowNumber}행의 종료일이 시작일보다 빠릅니다.`);
    return {
      system_name: systemName.slice(0, 100), phase_name: phaseName.slice(0, 100),
      weight: number(findValue(row, 'weight') || 0, '가중치', rowNumber),
      plan: number(findValue(row, 'plan') || 0, '계획진척률', rowNumber),
      actual: number(findValue(row, 'actual') || 0, '실제진척률', rowNumber),
      start_date: startDate, end_date: endDate,
      date: excelDate(findValue(row, 'date'), '기준일', rowNumber) || new Date().toISOString().slice(0, 10),
      delay_reason: text(findValue(row, 'delay_reason')), recovery_plan: text(findValue(row, 'recovery_plan')),
    };
  });

  const keys = new Set();
  wbs.forEach((row, index) => {
    const key = `${row.system_name}\u0000${row.phase_name}`;
    if (keys.has(key)) throw new Error(`${index + 2}행의 시스템명/단계명이 중복되었습니다.`);
    keys.add(key);
  });

  const weekly = weeklySheet ? worksheetRows(weeklySheet).filter(row => text(findValue(row, 'week_no'))).map((row, index) => {
    const rowNumber = index + 2;
    const weekMatch = text(findValue(row, 'week_no')).match(/\d+/);
    if (!weekMatch) throw new Error(`주차별 시트 ${rowNumber}행의 주차가 올바르지 않습니다.`);
    const weekNo = Number(weekMatch[0]);
    if (weekNo < 1 || weekNo > 260) throw new Error(`주차별 시트 ${rowNumber}행의 주차 범위가 올바르지 않습니다.`);
    return { week_no: weekNo, plan_rate: number(findValue(row, 'plan_rate') || 0, '계획진척률', rowNumber), actual_rate: number(findValue(row, 'actual_rate'), '실제진척률', rowNumber, true) };
  }) : [];
  return { wbs, weekly, sheetNames: workbook.worksheets.map(sheet => sheet.name) };
}

export async function parseUserWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath, { ignoreNodes: ['dataValidations'] });
  return worksheetRows(workbook.worksheets[0]);
}

export async function makeWbsTemplate() {
  const workbook = new ExcelJS.Workbook();
  const wbs = workbook.addWorksheet('WBS');
  wbs.columns = ['시스템명','단계명','가중치','계획진척률','실제진척률','시작일','종료일','기준일','지연사유','만회대책'].map(header => ({ header, key: header, width: 20 }));
  wbs.addRow({ 시스템명:'1. 수급가격통합시스템',단계명:'1. 공통',가중치:10,계획진척률:7.3,실제진척률:7.3,시작일:'2026-08-19',종료일:'2026-09-02',기준일:'2026-08-26',지연사유:'',만회대책:'' });
  const weekly = workbook.addWorksheet('주차별');
  weekly.columns = ['주차','계획진척률','실제진척률'].map(header => ({ header, key: header, width: 18 }));
  weekly.addRows([{ 주차:1,계획진척률:5,실제진척률:5 },{ 주차:2,계획진척률:9,실제진척률:8 }]);
  [wbs,weekly].forEach(sheet => { sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2B4F73'}};sheet.views=[{state:'frozen',ySplit:1}]; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
