const $ = id => document.getElementById(id);
let last = 0;
function render(state) {
  const value = Math.max(last, Math.min(100, Number(state.progress) || 0)); last = value;
  $('phase').textContent = state.message;
  $('percent').textContent = String(value);
  $('progress').value = value; $('progress').textContent = value + '%';
  $('progress').setAttribute('aria-valuetext', value + '% · ' + state.message);
  if ($('quote').textContent !== state.quote) $('quote').textContent = state.quote;
  $('version').textContent = '知习 v' + state.version;
  document.querySelectorAll('[data-at]').forEach(dot => dot.classList.toggle('done', Number(dot.dataset.at) <= value));
  document.body.classList.toggle('leaving', !!state.leaving);
  document.body.classList.toggle('has-error', !!state.error);
  $('error-panel').hidden = !state.error;
  $('error-detail').textContent = state.error || '';
}
$('close').addEventListener('click', () => window.startup.exit());
$('exit').addEventListener('click', () => window.startup.exit());
$('retry').addEventListener('click', () => window.startup.retry());
window.startup.subscribe(render);
window.startup.snapshot().then(render);
