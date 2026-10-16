(() => {
  const dialog = document.getElementById('healthLabDialog');
  const host = document.getElementById('healthLabUploader');
  if (!dialog || !host) return;
  let uploader = null, patientId = null, dirty = false, refreshing = false;
  let returnFocus = null;
  function samePatient() { return patientId === currentPatient && patientId === document.getElementById('patientSelect').value; }
  async function refreshRecord() {
    if (!dirty || !samePatient()) return;
    dirty = false; refreshing = true;
    try { await loadRecord(); } finally { refreshing = false; }
  }
  function dispose() { uploader?.dispose(); uploader = null; patientId = null; dirty = false; }
  function close() { if (dialog.open) dialog.close(); }
  function showHistory(page = 'overview') {
    close();
    document.querySelector('.tabs [data-page="' + page + '"]')?.click();
    if (page === 'overview') document.getElementById('healthTestsCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refreshRecord();
  }
  window.openHealthLab = () => {
    if (!recordReady() || !window.DrManLabUploader) return;
    returnFocus = document.activeElement;
    const patient = patients.find(item => item.id === currentPatient);
    if (!patient) return;
    if (!uploader || patientId !== patient.id || uploader.completed) {
      dispose(); patientId = patient.id;
      host.querySelectorAll('.state').forEach(node => { node.classList.remove('show'); node.replaceChildren(); });
      host.querySelector('[data-lab-id="age"]').value = '';
      host.querySelector('[data-lab-id="gender"]').value = '';
      host.querySelector('[data-lab-id="gender"]').disabled = false;
      host.querySelector('[data-lab-id="reason"]').selectedIndex = 0;
      uploader = window.DrManLabUploader.create(host, {
        embedded: true, patient: { ...patient }, isCurrent: samePatient,
        onArchiveSaved: () => { dirty = true; },
        onComplete: () => { dirty = true; refreshRecord(); },
        onSettled: () => { if (dirty) refreshRecord(); },
        onHistory: showHistory
      });
    }
    document.getElementById('healthLabPatient').textContent = 'این آزمایش برای «' + patient.display_name + '» ثبت می‌شود.';
    if (!dialog.open) dialog.showModal();
  };
  document.getElementById('healthLabClose').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    // A same-patient analysis continues when its dialog is closed. Reopening the
    // dialog resumes it rather than sending and charging the same request twice.
    if (!uploader?.busy) refreshRecord();
    if (returnFocus?.isConnected) returnFocus.focus();
  });
  document.addEventListener('drman:health-record-loading', event => {
    if (!uploader || (refreshing && event.detail?.patientId === patientId)) return;
    // A family switch clears every preview and aborts the old browser request.
    dispose(); close();
    host.querySelectorAll('.state').forEach(node => { node.classList.remove('show'); node.replaceChildren(); });
    host.querySelector('[data-lab-id="slots"]').replaceChildren();
  });
  window.addEventListener('pagehide', dispose);
})();
