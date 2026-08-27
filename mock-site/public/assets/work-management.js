(function () {
  'use strict';

  const workType = document.body.dataset.workType;
  const config = workType === 'implementation'
    ? { base: 'implementation', itemLabel: '프로그램명', assigneeLabel: '개발자', evidenceLabel: '단위테스트 증적', counterpart: '/test-mgmt.html' }
    : { base: 'test-mgmt', itemLabel: 'TEST CASE명', assigneeLabel: '담당자', evidenceLabel: '통합테스트 증적', counterpart: '/implementation.html' };
  let state = { items: [], actor: {} };
  let editingItem = null;
  let reviewItem = null;
  let reviewType = '';
  let selectedEvidenceFile = null;

  const byId = id => document.getElementById(id);
  function cell(row, text, className) { const td = document.createElement('td'); td.textContent = text ?? ''; if (className) td.className = className; row.appendChild(td); return td; }
  function formatBytes(bytes) { const value = Number(bytes || 0); if (!value) return ''; if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`; return `${(value / 1024 / 1024).toFixed(1)}MB`; }
  function statusText(status) { return status === 'approved' ? '승인' : status === 'rejected' ? '거절' : '대기'; }
  function statusBadge(status) { const span = document.createElement('span'); span.className = `status ${status || 'pending'}`; span.textContent = statusText(status); return span; }
  function showError(error) { alert(error?.message || '처리 중 오류가 발생했습니다.'); }
  async function jsonRequest(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `요청을 처리하지 못했습니다. (${response.status})`);
    return data;
  }
  function setModal(id, open) { byId(id).classList.toggle('is-open', open); }

  function renderActor() {
    byId('actorName').textContent = `${state.actor.user_name || ''} (${state.actor.job_role || '직무 미지정'})`;
    byId('importControls').classList.toggle('hidden', !state.actor.can_import);
    byId('roleSummary').textContent = state.actor.is_admin ? '관리자: 계획·증적·QA·PL 전체 처리 가능' :
      state.actor.can_qa ? 'QA 심사 권한' : state.actor.can_pl ? 'PL 최종 심사 권한' : '본인 배정 항목의 실적·증적 등록';
  }

  function addAction(container, label, className, handler, disabled) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; if (className) button.className = className;
    button.disabled = Boolean(disabled); button.addEventListener('click', handler); container.appendChild(button); return button;
  }

  function renderRows() {
    const tbody = byId('workRows'); tbody.innerHTML = '';
    if (!state.items.length) { const row = document.createElement('tr'); const td = cell(row, '등록된 계획 항목이 없습니다. 관리자가 Excel 양식으로 계획을 반영할 수 있습니다.', 'empty-row'); td.colSpan = 14; tbody.appendChild(row); return; }
    state.items.forEach(item => {
      const row = document.createElement('tr');
      cell(row, item.row_no); cell(row, item.unit_system); cell(row, item.assignee); cell(row, item.item_name, 'cell-name').title = item.item_name;
      cell(row, item.plan_start_date); cell(row, item.plan_end_date); cell(row, item.actual_start_date || '-'); cell(row, item.actual_end_date || '-');
      const evidenceCell = cell(row, '');
      if (item.has_evidence) addAction(evidenceCell, `보기${item.evidence_file_size ? ` · ${formatBytes(item.evidence_file_size)}` : ''}`, 'secondary', () => openPreview(item));
      else evidenceCell.textContent = '-';
      const qaCell = cell(row, ''); qaCell.appendChild(statusBadge(item.qa_status));
      const qaReason = cell(row, item.qa_rejection_reason || '-', 'cell-reason'); qaReason.title = item.qa_rejection_reason || '';
      const plCell = cell(row, ''); plCell.appendChild(statusBadge(item.pl_status));
      const plReason = cell(row, item.pl_rejection_reason || '-', 'cell-reason'); plReason.title = item.pl_rejection_reason || '';
      const actions = cell(row, '', 'row-actions');
      if (item.can_edit) addAction(actions, '증적 등록', '', () => openEdit(item));
      if (item.can_qa) addAction(actions, 'QA 심사', 'secondary', () => openReview(item, 'qa'));
      if (state.actor.can_pl) addAction(actions, item.can_pl ? 'PL 심사' : 'QA 승인 대기', 'secondary', () => item.can_pl && openReview(item, 'pl'), !item.can_pl);
      if (item.can_delete) addAction(actions, '삭제', 'danger', () => deleteItem(item));
      if (!actions.childElementCount) actions.textContent = '-';
      tbody.appendChild(row);
    });
  }

  async function loadItems() {
    try { state = await jsonRequest(`/api/${config.base}`); renderActor(); renderRows(); }
    catch (error) { showError(error); }
  }

  function updateSelectedFile(file) {
    selectedEvidenceFile = file || null;
    const zone = byId('pasteZone'); zone.classList.toggle('has-file', Boolean(file));
    zone.textContent = file ? `선택됨: ${file.name} (${formatBytes(file.size)})` : '클릭하여 이미지를 선택하거나, 캡처 이미지를 Ctrl+V로 붙여넣으세요.';
  }

  function openEdit(item) {
    editingItem = item; byId('editTitle').textContent = `${item.unit_system} · ${item.item_name}`;
    byId('actualStartDate').value = item.actual_start_date || ''; byId('actualEndDate').value = item.actual_end_date || '';
    byId('currentEvidence').textContent = item.has_evidence ? `현재 증적: ${item.evidence_file_name || '등록됨'}` : '현재 등록된 증적이 없습니다.';
    byId('evidenceFile').value = ''; byId('progressBar').style.width = '0'; updateSelectedFile(null); setModal('editModal', true);
  }
  function closeEdit() { editingItem = null; updateSelectedFile(null); setModal('editModal', false); }
  async function saveEdit() {
    if (!editingItem) return;
    const actualStart = byId('actualStartDate').value, actualEnd = byId('actualEndDate').value;
    if (actualStart && actualEnd && actualStart > actualEnd) { alert('실제 종료일이 시작일보다 빠릅니다.'); return; }
    if (selectedEvidenceFile && (!/^image\/(png|jpeg|webp)$/.test(selectedEvidenceFile.type) || selectedEvidenceFile.size > 10 * 1024 * 1024)) {
      alert('증적은 10MB 이하의 PNG, JPG, WEBP 이미지만 등록할 수 있습니다.'); return;
    }
    const saveButton = byId('editSave'); saveButton.disabled = true;
    try {
      await jsonRequest(`/api/${config.base}/${editingItem.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actual_start_date: actualStart, actual_end_date: actualEnd }) });
      if (selectedEvidenceFile) await window.KpetroBlob.uploadWorkEvidence(selectedEvidenceFile, workType, editingItem.id, progress => { byId('progressBar').style.width = `${progress.percentage || 0}%`; });
      closeEdit(); await loadItems();
    } catch (error) { showError(error); } finally { saveButton.disabled = false; }
  }

  function openReview(item, type) {
    reviewItem = item; reviewType = type; byId('reviewTitle').textContent = type === 'qa' ? 'QA 심사' : 'PL 최종 심사';
    byId('reviewTarget').textContent = `${item.unit_system} · ${item.item_name}`;
    const currentStatus = type === 'qa' ? item.qa_status : item.pl_status;
    byId('reviewStatus').value = currentStatus === 'rejected' ? 'rejected' : 'approved';
    byId('reviewReason').value = type === 'qa' ? item.qa_rejection_reason : item.pl_rejection_reason; toggleReviewReason(); setModal('reviewModal', true);
  }
  function closeReview() { reviewItem = null; reviewType = ''; setModal('reviewModal', false); }
  function toggleReviewReason() { byId('reviewReasonGroup').classList.toggle('hidden', byId('reviewStatus').value !== 'rejected'); }
  async function saveReview() {
    if (!reviewItem) return; const status = byId('reviewStatus').value, reason = byId('reviewReason').value.trim();
    if (status === 'rejected' && !reason) { alert('거절 사유를 입력해주세요.'); return; }
    try { await jsonRequest(`/api/${config.base}/${reviewItem.id}/${reviewType}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, rejection_reason: reason }) }); closeReview(); await loadItems(); }
    catch (error) { showError(error); }
  }

  function openPreview(item) { byId('previewTitle').textContent = item.evidence_file_name || config.evidenceLabel; byId('previewImage').src = `/api/${config.base}/${item.id}/evidence?v=${Date.now()}`; setModal('previewModal', true); }
  function closePreview() { byId('previewImage').removeAttribute('src'); setModal('previewModal', false); }
  async function deleteItem(item) { if (!confirm(`${item.item_name} 항목과 연결된 증적을 삭제하시겠습니까?`)) return; try { await jsonRequest(`/api/${config.base}/${item.id}`, { method: 'DELETE' }); await loadItems(); } catch (error) { showError(error); } }

  async function importExcel() {
    const input = byId('excelFile'); if (!input.files.length) { alert('Excel 파일을 선택해주세요.'); return; } const file = input.files[0];
    const send = async mode => { const body = new FormData(); body.append('file', file); body.append('mode', mode); return jsonRequest(`/api/${config.base}/import`, { method: 'POST', body }); };
    try {
      const preview = await send('preview'); const sample = preview.rows.slice(0, 5).map(row => `${row.row_no}. ${row.unit_system} / ${row.item_name}`).join('\n');
      if (!confirm(`${preview.row_count}행을 확인했습니다.\n\n${sample}\n\n동일한 단위시스템·항목명은 갱신하고 신규 항목은 추가할까요?`)) return;
      const result = await send('apply'); alert(result.message); input.value = ''; await loadItems();
    } catch (error) { showError(error); }
  }

  byId('counterpartLink').href = config.counterpart;
  byId('templateButton').addEventListener('click', () => { location.href = `/api/${config.base}/template`; });
  byId('selectExcelButton').addEventListener('click', () => byId('excelFile').click());
  byId('importButton').addEventListener('click', importExcel);
  byId('evidenceFile').addEventListener('change', event => updateSelectedFile(event.target.files[0]));
  byId('pasteZone').addEventListener('click', () => byId('evidenceFile').click());
  byId('pasteZone').addEventListener('paste', event => { const item = Array.from(event.clipboardData?.items || []).find(candidate => candidate.type.startsWith('image/')); if (!item) return; event.preventDefault(); const blob = item.getAsFile(); updateSelectedFile(new File([blob], `captured-evidence-${Date.now()}.png`, { type: blob.type || 'image/png' })); });
  byId('editCancel').addEventListener('click', closeEdit); byId('editSave').addEventListener('click', saveEdit);
  byId('reviewCancel').addEventListener('click', closeReview); byId('reviewSave').addEventListener('click', saveReview); byId('reviewStatus').addEventListener('change', toggleReviewReason);
  byId('previewClose').addEventListener('click', closePreview);
  document.querySelectorAll('.modal-overlay').forEach(modal => modal.addEventListener('click', event => { if (event.target !== modal) return; if (modal.id === 'editModal') closeEdit(); if (modal.id === 'reviewModal') closeReview(); if (modal.id === 'previewModal') closePreview(); }));
  document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; closeEdit(); closeReview(); closePreview(); });
  window.kpetroSessionReady.then(session => {
    if (session.authenticated && !session.is_first_login) loadItems();
  });
})();
