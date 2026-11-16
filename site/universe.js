// Theme, language, the top bar edge, and the gallery's filter and search. The pages work
// without it. Theme and language share papilot.ai's stored choices (same origin).
(function () {
  var root = document.documentElement;
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ } }

  // Language: English or Simplified Chinese.
  function setLang(lang) {
    root.dataset.lang = lang; root.lang = lang;
    document.querySelectorAll('[data-placeholder-zh]').forEach(function (input) {
      input.placeholder = lang === 'zh-CN' ? input.dataset.placeholderZh : input.dataset.placeholderEn;
    });
    document.querySelectorAll('.lang-list [data-set-lang]').forEach(function (item) {
      item.setAttribute('aria-checked', String(item.dataset.setLang === lang));
    });
    if (root.dataset.titleZh) document.title = lang === 'zh-CN' ? root.dataset.titleZh : root.dataset.titleEn;
  }
  setLang(root.dataset.lang || 'en');
  var langButton = document.getElementById('lang-button'), langList = document.getElementById('lang-list');
  if (langButton && langList) {
    langButton.parentElement.hidden = false;
    var close = function () { langList.hidden = true; langButton.setAttribute('aria-expanded', 'false'); };
    langButton.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = langList.hidden; langList.hidden = !open; langButton.setAttribute('aria-expanded', String(open));
      if (open) langList.querySelector('[aria-checked="true"]').focus();
    });
    langList.addEventListener('click', function (event) {
      var item = event.target.closest('[data-set-lang]'); if (!item) return;
      setLang(item.dataset.setLang); store('papilot-lang', item.dataset.setLang); close(); langButton.focus();
    });
    document.addEventListener('click', function (event) { if (!langList.hidden && !langList.contains(event.target)) close(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !langList.hidden) { close(); langButton.focus(); } });
  }

  // Theme: follow the system until the visitor picks one.
  var themeButton = document.getElementById('theme-button');
  if (themeButton) {
    var dark = function () { return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
    var sync = function () { themeButton.setAttribute('aria-pressed', String(dark())); };
    themeButton.hidden = false; sync();
    themeButton.addEventListener('click', function () { var next = dark() ? 'light' : 'dark'; root.dataset.theme = next; store('papilot-theme', next); sync(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  }

  var bar = document.querySelector('.topbar');
  if (bar) { var edge = function () { bar.classList.toggle('scrolled', scrollY > 4); }; addEventListener('scroll', edge, { passive: true }); edge(); }

  // Gallery: category tabs and search, kept in the address for sharing.
  var grid = document.querySelector('[data-grid]');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  var input = document.querySelector('[data-search-input]'), empty = document.querySelector('[data-empty]');
  var params = new URLSearchParams(location.search);
  var filter = tabs.some(function (tab) { return tab.dataset.filter === params.get('category'); }) ? params.get('category') : 'all';
  input.value = params.get('q') || '';
  function matches(card, words) { return words.every(function (word) { return card.dataset.search.indexOf(word) >= 0; }); }
  function apply() {
    var words = input.value.toLowerCase().split(/\s+/).filter(Boolean), shown = 0, counts = { all: 0 };
    cards.forEach(function (card) {
      var hit = matches(card, words);
      if (hit) { counts.all++; counts[card.dataset.group] = (counts[card.dataset.group] || 0) + 1; }
      var visible = hit && (filter === 'all' || card.dataset.group === filter);
      card.hidden = !visible; if (visible) shown++;
    });
    tabs.forEach(function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.filter === filter));
      tab.querySelector('.count').textContent = counts[tab.dataset.filter] || 0;
    });
    empty.hidden = shown > 0;
    var next = new URLSearchParams();
    if (filter !== 'all') next.set('category', filter);
    if (input.value.trim()) next.set('q', input.value.trim());
    var query = next.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
  }
  tabs.forEach(function (tab) { tab.addEventListener('click', function () { filter = tab.dataset.filter; apply(); }); });
  input.addEventListener('input', apply);
  input.addEventListener('keydown', function (event) { if (event.key === 'Escape' && input.value) { input.value = ''; apply(); } });
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    var target = event.target;
    if (target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault(); input.focus();
  });
  apply();
})();
