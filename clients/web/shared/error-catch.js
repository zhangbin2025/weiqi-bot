window.addEventListener('error', function(e) {
  var box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = '[加载错误] ' + (e.message || e) + '\n' + (e.filename || '') + ':' + (e.lineno || '');
  var root = document.getElementById('page-root');
  if (root) root.prepend(box);
});
window.addEventListener('unhandledrejection', function(e) {
  var box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = '[Promise错误] ' + (e.reason && e.reason.message || e.reason || e);
  var root = document.getElementById('page-root');
  if (root) root.prepend(box);
});
