// Language toggle, category filter and search. The pages work without it.
(function () {
  var root = document.documentElement;
  function setLang(lang) {
    root.dataset.lang = lang; root.lang = lang;
    try { localStorage.setItem('papilot-universe-lang', lang); } catch (e) { /* storage blocked */ }
    var input = document.querySelector('[data-search-input]');
    if (input) input.placeholder = lang === 'zh-CN' ? input.dataset.placeholderZh : input.getAttribute('aria-label');
  }
  setLang(root.dataset.lang || 'en');
  var toggle = document.querySelector('[data-lang-toggle]');
  if (toggle) toggle.addEventListener('click', function () { setLang(root.dataset.lang === 'zh-CN' ? 'en' : 'zh-CN'); });

  var grid = document.querySelector('[data-grid]');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  var input = document.querySelector('[data-search-input]'), empty = document.querySelector('[data-empty]');
  var filter = 'all';
  function apply() {
    var words = (input.value || '').toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
    cards.forEach(function (card) {
      var visible = (filter === 'all' || card.dataset.group === filter) && words.every(function (word) { return card.dataset.search.indexOf(word) >= 0; });
      card.hidden = !visible; if (visible) shown++;
    });
    empty.hidden = shown > 0;
  }
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      filter = tab.dataset.filter;
      tabs.forEach(function (other) { other.setAttribute('aria-selected', String(other === tab)); });
      apply();
    });
  });
  input.addEventListener('input', apply);
})();
