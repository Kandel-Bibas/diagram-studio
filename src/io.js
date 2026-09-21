/* io.js — import/export: the toolbar's Import, Copy spec JSON, Copy figure and Download HTML buttons.
 *
 * Export never touches the DOM figure; it reads the store directly, so what you copy or download is exactly
 * what is in the spec. Import is permissive about what you paste (raw JSON, a <figure> block, or a whole
 * HTML page) but strict about what it hands to the store: store.replace() does the real validation and
 * import stays a no-op (dialog stays open, errors listed) until the spec is actually usable.
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var store, importEls, exportEls;
  var $ = function (id) { return document.getElementById(id); };

  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function slugify(s) {
    return ((s || 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || 'diagram';
  }

  // ---- export ----
  function specJSON() { return JSON.stringify(store.get(), null, 2); }

  function figureHTML() {
    var scale = store.scale();
    var json = JSON.stringify(store.get(), null, 2).replace(/<\//g, '<\\/');   // never a literal closing tag inside the script element
    return '<figure class="diagram" data-scale="' + scale + '">\n<script type="application/json">' + json + '<' + '/script>\n</figure>';
  }

  function standaloneHTML() {
    var spec = store.get();
    var tokens = ($('tokens') && $('tokens').textContent) || '';
    var engine = ($('dg-engine') && $('dg-engine').textContent) || '';
    var pageCss = 'body{margin:0;background:var(--page);color:var(--ink-2);' +
      'font:var(--weight) var(--text-body)/var(--leading-body) var(--sans)}' +
      '.page-col{max-width:1120px;margin:0 auto;padding:24px}' +
      '.diagram-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:24px}';
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHTML(spec.title || 'Diagram') + '</title>\n' +
      '<style>\n' + tokens + '\n' + pageCss + '\n' + '<' + '/style>\n' +
      '</head>\n<body>\n<div class="page-col"><div class="diagram-card">\n' + figureHTML() + '\n</div></div>\n' +
      '<script>\n' + engine + '\n' + '<' + '/script>\n' +
      '</body>\n</html>\n';
  }

  // ---- import ----
  function parseImport(text) {
    text = (text || '').trim();
    if (!text) throw new Error('paste a spec JSON, a <figure> block, or a whole HTML page');
    if (text.charAt(0) === '{') {
      try { return { spec: JSON.parse(text), scale: undefined }; }
      catch (e) { throw new Error('that does not look like a <figure> block, and it is not valid JSON: ' + e.message); }
    }
    var doc = new DOMParser().parseFromString(text, 'text/html');
    var fig = doc.querySelector('figure.diagram');
    if (!fig) throw new Error('no spec JSON and no <figure class="diagram"> block found in the pasted text');
    var script = fig.querySelector('script[type="application/json"]');
    if (!script) throw new Error('the <figure> has no script[type="application/json"] with the spec');
    var spec;
    try { spec = JSON.parse(script.textContent); }
    catch (e2) { throw new Error("the figure's JSON is invalid: " + e2.message); }
    var scaleAttr = fig.getAttribute('data-scale');
    return { spec: spec, scale: (scaleAttr === 'doc' || scaleAttr === 'slide') ? scaleAttr : undefined };
  }

  function buildImportDialog() {
    var dialog = document.createElement('dialog');
    dialog.className = 'import-dialog';
    dialog.appendChild(elText('h2', 'Import'));
    dialog.appendChild(elText('p', 'Paste a spec JSON, a <figure> block, or a whole HTML page. The scale ("doc" or "slide") is read from a pasted figure’s data-scale, or from spec.scale, when present.', 'import-note'));

    var wrap = document.createElement('div'); wrap.className = 'field';
    var lab = document.createElement('label'); lab.setAttribute('for', 'import-text'); lab.textContent = 'Spec, figure, or page';
    var ta = document.createElement('textarea'); ta.className = 'textarea'; ta.id = 'import-text';
    wrap.appendChild(lab); wrap.appendChild(ta);
    dialog.appendChild(wrap);

    var errBox = document.createElement('div'); errBox.className = 'field-error'; errBox.hidden = true;
    dialog.appendChild(errBox);

    var actions = document.createElement('div'); actions.className = 'import-actions';
    var cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-secondary'; cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () { dialog.close(); });
    var importBtn = document.createElement('button'); importBtn.type = 'button'; importBtn.className = 'btn btn-primary'; importBtn.textContent = 'Import';
    importBtn.addEventListener('click', doImport);
    actions.appendChild(cancelBtn); actions.appendChild(importBtn);
    dialog.appendChild(actions);

    dialog.addEventListener('close', function () { errBox.hidden = true; errBox.textContent = ''; });
    document.body.appendChild(dialog);
    return { dialog: dialog, textarea: ta, errBox: errBox };
  }

  function elText(tag, text, cls) {
    var e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function showImportProblems(list) {
    var box = importEls.errBox;
    while (box.firstChild) box.removeChild(box.firstChild);
    var ul = document.createElement('ul');
    list.forEach(function (msg) { ul.appendChild(elText('li', msg)); });
    box.appendChild(ul);
    box.hidden = false;
  }

  function doImport() {
    var parsed;
    try { parsed = parseImport(importEls.textarea.value); }
    catch (e) { showImportProblems([e.message]); return; }
    try { store.replace(parsed.spec, parsed.scale); }
    catch (e2) { showImportProblems(e2.problems || [e2.message]); return; }
    importEls.dialog.close();
    Studio.toast('Imported ' + store.get().nodes.length + ' nodes');
  }

  // ---- clipboard, with a manual fallback when it is blocked (common on file://) ----
  function buildExportDialog() {
    var dialog = document.createElement('dialog');
    dialog.className = 'import-dialog';
    dialog.appendChild(elText('h2', 'Copy manually'));
    dialog.appendChild(elText('p', 'Clipboard access is blocked here (common when the page is opened from a file:// URL). Select the text below and copy it yourself.', 'import-note'));
    var wrap = document.createElement('div'); wrap.className = 'field';
    var lab = document.createElement('label'); lab.setAttribute('for', 'export-text'); lab.textContent = 'Content';
    var ta = document.createElement('textarea'); ta.className = 'textarea'; ta.id = 'export-text'; ta.readOnly = true;
    wrap.appendChild(lab); wrap.appendChild(ta);
    dialog.appendChild(wrap);
    var actions = document.createElement('div'); actions.className = 'import-actions';
    var closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'btn btn-primary'; closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function () { dialog.close(); });
    actions.appendChild(closeBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);
    return { dialog: dialog, textarea: ta };
  }

  function openExportFallback(text) {
    exportEls.textarea.value = text;
    exportEls.dialog.showModal();
    exportEls.textarea.focus(); exportEls.textarea.select();
  }

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { Studio.toast(successMsg); }, function () { openExportFallback(text); });
    } else { openExportFallback(text); }
  }

  // ---- download ----
  function downloadHTML() {
    var html = standaloneHTML();
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = slugify(store.get().title) + '.html';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    Studio.toast('Downloaded ' + a.download);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);           // revoking immediately can cancel the download in some browsers
  }

  function init(opts) {
    store = opts.store;
    importEls = buildImportDialog();
    exportEls = buildExportDialog();
    $('import').addEventListener('click', function () {
      importEls.errBox.hidden = true; importEls.errBox.textContent = '';
      importEls.textarea.value = '';
      importEls.dialog.showModal();
      importEls.textarea.focus();
    });
    $('copy-json').addEventListener('click', function () { copyText(specJSON(), 'Copied spec JSON'); });
    $('copy-figure').addEventListener('click', function () { copyText(figureHTML(), 'Copied <figure> block'); });
    $('download-html').addEventListener('click', downloadHTML);
  }

  Studio.io = { init: init, figureHTML: figureHTML, standaloneHTML: standaloneHTML, specJSON: specJSON, parseImport: parseImport };
})();
