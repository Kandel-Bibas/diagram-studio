/* io.js — import/export: the toolbar's Import button and Export menu.
 *
 * Export never touches the DOM figure for text formats (spec JSON, <figure>, standalone HTML); it reads the
 * store directly, so what you copy or download is exactly what is in the spec. SVG/PNG export does read the
 * live #figure (Diagram.toSVG/toPNG need a rendered figure to measure), which the canvas keeps in sync with
 * the store at all times and renders unscaled (zoom is a CSS transform on the stage), so the output is full size.
 *
 * Import is permissive about what you paste — a share link, Mermaid text, the studio's own text syntax, raw
 * JSON, a <figure> block, or a whole HTML page — but strict about what it hands to the store: store.docs.create
 * does the real validation and import stays a no-op (dialog stays open, errors listed) until the spec is usable.
 * A successful import always opens as a NEW document, so the one you were editing is never overwritten.
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var store, importEls, exportEls;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_SHARE_LEN = 8000;

  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function slugify(s) {
    return ((s || 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || 'diagram';
  }

  // ---- export: text formats ----
  function specJSON() { return JSON.stringify(store.get(), null, 2); }

  function figureHTML() {
    var scale = store.scale();
    var json = JSON.stringify(store.get(), null, 2).replace(/<\//g, '<\\/');   // never a literal closing tag inside the script element
    return '<figure class="diagram" data-scale="' + scale + '">\n<script type="application/json">' + json + '<' + '/script>\n</figure>';
  }

  function standaloneHTML() {                                       // fills engine/page.html (Studio.PAGE_TEMPLATE, inlined by build.py)
    var tokens = ($('tokens') && $('tokens').textContent) || '';
    var engine = ($('dg-engine') && $('dg-engine').textContent) || '';
    var fill = { '@TITLE@': escapeHTML(store.get().title || 'Diagram'), '/*@TOKENS*/': tokens.trim(), '<!--@FIGURE-->': figureHTML(), '/*@ENGINE*/': engine.trim() };
    return Object.keys(fill).reduce(function (page, k) { return page.split(k).join(fill[k]); }, Studio.PAGE_TEMPLATE);
  }

  // ---- export: share link ----
  function shareSpec() {
    var spec = JSON.parse(JSON.stringify(store.get()));
    if (store.scale() === 'slide' && spec.scale === undefined) spec.scale = 'slide';
    return spec;
  }
  function shareBase() {
    return location.protocol === 'file:' ? 'https://diagram-studio.bibas.dev/app' : (location.origin + location.pathname);
  }
  function copyShareLink() {
    Studio.share.encode(shareSpec()).then(function (frag) {
      var url = shareBase() + frag;
      var msg = 'Copied share link';
      if (url.length > MAX_SHARE_LEN) msg += ' (' + url.length + ' characters — some chat apps truncate long links)';
      copyText(url, msg);
    }, function (err) { Studio.toast('Could not create a share link: ' + err.message); });
  }

  // ---- export: SVG / PNG, from the live #figure ----
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    Studio.toast('Downloaded ' + filename);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);       // revoking immediately can cancel the download in some browsers
  }
  function downloadSVG(theme) {
    var fig = $('figure'), markup;
    try { markup = window.Diagram.toSVG(fig, { theme: theme }); }
    catch (e) { Studio.toast('Could not export SVG: ' + e.message); return; }
    downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), slugify(store.get().title) + (theme === 'dark' ? '-dark' : '') + '.svg');
  }
  function downloadPNG(theme) {
    var fig = $('figure');
    window.Diagram.toPNG(fig, { theme: theme }).then(function (blob) {
      downloadBlob(blob, slugify(store.get().title) + (theme === 'dark' ? '-dark' : '') + '.png');
    }, function (e) { Studio.toast('Could not export PNG: ' + e.message); });
  }
  function downloadHTML() {
    downloadBlob(new Blob([standaloneHTML()], { type: 'text/html' }), slugify(store.get().title) + '.html');
  }

  // ---- import: format detection ----
  function firstMeaningfulLine(text) {
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l || l.indexOf('%%') === 0) continue;                    // %% is a Mermaid comment
      return l;
    }
    return '';
  }
  function shareFragmentIn(text) {
    var m = /^(?:https?:\/\/[^\s#]+)?(#[sj]=[A-Za-z0-9_-]+)$/.exec(text.trim());
    return m ? m[1] : null;
  }
  function looksLikeJSONOrMarkup(text) {
    return text.charAt(0) === '{' || /<figure[\s>]/i.test(text) || /<!doctype html/i.test(text) || /<html[\s>]/i.test(text);
  }
  function mermaidError(errors) {
    var err = new Error('Mermaid: ' + (errors[0] ? errors[0].message : 'could not parse'));
    err.problems = errors.map(function (e) { return 'line ' + e.line + ': ' + e.message; });
    return err;
  }

  function parseImport(text) {                                      // the fallback: JSON, a <figure> block, or a whole page
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

  // detectAndParse(text) → Promise<{spec, scale, warnings}>; tries, in order: a share link, Mermaid text, the
  // studio's own text syntax, then the plain JSON / figure / page fallback above.
  function detectAndParse(text) {
    var raw = text || '';
    text = raw.trim();
    if (!text) return Promise.reject(new Error('paste a spec JSON, a <figure> block, a whole HTML page, a share link, Mermaid, or studio text'));

    var frag = shareFragmentIn(text);
    if (frag) {
      return Studio.share.decode(frag).then(function (spec) {
        if (!spec) throw new Error('that link is not a diagram share link');
        return { spec: spec, scale: undefined, warnings: [] };
      });
    }

    var firstLine = firstMeaningfulLine(text);
    if (Studio.text && Studio.text.parseMermaid && /^(flowchart|graph)\b/i.test(firstLine)) {
      var m = Studio.text.parseMermaid(text);
      if (m.errors && m.errors.length) return Promise.reject(mermaidError(m.errors));
      return Promise.resolve({ spec: m.spec, scale: undefined, warnings: m.warnings || [] });
    }

    if (!looksLikeJSONOrMarkup(text) && Studio.text && Studio.text.parse) {
      var r = Studio.text.parse(text);
      if (r && (!r.errors || !r.errors.length)) return Promise.resolve({ spec: r.spec, scale: undefined, warnings: r.warnings || [] });
    }

    try { var got = parseImport(raw); got.warnings = []; return Promise.resolve(got); }
    catch (e) { return Promise.reject(e); }
  }

  function buildImportDialog() {
    var dialog = document.createElement('dialog');
    dialog.id = 'import-dialog'; dialog.className = 'import-dialog';
    dialog.appendChild(elText('h2', 'Import'));
    dialog.appendChild(elText('p', 'Paste a spec JSON, a <figure> block, a whole HTML page, a share link, Mermaid flowchart text, or the studio’s own text syntax. It always opens as a new document.', 'import-note'));

    var wrap = document.createElement('div'); wrap.className = 'field';
    var lab = document.createElement('label'); lab.setAttribute('for', 'import-text'); lab.textContent = 'Spec, figure, page, link or text';
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
    detectAndParse(importEls.textarea.value).then(function (result) {
      try { store.docs.create(result.spec, result.scale); }
      catch (e) { showImportProblems(e.problems || [e.message]); return; }
      importEls.dialog.close();
      var msg = 'Imported ' + store.get().nodes.length + ' nodes as a new document';
      if (result.warnings && result.warnings.length) {
        msg += ' — ' + result.warnings.length + ' warning' + (result.warnings.length > 1 ? 's' : '');
        if (window.console) console.warn('Import warnings:\n- ' + result.warnings.map(function (w) { return w.message || w; }).join('\n- '));
      }
      Studio.toast(msg);
    }, function (e) { showImportProblems(e.problems || [e.message]); });
  }

  // ---- clipboard, with a manual fallback when it is blocked (common on file://) ----
  function buildExportDialog() {
    var dialog = document.createElement('dialog');
    dialog.id = 'export-fallback-dialog'; dialog.className = 'import-dialog';
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

  // ---- Export menu: a button + menu disclosure (Esc closes and returns focus; arrow keys move through items) ----
  function initMenu(btn, list) {
    var items = Array.prototype.slice.call(list.querySelectorAll('[role="menuitem"]'));
    function open() {
      list.hidden = false; btn.setAttribute('aria-expanded', 'true');
      items[0].focus();
      document.addEventListener('mousedown', onOutside, true);
    }
    function close(returnFocus) {
      if (list.hidden) return;
      list.hidden = true; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onOutside, true);
      if (returnFocus) btn.focus();
    }
    function onOutside(ev) { if (!list.contains(ev.target) && ev.target !== btn) close(false); }
    btn.addEventListener('click', function () { if (list.hidden) open(); else close(false); });
    list.addEventListener('keydown', function (ev) {
      var i = items.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); close(true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1 + items.length) % items.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); items[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1].focus(); }
      else if (ev.key === 'Tab') { close(false); }
    });
    items.forEach(function (it) { it.addEventListener('click', function () { close(true); }); });
  }

  function initExportMenu() {
    initMenu($('export-btn'), $('export-menu'));
    $('export-share').addEventListener('click', copyShareLink);
    $('export-svg-light').addEventListener('click', function () { downloadSVG('light'); });
    $('export-svg-dark').addEventListener('click', function () { downloadSVG('dark'); });
    $('export-png-light').addEventListener('click', function () { downloadPNG('light'); });
    $('export-png-dark').addEventListener('click', function () { downloadPNG('dark'); });
    $('export-figure').addEventListener('click', function () { copyText(figureHTML(), 'Copied <figure> block'); });
    $('export-json').addEventListener('click', function () { copyText(specJSON(), 'Copied spec JSON'); });
    $('export-html').addEventListener('click', downloadHTML);
  }

  function init(opts) {
    store = opts.store;
    importEls = buildImportDialog();
    exportEls = buildExportDialog();
    initExportMenu();
    $('import').addEventListener('click', function () {
      importEls.errBox.hidden = true; importEls.errBox.textContent = '';
      importEls.textarea.value = '';
      importEls.dialog.showModal();
      importEls.textarea.focus();
    });
  }

  Studio.io = { init: init, figureHTML: figureHTML, standaloneHTML: standaloneHTML, specJSON: specJSON, parseImport: parseImport, detectAndParse: detectAndParse };
})();
