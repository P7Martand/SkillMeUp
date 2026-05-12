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

  // GitHub search state: idle | loading | results | error
  let gh = { status: 'idle', results: [], error: '' };
  let ghTimer = null;

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      state = msg.data;
      selected.clear();
      for (const s of state.suggested) selected.add(s.item.id);
      // Re-run GitHub search if filter is active and we have no local matches.
      gh = { status: 'idle', results: [], error: '' };
      maybeScheduleGitHubSearch();
      render();
    } else if (msg.type === 'install:done') {
      for (const r of msg.results) {
        if (r.status === 'installed') selected.delete(r.item.id);
      }
      render();
    } else if (msg.type === 'github-results') {
      gh = { status: 'results', results: msg.results, error: '' };
      render();
    } else if (msg.type === 'github-error') {
      gh = { status: 'error', results: [], error: msg.message };
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
    clearTimeout(ghTimer);
    gh = { status: 'idle', results: [], error: '' };
    render();
    maybeScheduleGitHubSearch();
  });

  function maybeScheduleGitHubSearch() {
    if (filter.length <= 2) return;
    clearTimeout(ghTimer);
    ghTimer = setTimeout(() => {
      if (!hasLocalResults()) {
        gh = { status: 'loading', results: [], error: '' };
        render();
        vscode.postMessage({ type: 'search-github', query: filter });
      }
    }, 800);
  }

  function hasLocalResults() {
    const fn = makeFilterFn();
    return state.suggested.some((r) => fn(r.item)) || state.others.some(fn);
  }

  function makeFilterFn() {
    return (item) => {
      if (!filter) return true;
      const hay = `${item.name} ${item.description || ''} ${item.sourceRepo}`.toLowerCase();
      return hay.includes(filter);
    };
  }

  function render() {
    const filterFn = makeFilterFn();
    const suggested = state.suggested.filter((r) => filterFn(r.item));
    const others = state.others.filter(filterFn);
    const hasLocal = suggested.length > 0 || others.length > 0;
    const canSearchGitHub = filter.length > 2;

    content.innerHTML = '';

    // Local results
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

    // Empty-state messages
    if (!hasLocal) {
      if (!filter) {
        appendMuted('Nothing in the catalog yet. Click Refresh to fetch sources.');
      } else if (!canSearchGitHub) {
        appendMuted('No items match your filter.');
      }
      // When canSearchGitHub and no local results: GitHub section below handles messaging.
    }

    // GitHub search section
    if (canSearchGitHub) {
      if (gh.status !== 'idle') {
        renderGitHubSection();
      } else if (!hasLocal) {
        // Debounce timer hasn't fired yet — show a soft hint.
        appendMuted('No local matches — searching GitHub…');
      }
    }

    updateFooter();
  }

  function appendMuted(text) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.style.padding = '12px 16px';
    p.textContent = text;
    content.appendChild(p);
  }

  function renderGitHubSection() {
    const section = sectionEl('From GitHub');

    if (gh.status === 'loading') {
      const p = document.createElement('p');
      p.className = 'muted gh-loading';
      p.textContent = 'Searching GitHub…';
      section.appendChild(p);
    } else if (gh.status === 'error') {
      const p = document.createElement('p');
      p.className = 'gh-error';
      p.textContent = gh.error;
      section.appendChild(p);
    } else if (gh.status === 'results') {
      if (gh.results.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.style.padding = '8px 4px';
        p.textContent = 'No skills found on GitHub for this query.';
        section.appendChild(p);
      } else {
        for (const r of gh.results) section.appendChild(ghRowEl(r));
      }
    }

    content.appendChild(section);
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

  function ghRowEl(result) {
    const row = document.createElement('div');
    row.className = 'row gh-row';

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    const nameEl = document.createElement('span');
    nameEl.textContent = result.repo;
    const stars = document.createElement('span');
    stars.className = 'kind gh-stars';
    stars.textContent = `★ ${result.stars}`;
    title.appendChild(nameEl);
    title.appendChild(stars);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = result.description || result.fullName;
    desc.title = desc.textContent;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = result.fullName;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'open-github', url: result.url });
    });
    meta.appendChild(a);

    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);
    body.appendChild(meta);

    const addBtn = document.createElement('button');
    addBtn.className = 'ghost gh-add';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
      addBtn.disabled = true;
      addBtn.textContent = 'Adding…';
      vscode.postMessage({ type: 'add-github-source', url: result.url });
    });

    row.appendChild(body);
    row.appendChild(addBtn);
    return row;
  }
})();
