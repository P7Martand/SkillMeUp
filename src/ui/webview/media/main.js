(function () {
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const summary = document.getElementById('summary');
  const installBtn = document.getElementById('install');
  const cancelBtn = document.getElementById('cancel');
  const refreshBtn = document.getElementById('refresh');
  const addSourceBtn = document.getElementById('add-source');
  const searchInput = document.getElementById('search');
  const filterBar = document.getElementById('filters');

  /** itemsById: id -> item. order: ids in rank order from host. */
  let itemsById = new Map();
  let suggestedIds = [];
  let reasons = {};
  let facets = { categories: [], counts: { skills: 0, plugins: 0, verified: 0, community: 0 } };
  let resultIds = [];
  const selected = new Set();
  let filters = {};
  let query = '';
  let debounceTimer = null;

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      itemsById = new Map(msg.data.items.map((i) => [i.id, i]));
      suggestedIds = msg.data.suggestedIds;
      reasons = msg.data.reasons;
      facets = msg.data.facets;
      selected.clear();
      for (const id of suggestedIds) selected.add(id);
      renderFilters();
      requestSearch(true);
    } else if (msg.type === 'results') {
      resultIds = msg.ids;
      render();
    } else if (msg.type === 'install:done') {
      for (const r of msg.results) if (r.status === 'installed') selected.delete(r.item.id);
      render();
    }
  });

  installBtn.addEventListener('click', () => {
    if (selected.size === 0) return;
    vscode.postMessage({ type: 'install', ids: [...selected] });
  });
  cancelBtn.addEventListener('click', () => { selected.clear(); render(); });
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  addSourceBtn.addEventListener('click', () => vscode.postMessage({ type: 'add-source' }));

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    requestSearch(false);
  });

  function requestSearch(immediate) {
    clearTimeout(debounceTimer);
    const send = () => vscode.postMessage({ type: 'search', query, filters });
    if (immediate) send();
    else debounceTimer = setTimeout(send, 120); // render debounce only; search is local + instant
  }

  function renderFilters() {
    filterBar.innerHTML = '';
    const groups = [
      { key: 'kind', label: 'All', value: undefined, active: () => filters.kind === undefined && filters.tier === undefined && !filters.category },
      { key: 'kind', label: 'Skills', value: 'skill', active: () => filters.kind === 'skill' },
      { key: 'kind', label: 'Plugins', value: 'plugin', active: () => filters.kind === 'plugin' },
      { key: 'tier', label: '✓ Verified', value: 'verified', active: () => filters.tier === 'verified' },
      { key: 'tier', label: 'Community', value: 'community', active: () => filters.tier === 'community' }
    ];
    for (const c of facets.categories) {
      groups.push({ key: 'category', label: c, value: c, active: () => filters.category === c });
    }
    for (const g of groups) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (g.active() ? ' active' : '');
      chip.textContent = g.label;
      chip.addEventListener('click', () => {
        if (g.label === 'All') {
          filters = {};
        } else if (filters[g.key] === g.value) {
          delete filters[g.key];
        } else {
          filters[g.key] = g.value;
        }
        renderFilters();
        requestSearch(true);
      });
      filterBar.appendChild(chip);
    }
  }

  function render() {
    content.innerHTML = '';
    const hasQueryOrFilter = query.trim().length > 0 || Object.keys(filters).length > 0;

    // Suggested section (only when not actively searching/filtering).
    if (!hasQueryOrFilter && suggestedIds.length) {
      const sec = sectionEl('Suggested for this workspace');
      for (const id of suggestedIds) {
        const item = itemsById.get(id);
        if (item) sec.appendChild(rowEl(item, reasons[id] || []));
      }
      content.appendChild(sec);
    }

    const title = hasQueryOrFilter ? `Results (${resultIds.length})` : `All skills & plugins (${resultIds.length})`;
    const sec = sectionEl(title);
    if (resultIds.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.padding = '12px 4px';
      p.textContent = itemsById.size === 0
        ? 'Catalog is empty. Click Refresh to load the index.'
        : 'No matches. Try a different term or clear filters.';
      sec.appendChild(p);
    } else {
      for (const id of resultIds) {
        const item = itemsById.get(id);
        if (item) sec.appendChild(rowEl(item, []));
      }
    }
    content.appendChild(sec);
    updateFooter();
  }

  function updateFooter() {
    installBtn.disabled = selected.size === 0;
    installBtn.textContent = `Install ${selected.size}`;
    summary.textContent = `${facets.counts.skills} skills · ${facets.counts.plugins} plugins · ${facets.counts.verified} verified · ${selected.size} selected`;
  }

  function sectionEl(title) {
    const wrap = document.createElement('div');
    wrap.className = 'section';
    const h = document.createElement('h2');
    h.textContent = title;
    wrap.appendChild(h);
    return wrap;
  }

  function badge(text, cls) {
    const span = document.createElement('span');
    span.className = 'badge ' + cls;
    span.textContent = text;
    return span;
  }

  function rowEl(item, itemReasons) {
    const row = document.createElement('div');
    row.className = 'row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(item.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(item.id);
      else selected.delete(item.id);
      updateFooter();
    });

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = item.name;
    title.appendChild(nameEl);
    title.appendChild(badge(item.kind, 'kind'));
    if (item.tier === 'verified') title.appendChild(badge('✓ Verified', 'verified'));
    else if (item.tier === 'community') title.appendChild(badge('Community', 'community'));
    if (typeof item.stars === 'number' && item.stars > 0) title.appendChild(badge('★ ' + item.stars, 'stars'));

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = item.description || (item.whenToUse || '');
    desc.title = desc.textContent;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.sourceRepo;
    a.addEventListener('click', (e) => { e.preventDefault(); vscode.postMessage({ type: 'open-github', url: item.sourceUrl }); });
    meta.appendChild(a);
    if (item.category) meta.appendChild(badge(item.category, 'cat'));
    for (const t of (item.tags || []).slice(0, 3)) meta.appendChild(badge(t, 'tag'));

    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);
    body.appendChild(meta);

    if (itemReasons && itemReasons.length) {
      const rWrap = document.createElement('div');
      rWrap.className = 'reasons';
      for (const r of itemReasons) {
        const tag = document.createElement('span');
        tag.className = 'reason';
        tag.textContent = r;
        rWrap.appendChild(tag);
      }
      body.appendChild(rWrap);
    }

    const installOne = document.createElement('button');
    installOne.className = 'ghost row-install';
    installOne.textContent = 'Install';
    installOne.addEventListener('click', () => vscode.postMessage({ type: 'install', ids: [item.id] }));

    row.appendChild(cb);
    row.appendChild(body);
    row.appendChild(installOne);
    return row;
  }
})();
