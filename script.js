/**
 * GAMEVAULT — script.js
 * Game tracking app powered by RAWG API
 * =======================================
 * SETUP: Replace YOUR_API_KEY below with your RAWG API key.
 * Get one free at: https://rawg.io/apidocs
 */

// ============================================================
//  CONFIG
// ============================================================
const API_KEY  = 'YOUR_API_KEY'; // <-- Replace with your RAWG API key
const BASE_URL = 'https://api.rawg.io/api';

// ============================================================
//  STATE
// ============================================================
let currentView     = 'home';
let currentPage     = 1;
let currentGenre    = '';
let currentOrdering = '-rating';
let hasNextPage     = false;
let isLoading       = false;
let searchDebounce  = null;

// ============================================================
//  LOCAL STORAGE HELPERS
// ============================================================

/** Get the full user library object from localStorage */
function getLibrary() {
  return JSON.parse(localStorage.getItem('gv_library') || '{}');
}

/** Save the full user library object to localStorage */
function saveLibrary(lib) {
  localStorage.setItem('gv_library', JSON.stringify(lib));
}

/** Get current username (or null if not set) */
function getUsername() {
  return localStorage.getItem('gv_username') || null;
}

/** Save username to localStorage */
function saveUsername(name) {
  localStorage.setItem('gv_username', name);
}

/** Get a single game's saved data from library */
function getGameData(gameId) {
  const lib = getLibrary();
  return lib[gameId] || null;
}

/** Save data for a single game (status, rating, cover, title) */
function saveGameData(gameId, data) {
  const lib = getLibrary();
  lib[gameId] = { ...lib[gameId], ...data };
  saveLibrary(lib);
}

/** Remove a game entry from library */
function removeGame(gameId) {
  const lib = getLibrary();
  delete lib[gameId];
  saveLibrary(lib);
}

// ============================================================
//  RAWG API CALLS
// ============================================================

/**
 * Fetch popular / filtered games
 * @param {number} page - page number
 * @param {string} genre - genre id (empty = all)
 * @param {string} ordering - sort field
 */
async function fetchGames(page = 1, genre = '', ordering = '-rating') {
  const params = new URLSearchParams({
    key: API_KEY,
    page_size: 20,
    page,
    ordering,
  });
  if (genre) params.set('genres', genre);

  const res = await fetch(`${BASE_URL}/games?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Search games by query string
 * @param {string} query
 */
async function searchGames(query) {
  const params = new URLSearchParams({
    key: API_KEY,
    search: query,
    page_size: 24,
  });
  const res = await fetch(`${BASE_URL}/games?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch full detail for a single game
 * @param {number|string} id - RAWG game id
 */
async function fetchGameDetail(id) {
  const res = await fetch(`${BASE_URL}/games/${id}?key=${API_KEY}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================

/**
 * Show a small toast notification
 * @param {string} msg - message text
 * @param {'info'|'success'|'error'} type
 */
function showToast(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').prepend(el);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ============================================================
//  NAVIGATION (VIEW SWITCHING)
// ============================================================

/** Show a view by id, hide others */
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId);
  if (el) el.classList.add('active');
  currentView = viewId.replace('-view', '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
//  RENDER HELPERS
// ============================================================

/**
 * Build HTML for a game card
 * @param {Object} game - RAWG game object
 */
function renderCard(game) {
  const saved     = getGameData(game.id);
  const userRating = saved?.rating || 0;
  const status    = saved?.status || '';

  // Status badge
  const statusLabels = { playing: '🎮 Playing', played: '✅ Played', plantoplay: '📋 Plan to Play' };
  const statusBadge = status
    ? `<div class="card-status-badge badge-${status}">${statusLabels[status]}</div>`
    : '';

  // RAWG rating badge
  const rawgRating = game.rating ? `⭐ ${game.rating.toFixed(1)}` : '';

  // User's rating indicator
  const userRatingHtml = userRating
    ? `<span class="card-user-rating">★ ${userRating}/10</span>`
    : '';

  // Cover image
  const imgHtml = game.background_image
    ? `<img src="${game.background_image}" alt="${escHtml(game.name)}" loading="lazy" />`
    : `<div class="card-img-placeholder">🎮</div>`;

  // Genres list (first 2)
  const genres = (game.genres || []).slice(0, 2).map(g => g.name).join(', ');

  const card = document.createElement('div');
  card.className = 'game-card';
  card.dataset.id = game.id;
  card.innerHTML = `
    <div class="card-img-wrap">
      ${imgHtml}
      ${statusBadge}
      ${rawgRating ? `<div class="card-rating-badge">${rawgRating}</div>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(game.name)}</div>
      <div class="card-meta">
        <span class="card-genres">${escHtml(genres || 'N/A')}</span>
        ${userRatingHtml}
      </div>
    </div>
  `;

  card.addEventListener('click', () => openDetailModal(game.id));
  return card;
}

/** HTML-escape a string to prevent XSS */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  HOME VIEW — LOAD GAMES
// ============================================================

/** Load games into the home grid */
async function loadGames(reset = false) {
  if (isLoading) return;

  if (reset) {
    currentPage = 1;
    document.getElementById('games-grid').innerHTML = '';
  }

  isLoading = true;
  const loadingEl  = document.getElementById('loading-indicator');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  loadingEl.style.display  = 'flex';
  loadMoreWrap.style.display = 'none';

  try {
    const data = await fetchGames(currentPage, currentGenre, currentOrdering);
    const grid = document.getElementById('games-grid');

    // Stagger card animations
    (data.results || []).forEach((game, i) => {
      const card = renderCard(game);
      card.style.animationDelay = `${i * 30}ms`;
      grid.appendChild(card);
    });

    hasNextPage = !!data.next;
    if (hasNextPage) loadMoreWrap.style.display = 'block';

  } catch (err) {
    console.error('Failed to load games:', err);
    showToast('Failed to load games. Check your API key.', 'error');
  } finally {
    isLoading = false;
    loadingEl.style.display = 'none';
  }
}

// ============================================================
//  SEARCH
// ============================================================

/** Execute a search and display results */
async function doSearch(query) {
  if (!query.trim()) return;

  showView('search-view');
  document.getElementById('search-query-label').textContent = `"${query}"`;
  document.getElementById('search-grid').innerHTML = '';
  document.getElementById('search-empty').style.display = 'none';

  const loadingEl = document.getElementById('search-loading');
  loadingEl.style.display = 'flex';

  try {
    const data = await searchGames(query.trim());
    const grid  = document.getElementById('search-grid');

    if (!data.results || data.results.length === 0) {
      document.getElementById('search-empty').style.display = 'block';
    } else {
      data.results.forEach((game, i) => {
        const card = renderCard(game);
        card.style.animationDelay = `${i * 25}ms`;
        grid.appendChild(card);
      });
    }
  } catch (err) {
    console.error('Search error:', err);
    showToast('Search failed. Try again.', 'error');
  } finally {
    loadingEl.style.display = 'none';
  }
}

// ============================================================
//  DETAIL MODAL
// ============================================================

/** Open the detail modal for a given game id */
async function openDetailModal(gameId) {
  const overlay = document.getElementById('detail-modal');
  const inner   = document.getElementById('detail-inner');

  overlay.style.display = 'flex';
  inner.innerHTML = `
    <div class="loading-wrap" style="padding: 4rem;">
      <div class="spinner"></div>
      <span>Loading game details...</span>
    </div>
  `;

  try {
    const game = await fetchGameDetail(gameId);
    renderDetailModal(game);
  } catch (err) {
    console.error('Detail error:', err);
    inner.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>Failed to load details.</p></div>`;
  }
}

/**
 * Render the detail modal with game data
 * @param {Object} game - full RAWG game object
 */
function renderDetailModal(game) {
  const inner   = document.getElementById('detail-inner');
  const saved   = getGameData(game.id);
  const curStatus = saved?.status || '';
  const curRating = saved?.rating || 0;

  // Strip HTML tags from description
  const description = game.description
    ? game.description.replace(/<[^>]+>/g, '').trim()
    : 'No description available.';

  // Genres and platforms
  const genres = (game.genres || []).map(g => g.name).join(', ') || 'N/A';
  const platforms = (game.platforms || []).slice(0, 4).map(p => p.platform.name).join(', ') || 'N/A';

  // Release date
  const releaseDate = game.released
    ? new Date(game.released).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
    : 'TBA';

  // Cover image
  const coverHtml = game.background_image
    ? `<img src="${game.background_image}" alt="${escHtml(game.name)}" />`
    : `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;background:var(--bg-surface)">🎮</div>`;

  // Status buttons
  const statuses = [
    { key: 'playing',    label: '🎮 Playing',      cls: 'active-playing' },
    { key: 'played',     label: '✅ Played',        cls: 'active-played' },
    { key: 'plantoplay', label: '📋 Plan to Play',  cls: 'active-plantoplay' },
  ];

  const statusBtns = statuses.map(s => `
    <button class="list-btn ${curStatus === s.key ? s.cls : ''}"
            data-status="${s.key}" id="btn-status-${s.key}">
      ${s.label}
    </button>
  `).join('');

  // Star rating HTML
  const starsHtml = Array.from({length: 10}, (_, i) => `
    <span class="star ${i < curRating ? 'lit' : ''}" data-value="${i+1}" title="${i+1}/10">★</span>
  `).join('');

  inner.innerHTML = `
    <div class="detail-hero">
      ${coverHtml}
      <div class="detail-hero-overlay"></div>
    </div>
    <div class="detail-body">
      <div class="detail-title">${escHtml(game.name)}</div>

      <div class="detail-tags">
        ${(game.genres || []).map(g => `<span class="detail-tag">${escHtml(g.name)}</span>`).join('')}
      </div>

      <div class="detail-stats">
        <div class="stat-card">
          <div class="stat-label">RAWG Rating</div>
          <div class="stat-value" style="color:var(--gold)">⭐ ${game.rating?.toFixed(1) || 'N/A'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Release Date</div>
          <div class="stat-value">${escHtml(releaseDate)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Metacritic</div>
          <div class="stat-value" style="color:${game.metacritic >= 75 ? '#00c864' : game.metacritic >= 50 ? 'var(--gold)' : 'var(--accent2)'}">${game.metacritic || 'N/A'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Platforms</div>
          <div class="stat-value" style="font-size:0.8rem;color:var(--text-secondary)">${escHtml(platforms)}</div>
        </div>
      </div>

      <div class="detail-desc" id="detail-desc">${escHtml(description)}</div>
      <button class="desc-toggle" id="desc-toggle">Show more ▾</button>

      <div class="detail-actions">
        <div>
          <div class="rating-label" style="margin-bottom:0.5rem">Add to list:</div>
          <div class="list-btn-group" id="status-btn-group">
            ${statusBtns}
            ${curStatus ? `<button class="btn-danger" id="btn-remove-list">Remove</button>` : ''}
          </div>
        </div>

        <div class="rating-section">
          <span class="rating-label">Your Rating:</span>
          <div class="star-rating" id="star-rating-container">
            ${starsHtml}
          </div>
          <span class="rating-score-display" id="rating-score-display">
            ${curRating ? `${curRating}/10` : '—'}
          </span>
        </div>
      </div>
    </div>
  `;

  // Save basic info for library use (needed even before user interacts)
  const basicInfo = {
    title: game.name,
    cover: game.background_image || '',
    genres: genres,
    release: game.released || '',
  };

  // ── Description toggle ──────────────────────
  const descEl    = document.getElementById('detail-desc');
  const toggleBtn = document.getElementById('desc-toggle');
  if (description.length < 200) toggleBtn.style.display = 'none';

  toggleBtn.addEventListener('click', () => {
    const expanded = descEl.classList.toggle('expanded');
    toggleBtn.textContent = expanded ? 'Show less ▴' : 'Show more ▾';
  });

  // ── Status buttons ──────────────────────────
  document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      const prevStatus = getGameData(game.id)?.status;

      saveGameData(game.id, { ...basicInfo, status });
      showToast(`Added to "${status === 'plantoplay' ? 'Plan to Play' : status.charAt(0).toUpperCase() + status.slice(1)}"!`, 'success');

      // Refresh button states
      document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(b => {
        b.className = 'list-btn';
        if (b.dataset.status === status) {
          b.classList.add(`active-${status}`);
        }
      });

      // Add/refresh remove button
      let removeBtn = document.getElementById('btn-remove-list');
      if (!removeBtn) {
        removeBtn = document.createElement('button');
        removeBtn.className = 'btn-danger';
        removeBtn.id = 'btn-remove-list';
        removeBtn.textContent = 'Remove';
        document.getElementById('status-btn-group').appendChild(removeBtn);
        removeBtn.addEventListener('click', () => removeFromList(game.id));
      }

      refreshGridCards(game.id);
    });
  });

  // ── Remove from list ────────────────────────
  const removeBtn = document.getElementById('btn-remove-list');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => removeFromList(game.id));
  }

  function removeFromList(id) {
    removeGame(id);
    showToast('Removed from library', 'info');
    document.querySelectorAll(`#status-btn-group .list-btn[data-status]`).forEach(b => b.className = 'list-btn');
    document.getElementById('btn-remove-list')?.remove();
    refreshGridCards(id);
  }

  // ── Star rating ─────────────────────────────
  const stars       = document.querySelectorAll('#star-rating-container .star');
  const scoreDisplay = document.getElementById('rating-score-display');
  let savedRating    = curRating;

  stars.forEach(star => {
    const val = parseInt(star.dataset.value);

    star.addEventListener('mouseenter', () => {
      stars.forEach((s, i) => s.classList.toggle('lit', i < val));
    });

    star.addEventListener('mouseleave', () => {
      stars.forEach((s, i) => s.classList.toggle('lit', i < savedRating));
    });

    star.addEventListener('click', () => {
      savedRating = val;
      saveGameData(game.id, { ...basicInfo, rating: val });
      scoreDisplay.textContent = `${val}/10`;
      stars.forEach((s, i) => s.classList.toggle('lit', i < val));
      showToast(`Rated ${val}/10 ⭐`, 'success');
      refreshGridCards(game.id);
    });
  });
}

/**
 * Re-render all visible cards for a given game id
 * (to reflect status / rating changes without full reload)
 */
function refreshGridCards(gameId) {
  document.querySelectorAll(`.game-card[data-id="${gameId}"]`).forEach(card => {
    const saved      = getGameData(gameId);
    const status     = saved?.status || '';
    const userRating = saved?.rating || 0;

    const statusLabels = { playing: '🎮 Playing', played: '✅ Played', plantoplay: '📋 Plan to Play' };

    // Update status badge
    let badge = card.querySelector('.card-status-badge');
    if (status) {
      if (!badge) {
        badge = document.createElement('div');
        card.querySelector('.card-img-wrap').appendChild(badge);
      }
      badge.className = `card-status-badge badge-${status}`;
      badge.textContent = statusLabels[status];
    } else if (badge) {
      badge.remove();
    }

    // Update user rating
    let ratingEl = card.querySelector('.card-user-rating');
    if (userRating) {
      if (!ratingEl) {
        ratingEl = document.createElement('span');
        ratingEl.className = 'card-user-rating';
        card.querySelector('.card-meta').appendChild(ratingEl);
      }
      ratingEl.textContent = `★ ${userRating}/10`;
    } else if (ratingEl) {
      ratingEl.remove();
    }
  });
}

// ============================================================
//  MY LIST VIEW
// ============================================================

/** Render the user's library in the My List view */
function renderMyList(activeTab = 'playing') {
  const lib   = getLibrary();
  const uname = getUsername() || 'Guest';

  document.getElementById('mylist-username-label').textContent = `${uname}'s Game Library`;

  // Stats
  const counts = { playing: 0, played: 0, plantoplay: 0 };
  Object.values(lib).forEach(g => { if (g.status) counts[g.status] = (counts[g.status] || 0) + 1; });

  document.getElementById('mylist-stats').innerHTML = `
    <div class="mylist-stat">
      <div class="mylist-stat-num">${counts.playing}</div>
      <div class="mylist-stat-label">Playing</div>
    </div>
    <div class="mylist-stat">
      <div class="mylist-stat-num">${counts.played}</div>
      <div class="mylist-stat-label">Played</div>
    </div>
    <div class="mylist-stat">
      <div class="mylist-stat-num">${counts.plantoplay}</div>
      <div class="mylist-stat-label">Plan to Play</div>
    </div>
  `;

  // Filter by active tab
  const filtered = Object.entries(lib).filter(([, g]) => g.status === activeTab);
  const content  = document.getElementById('mylist-content');
  const emptyEl  = document.getElementById('mylist-empty');

  if (filtered.length === 0) {
    content.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  content.innerHTML = '';

  filtered.forEach(([id, game], i) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.animationDelay = `${i * 40}ms`;

    const ratingHtml = game.rating
      ? `<span class="list-item-rating">★ ${game.rating}</span>`
      : `<span style="color:var(--text-muted);font-size:0.8rem">No rating</span>`;

    const imgHtml = game.cover
      ? `<img class="list-item-img" src="${game.cover}" alt="${escHtml(game.title)}" loading="lazy" />`
      : `<div class="list-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem">🎮</div>`;

    item.innerHTML = `
      ${imgHtml}
      <div class="list-item-info">
        <div class="list-item-title">${escHtml(game.title || 'Unknown Game')}</div>
        <div class="list-item-meta">${escHtml(game.genres || '')} ${game.release ? '· ' + new Date(game.release).getFullYear() : ''}</div>
      </div>
      <div class="list-item-actions">
        ${ratingHtml}
        <button class="btn-outline" style="padding:0.4rem 0.8rem;font-size:0.8rem;" data-detail-id="${id}">View</button>
        <button class="btn-danger" data-remove-id="${id}">Remove</button>
      </div>
    `;

    // View detail
    item.querySelector('[data-detail-id]').addEventListener('click', () => openDetailModal(id));

    // Remove
    item.querySelector('[data-remove-id]').addEventListener('click', () => {
      removeGame(id);
      showToast('Removed from library', 'info');
      renderMyList(activeTab);
    });

    content.appendChild(item);
  });
}

// ============================================================
//  USERNAME MODAL
// ============================================================

/** Show the username prompt modal */
function showUsernameModal() {
  document.getElementById('username-modal').style.display = 'flex';
}

/** Hide the username prompt modal */
function hideUsernameModal() {
  document.getElementById('username-modal').style.display = 'none';
}

/** Update navbar username display */
function updateNavUsername() {
  const uname = getUsername();
  if (uname) {
    document.getElementById('username-display').textContent = uname;
    document.getElementById('user-avatar-nav').textContent  = uname.charAt(0).toUpperCase();
  } else {
    document.getElementById('username-display').textContent = 'Guest';
    document.getElementById('user-avatar-nav').textContent  = '?';
  }
}

// ============================================================
//  BOOTSTRAP / EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // ── Username check ──────────────────────────
  if (!getUsername()) {
    showUsernameModal();
  }
  updateNavUsername();

  // Save username
  document.getElementById('username-save-btn').addEventListener('click', () => {
    const val = document.getElementById('username-input').value.trim();
    if (val) {
      saveUsername(val);
      updateNavUsername();
      hideUsernameModal();
      showToast(`Welcome, ${val}! 🎮`, 'success');
    }
  });

  document.getElementById('username-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('username-save-btn').click();
  });

  // Click username chip to allow rename
  document.getElementById('user-chip').addEventListener('click', showUsernameModal);

  // ── Navigation ──────────────────────────────
  document.getElementById('nav-home').addEventListener('click', () => {
    showView('home-view');
    document.getElementById('search-input').value = '';
  });

  document.getElementById('logo-btn').addEventListener('click', e => {
    e.preventDefault();
    showView('home-view');
    document.getElementById('search-input').value = '';
  });

  document.getElementById('nav-mylist').addEventListener('click', () => {
    showView('mylist-view');
    renderMyList('playing');
  });

  document.getElementById('go-browse')?.addEventListener('click', () => {
    showView('home-view');
  });

  // ── Search ──────────────────────────────────
  const searchInput = document.getElementById('search-input');

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (!q) {
      showView('home-view');
      return;
    }
    searchDebounce = setTimeout(() => doSearch(q), 450);
  });

  document.getElementById('search-btn').addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (q) doSearch(q);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if (q) doSearch(q);
    }
  });

  // ── Genre pills ─────────────────────────────
  document.getElementById('genre-pills').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;

    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentGenre = pill.dataset.genre;
    loadGames(true);
  });

  // ── Sort select ─────────────────────────────
  document.getElementById('sort-select').addEventListener('change', e => {
    currentOrdering = e.target.value;
    loadGames(true);
  });

  // ── Load more ───────────────────────────────
  document.getElementById('load-more-btn').addEventListener('click', () => {
    currentPage++;
    loadGames(false);
  });

  // ── Detail modal close ──────────────────────
  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-modal').style.display = 'none';
  });

  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-modal')) {
      document.getElementById('detail-modal').style.display = 'none';
    }
  });

  // ── My List tabs ────────────────────────────
  document.querySelectorAll('.list-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderMyList(tab.dataset.tab);
    });
  });

  // ── Keyboard shortcut: Escape closes modal ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('detail-modal').style.display = 'none';
      document.getElementById('username-modal').style.display = 'none';
    }
  });

  // ── Initial load ────────────────────────────
  showView('home-view');
  loadGames(true);
});
