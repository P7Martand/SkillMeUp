(function () {
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const summary = document.getElementById('summary');
  const installBtn = document.getElementById('install');
  const cancelBtn = document.getElementById('cancel');
  const refreshBtn = document.getElementById('refresh');
  const addSourceBtn = document.getElementById('add-source');
  const searchInput = document.getElementById('search');

  /** @type {{suggested: Array<{item: any, reasons: string[]}>, others: any[]}} */
  let state = { suggested: [], others: [] };
  let filter = '';
  const selected = new Set();

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      state = msg.data;
      // pre-check suggested items
      selected.clear();
      for (const s of state.suggested) selected.add(s.item.id);
      render();
    } else if (msg.type === 'install:done') {
      // Visually unselect items that installed cleanly.
      for (const r of msg.results) {
        if (r.status === 'installed') selected.delete(r.item.id);
      }
      render();
    }
  });

  installBtn.addEventListener('click', () => {
    if (selected.size === 0) return;
    vscode.postMessage({ type: 'install', ids: [...selected] });
  });
  cancelBtn.addEventListener('click', () => {
    selected.clear();
    render();
  });
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  addSourceBtn.addEventListener('click', () => vscode.postMessage({ type: 'add-source' }));
  searchInput.addEventListener('input', () => {
    filter = searchInput.value.trim().toLowerCase();
    render();
  });

  function render() {
    const filterFn = (item) => {
      if (!filter) return true;
      const hay = `${item.name} ${item.description || ''} ${item.sourceRepo}`.toLowerCase();
      return hay.includes(filter);
    };

    const suggested = state.suggested.filter((r) => filterFn(r.item));
    const others = state.others.filter(filterFn);

    content.innerHTML = '';

    if (suggested.length === 0 && others.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.padding = '12px 16px';
      p.textContent = filter
        ? 'No items match your filter.'
        : 'Nothing in the catalog yet. Click Refresh to fetch sources.';
      content.appendChild(p);
      updateFooter();
      return;
    }

    if (suggested.length) {
      const section = sectionEl('Suggested for this workspace');
      for (const r of suggested) section.appendChild(rowEl(r.item, r.reasons));
      content.appendChild(section);
    }
    if (others.length) {
      const section = sectionEl(`All catalog (${others.length})`);
      for (const item of others) section.appendChild(rowEl(item, []));
      content.appendChild(section);
    }
    updateFooter();
  }

  function updateFooter() {
    installBtn.disabled = selected.size === 0;
    installBtn.textContent = `Install ${selected.size}`;
    const totalSkills = state.suggested.filter((r) => r.item.kind === 'skill').length +
      state.others.filter((i) => i.kind === 'skill').length;
    const totalPlugins = state.suggested.filter((r) => r.item.kind === 'plugin').length +
      state.others.filter((i) => i.kind === 'plugin').length;
    summary.textContent = `${totalSkills} skills · ${totalPlugins} plugins · ${selected.size} selected`;
  }

  function sectionEl(title) {
    const wrap = document.createElement('div');
    wrap.className = 'section';
    const h = document.createElement('h2');
    h.textContent = title;
    wrap.appendChild(h);
    return wrap;
  }

  function rowEl(item, reasons) {
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
    nameEl.textContent = item.name;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = item.kind;
    title.appendChild(nameEl);
    title.appendChild(kind);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = item.description || (item.whenToUse || '');
    desc.title = desc.textContent;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.sourceRepo;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'open-github', url: item.sourceUrl });
    });
    meta.appendChild(a);

    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);
    body.appendChild(meta);

    if (reasons && reasons.length) {
      const rWrap = document.createElement('div');
      rWrap.className = 'reasons';
      for (const r of reasons) {
        const tag = document.createElement('span');
        tag.className = 'reason';
        tag.textContent = r;
        rWrap.appendChild(tag);
      }
      body.appendChild(rWrap);
    }

    row.appendChild(cb);
    row.appendChild(body);
    return row;
  }
})();
