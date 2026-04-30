/**
 * GAMEMBRANCE — script.js
 * Game tracking app powered by RAWG API
 * =======================================
 */

// ============================================================
//  CONFIG
// ============================================================
const API_KEY  = 'c92ac207cd104660b10bcfda826ee538';
const BASE_URL = 'https://api.rawg.io/api';

// ============================================================
//  STATE
// ============================================================
let currentView      = 'home';
let currentPage      = 1;
let currentGenre     = '';
let currentOrdering  = '-rating';
let currentAgeRating = '';   // RAWG esrb_rating id
let hasNextPage      = false;
let isLoading        = false;
let searchDebounce   = null;

// ============================================================
//  LOCAL STORAGE HELPERS
// ============================================================

function getLibrary() {
  return JSON.parse(localStorage.getItem('gv_library') || '{}');
}

function saveLibrary(lib) {
  localStorage.setItem('gv_library', JSON.stringify(lib));
}

function getUsername() {
  return localStorage.getItem('gv_username') || null;
}

function saveUsername(name) {
  localStorage.setItem('gv_username', name);
}

function getGameData(gameId) {
  const lib = getLibrary();
  return lib[gameId] || null;
}

function saveGameData(gameId, data) {
  const lib = getLibrary();
  lib[gameId] = { ...lib[gameId], ...data };
  saveLibrary(lib);
}

function removeGame(gameId) {
  const lib = getLibrary();
  delete lib[gameId];
  saveLibrary(lib);
}

// ============================================================
//  DATE HELPERS
// ============================================================

function getTodayStr() {
  const d = new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${lastDay}` };
}

function getYearRange() {
  const y = new Date().getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function getMonthName() {
  return new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
}

function getYear() {
  return new Date().getFullYear();
}

// ============================================================
//  RAWG API CALLS
// ============================================================

async function fetchGames(page = 1, genre = '', ordering = '-rating', ageRating = '') {
  const params = new URLSearchParams({
    key: API_KEY,
    page_size: 20,
    page,
    ordering,
  });
  if (genre) params.set('genres', genre);
  if (ageRating) params.set('esrb_rating', ageRating);

  const res = await fetch(`${BASE_URL}/games?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function searchGames(query, ordering = '-rating', ageRating = '') {
  const params = new URLSearchParams({
    key: API_KEY,
    search: query,
    page_size: 24,
    ordering,
  });
  if (ageRating) params.set('esrb_rating', ageRating);
  // Only show Adults Only content when explicitly selected; otherwise exclude it
  if (!ageRating) params.set('exclude_additions', 'true');
  const res = await fetch(`${BASE_URL}/games?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function fetchGameDetail(id) {
  const res = await fetch(`${BASE_URL}/games/${id}?key=${API_KEY}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch best game for a date range (by rating)
 */
async function fetchBestInRange(dateStart, dateEnd) {
  const params = new URLSearchParams({
    key: API_KEY,
    page_size: 5,
    ordering: '-rating',
    dates: `${dateStart},${dateEnd}`,
    ratings_count: 1,
  });
  const res = await fetch(`${BASE_URL}/games?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch recently updated games (sorted by updated date)
 */
async function fetchRecentlyUpdated() {
  const params = new URLSearchParams({
    key: API_KEY,
    page_size: 12,
    ordering: '-updated',
  });
  const res = await fetch(`${BASE_URL}/games?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================

function showToast(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').prepend(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ============================================================
//  NAVIGATION
// ============================================================

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

function renderCard(game) {
  const saved      = getGameData(game.id);
  const userRating = saved?.rating || 0;
  const status     = saved?.status || '';

  const statusLabels = { playing: '🎮 Playing', played: '✅ Played', plantoplay: '📋 Plan to Play' };
  const statusBadge = status
    ? `<div class="card-status-badge badge-${status}">${statusLabels[status]}</div>`
    : '';

  const rawgRating = game.rating ? `⭐ ${game.rating.toFixed(1)}` : '';
  const userRatingHtml = userRating
    ? `<span class="card-user-rating">★ ${userRating}/10</span>`
    : '';

  const imgHtml = game.background_image
    ? `<img src="${game.background_image}" alt="${escHtml(game.name)}" loading="lazy" />`
    : `<div class="card-img-placeholder">🎮</div>`;

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

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  SPOTLIGHT: BEST TODAY / MONTH / YEAR
// ============================================================

/**
 * Render a spotlight mini-card inside a container
 */
function renderSpotlightGame(game, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!game) {
    el.innerHTML = `<div class="spotlight-empty">No data available for this period.</div>`;
    return;
  }

  const img = game.background_image
    ? `<img src="${game.background_image}" alt="${escHtml(game.name)}" class="spotlight-img" loading="lazy" />`
    : `<div class="spotlight-img spotlight-img-placeholder">🎮</div>`;

  const rating = game.rating ? `⭐ ${game.rating.toFixed(1)}` : 'N/A';
  const year   = game.released ? new Date(game.released).getFullYear() : '';
  const genres = (game.genres || []).slice(0, 2).map(g => g.name).join(' · ') || '';

  el.innerHTML = `
    <div class="spotlight-game" data-id="${game.id}">
      ${img}
      <div class="spotlight-info">
        <div class="spotlight-game-title">${escHtml(game.name)}</div>
        <div class="spotlight-game-meta">
          <span class="spotlight-rating">${rating}</span>
          ${genres ? `<span class="spotlight-genres">${escHtml(genres)}</span>` : ''}
          ${year ? `<span class="spotlight-year">${year}</span>` : ''}
        </div>
      </div>
    </div>
  `;

  el.querySelector('.spotlight-game').addEventListener('click', () => openDetailModal(game.id));
}

async function loadSpotlights() {
  const today = getTodayStr();
  const month = getMonthRange();
  const year  = getYearRange();

  // Update labels
  const monthLabel = document.getElementById('spotlight-month-label');
  const yearLabel  = document.getElementById('spotlight-year-label');
  if (monthLabel) monthLabel.textContent = getMonthName();
  if (yearLabel)  yearLabel.textContent  = `Best of ${getYear()}`;

  // Load all 3 in parallel
  const [todayData, monthData, yearData] = await Promise.allSettled([
    fetchBestInRange(today, today),
    fetchBestInRange(month.start, month.end),
    fetchBestInRange(year.start, year.end),
  ]);

  // Today
  const todayGame = todayData.status === 'fulfilled' ? (todayData.value.results?.[0] || null) : null;
  renderSpotlightGame(todayGame, 'spotlight-today-content');

  // Month
  const monthGame = monthData.status === 'fulfilled' ? (monthData.value.results?.[0] || null) : null;
  renderSpotlightGame(monthGame, 'spotlight-month-content');

  // Year
  const yearGame = yearData.status === 'fulfilled' ? (yearData.value.results?.[0] || null) : null;
  renderSpotlightGame(yearGame, 'spotlight-year-content');
}

// ============================================================
//  RECENTLY UPDATED
// ============================================================

async function loadRecentlyUpdated() {
  const container = document.getElementById('recently-updated-grid');
  if (!container) return;

  container.innerHTML = `<div class="loading-wrap" style="padding:2rem;"><div class="spinner"></div><span>Loading updates...</span></div>`;

  try {
    const data = await fetchRecentlyUpdated();
    const games = data.results || [];

    if (!games.length) {
      container.innerHTML = `<div class="spotlight-empty">No recent updates found.</div>`;
      return;
    }

    container.innerHTML = '';
    games.forEach((game, i) => {
      const img = game.background_image
        ? `<img src="${game.background_image}" alt="${escHtml(game.name)}" loading="lazy" />`
        : `<div class="updated-card-placeholder">🎮</div>`;

      const updated = game.updated
        ? new Date(game.updated).toLocaleDateString('en-US', { month:'short', day:'numeric' })
        : '';

      const card = document.createElement('div');
      card.className = 'updated-card';
      card.style.animationDelay = `${i * 40}ms`;
      card.innerHTML = `
        <div class="updated-card-img">${img}</div>
        <div class="updated-card-body">
          <div class="updated-card-title">${escHtml(game.name)}</div>
          ${updated ? `<div class="updated-card-date">Updated ${updated}</div>` : ''}
          ${game.rating ? `<div class="updated-card-rating">⭐ ${game.rating.toFixed(1)}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => openDetailModal(game.id));
      container.appendChild(card);
    });

  } catch (err) {
    console.error('Failed to load recently updated:', err);
    container.innerHTML = `<div class="spotlight-empty">Failed to load updates.</div>`;
  }
}

// ============================================================
//  HOME VIEW — LOAD GAMES
// ============================================================

async function loadGames(reset = false) {
  if (isLoading) return;

  if (reset) {
    currentPage = 1;
    document.getElementById('games-grid').innerHTML = '';
  }

  isLoading = true;
  const loadingEl   = document.getElementById('loading-indicator');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  loadingEl.style.display   = 'flex';
  loadMoreWrap.style.display = 'none';

  try {
    const data = await fetchGames(currentPage, currentGenre, currentOrdering, currentAgeRating);
    const grid = document.getElementById('games-grid');

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

async function doSearch(query) {
  if (!query.trim()) return;

  const ordering  = document.getElementById('search-sort-select')?.value || '-rating';
  const ageRating = document.getElementById('search-age-filter')?.value || '';
  const isAdult   = ageRating === '5';

  showView('search-view');
  document.getElementById('search-query-label').textContent = `"${query}"`;
  document.getElementById('search-grid').innerHTML = '';
  document.getElementById('search-empty').style.display = 'none';

  // NSFW banner
  const nsfwBanner = document.getElementById('search-nsfw-banner');
  if (nsfwBanner) nsfwBanner.style.display = isAdult ? 'flex' : 'none';

  const loadingEl = document.getElementById('search-loading');
  loadingEl.style.display = 'flex';

  try {
    const data = await searchGames(query.trim(), ordering, ageRating);
    const grid  = document.getElementById('search-grid');

    // If NOT adult mode, client-side filter out Adults Only (esrb id 5)
    let results = data.results || [];
    if (!isAdult) {
      results = results.filter(g => !g.esrb_rating || g.esrb_rating.id !== 5);
    }

    if (!results.length) {
      document.getElementById('search-empty').style.display = 'block';
    } else {
      results.forEach((game, i) => {
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

async function openDetailModal(gameId) {
  // Custom game: show custom detail modal
  if (isCustomGame(gameId)) {
    openCustomDetailModal(gameId);
    return;
  }

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

function renderDetailModal(game) {
  const inner    = document.getElementById('detail-inner');
  const saved    = getGameData(game.id);
  const curStatus  = saved?.status || '';
  const curRating  = saved?.rating || 0;

  const description = game.description
    ? game.description.replace(/<[^>]+>/g, '').trim()
    : 'No description available.';

  const genres    = (game.genres || []).map(g => g.name).join(', ') || 'N/A';
  const platforms = (game.platforms || []).slice(0, 4).map(p => p.platform.name).join(', ') || 'N/A';

  const releaseDate = game.released
    ? new Date(game.released).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
    : 'TBA';

  const coverHtml = game.background_image
    ? `<img src="${game.background_image}" alt="${escHtml(game.name)}" />`
    : `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;background:var(--bg-surface)">🎮</div>`;

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

  const starsHtml = Array.from({length: 10}, (_, i) => `
    <span class="star ${i < curRating ? 'lit' : ''}" data-value="${i+1}" title="${i+1}/10">★</span>
  `).join('');

  const esrb = game.esrb_rating;
  const esrbMap = {
    'Everyone':        { label: 'Everyone',     color: '#4caf50', icon: 'E' },
    'Everyone 10+':    { label: 'Everyone 10+', color: '#8bc34a', icon: 'E10+' },
    'Teen':            { label: 'Teen',          color: '#ffd166', icon: 'T' },
    'Mature':          { label: 'Mature',        color: '#ff9800', icon: 'M' },
    'Adults Only':     { label: 'Adults Only',   color: '#ff3d6b', icon: 'AO' },
    'Rating Pending':  { label: 'Rating Pending',color: '#8890a8', icon: 'RP' },
  };
  const esrbInfo = esrb ? (esrbMap[esrb.name] || { label: esrb.name, color: '#8890a8', icon: '?' }) : null;
  const esrbHtml = esrbInfo
    ? `<div class="stat-card">
         <div class="stat-label">Age Rating</div>
         <div class="stat-value">
           <span class="esrb-badge" style="background:${esrbInfo.color}22;color:${esrbInfo.color};border-color:${esrbInfo.color}55;">
             <span class="esrb-icon">${esrbInfo.icon}</span>${escHtml(esrbInfo.label)}
           </span>
         </div>
       </div>`
    : `<div class="stat-card">
         <div class="stat-label">Age Rating</div>
         <div class="stat-value" style="color:var(--text-muted)">Not Rated</div>
       </div>`;

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
        ${esrbHtml}
      </div>

      <div class="detail-desc" id="detail-desc">${escHtml(description)}</div>
      <button class="desc-toggle" id="desc-toggle">Show more ▾</button>

      <div class="detail-actions">
        <div>
          <div class="rating-label" style="margin-bottom:0.5rem">Add to memory:</div>
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

      <!-- COMMENTS SECTION -->
      <div class="comments-section">
        <div class="comments-header">
          <span class="comments-title">💬 Komentar & Jurnal</span>
          <span class="comments-count" id="comments-count"></span>
        </div>
        <div class="comment-form">
          <textarea id="comment-input" placeholder="Tulis komentar, kesan, spoiler, atau jurnal bermain kamu..." rows="3" maxlength="1000"></textarea>
          <div class="comment-form-footer">
            <span class="comment-char-count" id="comment-char">0 / 1000</span>
            <button class="btn-primary comment-submit-btn" id="comment-submit">Kirim 💬</button>
          </div>
        </div>
        <div class="comments-list" id="comments-list"></div>
      </div>
    </div>
  `;

  const basicInfo = {
    title: game.name,
    cover: game.background_image || '',
    genres: genres,
    release: game.released || '',
  };

  // Description toggle
  const descEl    = document.getElementById('detail-desc');
  const toggleBtn = document.getElementById('desc-toggle');
  if (description.length < 200) toggleBtn.style.display = 'none';

  toggleBtn.addEventListener('click', () => {
    const expanded = descEl.classList.toggle('expanded');
    toggleBtn.textContent = expanded ? 'Show less ▴' : 'Show more ▾';
  });

  // Status buttons
  document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      saveGameData(game.id, { ...basicInfo, status });
      showToast(`Added to "${status === 'plantoplay' ? 'Plan to Play' : status.charAt(0).toUpperCase() + status.slice(1)}"!`, 'success');

      document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(b => {
        b.className = 'list-btn';
        if (b.dataset.status === status) {
          b.classList.add(`active-${status}`);
        }
      });

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

  const removeBtn = document.getElementById('btn-remove-list');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => removeFromList(game.id));
  }

  function removeFromList(id) {
    removeGame(id);
    showToast('Removed from memory', 'info');
    document.querySelectorAll(`#status-btn-group .list-btn[data-status]`).forEach(b => b.className = 'list-btn');
    document.getElementById('btn-remove-list')?.remove();
    refreshGridCards(id);
  }

  // Star rating
  const stars        = document.querySelectorAll('#star-rating-container .star');
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

  // Comments
  renderComments(game.id);
  setupCommentForm(game.id, getUsername() || 'Guest');
}

function refreshGridCards(gameId) {
  document.querySelectorAll(`.game-card[data-id="${gameId}"]`).forEach(card => {
    const saved      = getGameData(gameId);
    const status     = saved?.status || '';
    const userRating = saved?.rating || 0;

    const statusLabels = { playing: '🎮 Playing', played: '✅ Played', plantoplay: '📋 Plan to Play' };

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
//  MY MEMORY VIEW
// ============================================================

function renderMyList(activeTab = 'playing') {
  const lib   = getLibrary();
  const uname = getUsername() || 'Guest';

  document.getElementById('mylist-username-label').textContent = `${uname}'s Game Memory`;

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

    const customBadge = game.isCustom ? `<span style="font-size:0.72rem;background:var(--accent-glow);color:var(--accent);border:1px solid var(--border-accent);border-radius:99px;padding:0.15rem 0.55rem;margin-left:0.35rem;">✍️ Custom</span>` : '';

    item.innerHTML = `
      ${imgHtml}
      <div class="list-item-info">
        <div class="list-item-title">${escHtml(game.title || 'Unknown Game')}${customBadge}</div>
        <div class="list-item-meta">${escHtml(game.genres || '')} ${game.release ? '· ' + new Date(game.release).getFullYear() : game.year ? '· ' + game.year : ''}</div>
      </div>
      <div class="list-item-actions">
        ${ratingHtml}
        <button class="btn-outline" style="padding:0.4rem 0.8rem;font-size:0.8rem;" data-detail-id="${id}">View</button>
        <button class="btn-danger" data-remove-id="${id}">Remove</button>
      </div>
    `;

    item.querySelector('[data-detail-id]').addEventListener('click', () => openDetailModal(id));

    item.querySelector('[data-remove-id]').addEventListener('click', () => {
      removeGame(id);
      showToast('Removed from memory', 'info');
      renderMyList(activeTab);
    });

    content.appendChild(item);
  });
}

// ============================================================
//  USERNAME MODAL
// ============================================================

function showUsernameModal() {
  document.getElementById('username-modal').style.display = 'flex';
}

function hideUsernameModal() {
  document.getElementById('username-modal').style.display = 'none';
}

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
//  CUSTOM GAMES — LOCAL STORAGE HELPERS
// ============================================================

const CUSTOM_PREFIX = 'custom_';

function generateCustomId() {
  return CUSTOM_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function isCustomGame(id) {
  return String(id).startsWith(CUSTOM_PREFIX);
}

function getCustomGames() {
  return JSON.parse(localStorage.getItem('gv_custom_games') || '{}');
}

function saveCustomGames(games) {
  localStorage.setItem('gv_custom_games', JSON.stringify(games));
}

function saveCustomGame(id, data) {
  const games = getCustomGames();
  games[id] = { ...games[id], ...data, isCustom: true };
  saveCustomGames(games);
  // Also save to library
  saveGameData(id, { ...games[id] });
}

function getCustomGame(id) {
  return getCustomGames()[id] || null;
}

function deleteCustomGame(id) {
  const games = getCustomGames();
  delete games[id];
  saveCustomGames(games);
  removeGame(id);
}

// ============================================================
//  CUSTOM GAME MODAL
// ============================================================

let cgRating = 0;
let cgStatus = 'plantoplay';
let cgEditingId = null; // null = new, string = editing existing

function openCustomGameModal(editId = null) {
  cgRating = 0;
  cgStatus = 'plantoplay';
  cgEditingId = editId;
  cgCoverBase64 = '';

  // Reset form
  document.getElementById('cg-title').value = '';
  document.getElementById('cg-genres').value = '';
  document.getElementById('cg-year').value = '';
  document.getElementById('cg-platform').value = '';
  document.getElementById('cg-cover').value = '';
  document.getElementById('cg-notes').value = '';
  document.getElementById('cg-age-rating').value = '';
  document.getElementById('cg-rating-display').textContent = '—';

  // Clear validation errors
  document.querySelectorAll('.cg-field-error').forEach(el => el.classList.remove('cg-field-error'));
  document.querySelectorAll('.cg-error-msg').forEach(el => el.remove());

  // Reset cover preview
  const preview = document.getElementById('cg-cover-preview');
  if (preview) preview.innerHTML = `<span class="cover-preview-placeholder">🖼️<br><small>Preview</small></span>`;
  const fileInput = document.getElementById('cg-cover-file');
  if (fileInput) fileInput.value = '';

  // Build stars
  const starContainer = document.getElementById('cg-star-rating');
  starContainer.innerHTML = Array.from({length: 10}, (_, i) =>
    `<span class="star" data-value="${i+1}">★</span>`
  ).join('');
  setupCgStars();

  // Reset status buttons
  document.querySelectorAll('.cg-status-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.status === 'plantoplay');
  });

  // If editing, populate
  if (editId) {
    const game = getCustomGame(editId);
    if (game) {
      document.getElementById('cg-title').value = game.title || '';
      document.getElementById('cg-genres').value = game.genres || '';
      document.getElementById('cg-year').value = game.year || '';
      document.getElementById('cg-platform').value = game.platform || '';
      document.getElementById('cg-age-rating').value = game.ageRating || '';
      document.getElementById('cg-notes').value = game.notes || '';
      cgRating = game.rating || 0;
      cgStatus = game.status || 'plantoplay';
      document.getElementById('cg-rating-display').textContent = cgRating ? `${cgRating}/10` : '—';
      document.querySelectorAll('#cg-star-rating .star').forEach((s, i) => s.classList.toggle('lit', i < cgRating));
      document.querySelectorAll('.cg-status-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.status === cgStatus);
      });
      // Restore cover
      if (game.cover) {
        const isBase64 = game.cover.startsWith('data:');
        if (isBase64) {
          cgCoverBase64 = game.cover;
        } else {
          document.getElementById('cg-cover').value = game.cover;
        }
        if (preview) preview.innerHTML = `<img src="${game.cover}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);" />`;
      }
    }
  }

  setupCoverUpload();
  document.getElementById('custom-game-modal').style.display = 'flex';
  document.getElementById('cg-title').focus();
}

function closeCustomGameModal() {
  document.getElementById('custom-game-modal').style.display = 'none';
  cgEditingId = null;
}

function setupCgStars() {
  const stars = document.querySelectorAll('#cg-star-rating .star');
  const display = document.getElementById('cg-rating-display');

  stars.forEach(star => {
    const val = parseInt(star.dataset.value);
    star.addEventListener('mouseenter', () => {
      stars.forEach((s, i) => s.classList.toggle('lit', i < val));
    });
    star.addEventListener('mouseleave', () => {
      stars.forEach((s, i) => s.classList.toggle('lit', i < cgRating));
    });
    star.addEventListener('click', () => {
      cgRating = val;
      display.textContent = `${val}/10`;
      stars.forEach((s, i) => s.classList.toggle('lit', i < val));
    });
  });
}

function saveCustomGameFromForm() {
  const title    = document.getElementById('cg-title').value.trim();
  const genres   = document.getElementById('cg-genres').value.trim();
  const platform = document.getElementById('cg-platform').value.trim();

  // ── Required-field validation ──
  const errors = [];
  if (!title)    errors.push({ field: 'cg-title',    msg: 'Nama game harus diisi!' });
  if (!genres)   errors.push({ field: 'cg-genres',   msg: 'Genre harus diisi!' });
  if (!platform) errors.push({ field: 'cg-platform', msg: 'Platform harus diisi!' });

  // Remove old error states
  document.querySelectorAll('.cg-field-error').forEach(el => el.classList.remove('cg-field-error'));
  document.querySelectorAll('.cg-error-msg').forEach(el => el.remove());

  if (errors.length > 0) {
    errors.forEach(({ field, msg }) => {
      const input = document.getElementById(field);
      if (input) {
        input.classList.add('cg-field-error');
        const errEl = document.createElement('span');
        errEl.className = 'cg-error-msg';
        errEl.textContent = msg;
        input.parentNode.appendChild(errEl);
      }
    });
    // Shake the save button
    const saveBtn = document.getElementById('custom-game-save');
    saveBtn.classList.add('btn-shake');
    setTimeout(() => saveBtn.classList.remove('btn-shake'), 500);
    showToast(`${errors.length} field wajib belum diisi!`, 'error');
    document.getElementById(errors[0].field)?.focus();
    return;
  }

  const id = cgEditingId || generateCustomId();
  const coverValue = cgCoverBase64 || document.getElementById('cg-cover').value.trim();
  const data = {
    title,
    genres: document.getElementById('cg-genres').value.trim(),
    year: document.getElementById('cg-year').value.trim(),
    platform: document.getElementById('cg-platform').value.trim(),
    ageRating: document.getElementById('cg-age-rating').value,
    cover: coverValue,
    notes: document.getElementById('cg-notes').value.trim(),
    rating: cgRating,
    status: cgStatus,
    isCustom: true,
    addedAt: cgEditingId ? (getCustomGame(cgEditingId)?.addedAt || Date.now()) : Date.now(),
  };

  saveCustomGame(id, data);
  closeCustomGameModal();
  showToast(`"${title}" berhasil disimpan! 🎮`, 'success');

  // Refresh My Memory if open
  if (currentView === 'mylist') {
    const activeTab = document.querySelector('.list-tab.active')?.dataset.tab || 'playing';
    renderMyList(activeTab);
  }
}

// ============================================================
//  CUSTOM GAME DETAIL MODAL
// ============================================================

function openCustomDetailModal(id) {
  const game = getCustomGame(id);
  if (!game) return;

  const overlay = document.getElementById('detail-modal');
  const inner   = document.getElementById('detail-inner');
  overlay.style.display = 'flex';

  const saved = getGameData(id);
  const curRating = saved?.rating || game.rating || 0;
  const curStatus = saved?.status || game.status || '';

  const coverHtml = game.cover
    ? `<img src="${game.cover}" alt="${escHtml(game.title)}" onerror="this.parentElement.innerHTML='<div style=\\'height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;background:var(--bg-surface)\\'>🎮</div>'" />`
    : `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;background:var(--bg-surface)">🎮</div>`;

  const statuses = [
    { key: 'playing',    label: '🎮 Playing',      cls: 'active-playing' },
    { key: 'played',     label: '✅ Played',        cls: 'active-played' },
    { key: 'plantoplay', label: '📋 Plan to Play',  cls: 'active-plantoplay' },
  ];

  const statusBtns = statuses.map(s => `
    <button class="list-btn ${curStatus === s.key ? s.cls : ''}" data-status="${s.key}">
      ${s.label}
    </button>
  `).join('');

  const starsHtml = Array.from({length: 10}, (_, i) =>
    `<span class="star ${i < curRating ? 'lit' : ''}" data-value="${i+1}">★</span>`
  ).join('');

  const customEsrbMap = {
    'Everyone':     { label: 'Everyone',     color: '#4caf50', icon: 'E' },
    'Everyone 10+': { label: 'Everyone 10+', color: '#8bc34a', icon: 'E10+' },
    'Teen':         { label: 'Teen',          color: '#ffd166', icon: 'T' },
    'Mature':       { label: 'Mature',        color: '#ff9800', icon: 'M' },
    'Adults Only':  { label: 'Adults Only',   color: '#ff3d6b', icon: 'AO' },
  };
  const customEsrbInfo = game.ageRating ? customEsrbMap[game.ageRating] : null;
  const customEsrbHtml = customEsrbInfo
    ? `<div class="stat-card">
         <div class="stat-label">Age Rating</div>
         <div class="stat-value">
           <span class="esrb-badge" style="background:${customEsrbInfo.color}22;color:${customEsrbInfo.color};border-color:${customEsrbInfo.color}55;">
             <span class="esrb-icon">${customEsrbInfo.icon}</span>${escHtml(customEsrbInfo.label)}
           </span>
         </div>
       </div>`
    : `<div class="stat-card">
         <div class="stat-label">Age Rating</div>
         <div class="stat-value" style="color:var(--text-muted)">Tidak Diketahui</div>
       </div>`;

  inner.innerHTML = `
    <div class="detail-hero">
      ${coverHtml}
      <div class="detail-hero-overlay"></div>
      <div class="custom-badge-detail">✍️ Custom Game</div>
    </div>
    <div class="detail-body">
      <div class="detail-title">${escHtml(game.title)}</div>

      <div class="detail-tags">
        ${game.genres ? game.genres.split(',').map(g => `<span class="detail-tag">${escHtml(g.trim())}</span>`).join('') : ''}
        <span class="detail-tag custom-tag">Custom</span>
      </div>

      <div class="detail-stats">
        <div class="stat-card">
          <div class="stat-label">Tahun Rilis</div>
          <div class="stat-value">${escHtml(game.year || 'N/A')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Platform</div>
          <div class="stat-value" style="font-size:0.8rem;color:var(--text-secondary)">${escHtml(game.platform || 'N/A')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ditambahkan</div>
          <div class="stat-value" style="font-size:0.8rem;color:var(--text-secondary)">${game.addedAt ? new Date(game.addedAt).toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'}) : 'N/A'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Rating Kamu</div>
          <div class="stat-value" style="color:var(--gold)">${curRating ? `★ ${curRating}/10` : '—'}</div>
        </div>
        ${customEsrbHtml}
      </div>

      ${game.notes ? `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:1rem 1.25rem;margin-bottom:1.5rem;">
          <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;">📝 Catatan Pribadi</div>
          <div style="color:var(--text-secondary);font-size:0.9rem;line-height:1.7;">${escHtml(game.notes)}</div>
        </div>
      ` : ''}

      <div class="detail-actions">
        <div>
          <div class="rating-label" style="margin-bottom:0.5rem">Status:</div>
          <div class="list-btn-group" id="status-btn-group">
            ${statusBtns}
            ${curStatus ? `<button class="btn-danger" id="btn-remove-list">Remove</button>` : ''}
          </div>
        </div>
        <div class="rating-section">
          <span class="rating-label">Your Rating:</span>
          <div class="star-rating" id="star-rating-container">${starsHtml}</div>
          <span class="rating-score-display" id="rating-score-display">${curRating ? `${curRating}/10` : '—'}</span>
        </div>
      </div>

      <div style="margin-top:1.5rem;display:flex;gap:.75rem;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:1.25rem;">
        <button class="btn-outline" id="btn-edit-custom" style="font-size:0.85rem;">✏️ Edit Game</button>
        <button class="btn-danger" id="btn-delete-custom" style="font-size:0.85rem;">🗑️ Hapus Game</button>
      </div>

      <!-- COMMENTS SECTION -->
      <div class="comments-section">
        <div class="comments-header">
          <span class="comments-title">💬 Komentar & Jurnal</span>
          <span class="comments-count" id="comments-count"></span>
        </div>
        <div class="comment-form">
          <textarea id="comment-input" placeholder="Tulis komentar, kesan, spoiler, atau jurnal bermain kamu..." rows="3" maxlength="1000"></textarea>
          <div class="comment-form-footer">
            <span class="comment-char-count" id="comment-char">0 / 1000</span>
            <button class="btn-primary comment-submit-btn" id="comment-submit">Kirim 💬</button>
          </div>
        </div>
        <div class="comments-list" id="comments-list"></div>
      </div>
    </div>
  `;

  // Status buttons
  const basicInfo = { title: game.title, cover: game.cover || '', genres: game.genres || '', status: curStatus, isCustom: true };
  document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      saveGameData(id, { ...basicInfo, status });
      saveCustomGame(id, { status });
      showToast(`Status diubah!`, 'success');
      document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(b => {
        b.className = 'list-btn';
        if (b.dataset.status === status) b.classList.add(`active-${status}`);
      });
      let rb = document.getElementById('btn-remove-list');
      if (!rb) {
        rb = document.createElement('button');
        rb.className = 'btn-danger'; rb.id = 'btn-remove-list'; rb.textContent = 'Remove';
        document.getElementById('status-btn-group').appendChild(rb);
        rb.addEventListener('click', () => { removeGame(id); saveCustomGame(id, { status: '' }); showToast('Dihapus dari memory', 'info'); document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(b => b.className = 'list-btn'); rb.remove(); });
      }
    });
  });

  const removeBtn = document.getElementById('btn-remove-list');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      removeGame(id);
      saveCustomGame(id, { status: '' });
      showToast('Dihapus dari memory', 'info');
      document.querySelectorAll('#status-btn-group .list-btn[data-status]').forEach(b => b.className = 'list-btn');
      removeBtn.remove();
    });
  }

  // Stars
  const stars = document.querySelectorAll('#star-rating-container .star');
  const scoreDisplay = document.getElementById('rating-score-display');
  let savedRating = curRating;
  stars.forEach(star => {
    const val = parseInt(star.dataset.value);
    star.addEventListener('mouseenter', () => stars.forEach((s, i) => s.classList.toggle('lit', i < val)));
    star.addEventListener('mouseleave', () => stars.forEach((s, i) => s.classList.toggle('lit', i < savedRating)));
    star.addEventListener('click', () => {
      savedRating = val;
      saveGameData(id, { rating: val });
      saveCustomGame(id, { rating: val });
      scoreDisplay.textContent = `${val}/10`;
      stars.forEach((s, i) => s.classList.toggle('lit', i < val));
      showToast(`Rated ${val}/10 ⭐`, 'success');
    });
  });

  // Edit button
  document.getElementById('btn-edit-custom').addEventListener('click', () => {
    document.getElementById('detail-modal').style.display = 'none';
    openCustomGameModal(id);
  });

  // Delete button
  document.getElementById('btn-delete-custom').addEventListener('click', () => {
    if (confirm(`Yakin hapus "${game.title}" dari koleksi kamu?`)) {
      deleteCustomGame(id);
      document.getElementById('detail-modal').style.display = 'none';
      showToast(`"${game.title}" dihapus.`, 'info');
      if (currentView === 'mylist') {
        const activeTab = document.querySelector('.list-tab.active')?.dataset.tab || 'playing';
        renderMyList(activeTab);
      }
    }
  });

  // Comments
  renderComments(id);
  setupCommentForm(id, getUsername() || 'Guest');
}

// ============================================================
//  COMMENTS SYSTEM
// ============================================================

function getComments(gameId) {
  const key = `gv_comments_${gameId}`;
  return JSON.parse(localStorage.getItem(key) || '[]');
}

function saveComments(gameId, comments) {
  localStorage.setItem(`gv_comments_${gameId}`, JSON.stringify(comments));
}

function addComment(gameId, author, text) {
  const comments = getComments(gameId);
  const comment = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    author,
    text,
    timestamp: Date.now(),
    edited: false,
  };
  comments.unshift(comment);
  saveComments(gameId, comments);
  return comment;
}

function deleteComment(gameId, commentId) {
  const comments = getComments(gameId).filter(c => c.id !== commentId);
  saveComments(gameId, comments);
}

function editComment(gameId, commentId, newText) {
  const comments = getComments(gameId);
  const c = comments.find(c => c.id === commentId);
  if (c) { c.text = newText; c.edited = true; c.editedAt = Date.now(); }
  saveComments(gameId, comments);
}

function formatCommentTime(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return 'Baru saja';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderComments(gameId) {
  const comments = getComments(gameId);
  const list     = document.getElementById('comments-list');
  const countEl  = document.getElementById('comments-count');
  if (!list) return;

  if (countEl) countEl.textContent = comments.length ? `${comments.length} komentar` : '';

  if (comments.length === 0) {
    list.innerHTML = `<div class="comments-empty">Belum ada komentar. Jadilah yang pertama! 🎮</div>`;
    return;
  }

  const me = getUsername() || 'Guest';
  list.innerHTML = '';

  comments.forEach(c => {
    const isMe = c.author === me;
    const item = document.createElement('div');
    item.className = `comment-item ${isMe ? 'comment-mine' : ''}`;
    item.dataset.cid = c.id;

    item.innerHTML = `
      <div class="comment-avatar">${c.author.charAt(0).toUpperCase()}</div>
      <div class="comment-body">
        <div class="comment-meta">
          <span class="comment-author">${escHtml(c.author)}</span>
          <span class="comment-time" title="${new Date(c.timestamp).toLocaleString('id-ID')}">${formatCommentTime(c.timestamp)}${c.edited ? ' <span class="comment-edited">(diedit)</span>' : ''}</span>
          ${isMe ? `
            <div class="comment-actions">
              <button class="comment-action-btn" data-edit="${c.id}">✏️</button>
              <button class="comment-action-btn comment-del-btn" data-delete="${c.id}">🗑️</button>
            </div>
          ` : ''}
        </div>
        <div class="comment-text" id="ctext-${c.id}">${escHtml(c.text)}</div>
        <div class="comment-edit-form" id="cedit-${c.id}" style="display:none;">
          <textarea class="comment-edit-input">${escHtml(c.text)}</textarea>
          <div class="comment-edit-actions">
            <button class="btn-outline" style="font-size:0.78rem;padding:0.3rem 0.7rem;" data-cancel-edit="${c.id}">Batal</button>
            <button class="btn-primary" style="font-size:0.78rem;padding:0.3rem 0.7rem;" data-save-edit="${c.id}">Simpan</button>
          </div>
        </div>
      </div>
    `;

    // Edit button
    item.querySelector(`[data-edit="${c.id}"]`)?.addEventListener('click', () => {
      document.getElementById(`ctext-${c.id}`).style.display = 'none';
      document.getElementById(`cedit-${c.id}`).style.display = 'block';
      item.querySelector(`[data-cancel-edit="${c.id}"]`).addEventListener('click', () => {
        document.getElementById(`ctext-${c.id}`).style.display = 'block';
        document.getElementById(`cedit-${c.id}`).style.display = 'none';
      });
      item.querySelector(`[data-save-edit="${c.id}"]`).addEventListener('click', () => {
        const newText = item.querySelector('.comment-edit-input').value.trim();
        if (!newText) return;
        editComment(gameId, c.id, newText);
        renderComments(gameId);
        showToast('Komentar diperbarui', 'success');
      });
    });

    // Delete button
    item.querySelector(`[data-delete="${c.id}"]`)?.addEventListener('click', () => {
      if (confirm('Hapus komentar ini?')) {
        deleteComment(gameId, c.id);
        renderComments(gameId);
        showToast('Komentar dihapus', 'info');
      }
    });

    list.appendChild(item);
  });
}

function setupCommentForm(gameId, author) {
  const input     = document.getElementById('comment-input');
  const submitBtn = document.getElementById('comment-submit');
  const charEl    = document.getElementById('comment-char');
  if (!input || !submitBtn) return;

  input.addEventListener('input', () => {
    if (charEl) charEl.textContent = `${input.value.length} / 1000`;
  });

  submitBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) { showToast('Tulis komentar dulu!', 'error'); return; }
    addComment(gameId, author, text);
    input.value = '';
    if (charEl) charEl.textContent = '0 / 1000';
    renderComments(gameId);
    showToast('Komentar ditambahkan! 💬', 'success');
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitBtn.click();
  });
}

// ============================================================
//  IMAGE UPLOAD (base64)
// ============================================================

let cgCoverBase64 = ''; // holds uploaded image data

function setupCoverUpload() {
  const fileInput = document.getElementById('cg-cover-file');
  const urlInput  = document.getElementById('cg-cover');
  const preview   = document.getElementById('cg-cover-preview');
  if (!fileInput) return;

  function setPreview(src) {
    if (src) {
      preview.innerHTML = `<img src="${src}" alt="Cover preview" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);" />`;
    } else {
      preview.innerHTML = `<span class="cover-preview-placeholder">🖼️<br><small>Preview</small></span>`;
    }
  }

  // File upload → base64
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Ukuran gambar maksimal 2MB!', 'error');
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      cgCoverBase64 = e.target.result;
      urlInput.value = '';
      setPreview(cgCoverBase64);
    };
    reader.readAsDataURL(file);
  });

  // URL input → preview
  urlInput.addEventListener('input', () => {
    cgCoverBase64 = '';
    fileInput.value = '';
    const url = urlInput.value.trim();
    if (url) {
      const img = new Image();
      img.onload  = () => setPreview(url);
      img.onerror = () => setPreview('');
      img.src = url;
    } else {
      setPreview('');
    }
  });
}

// ============================================================
//  BACKUP MODAL
// ============================================================

function openBackupModal() {
  document.getElementById('backup-modal').style.display = 'flex';
  // Reset import state
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-actions').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  pendingImportData = null;
}

function closeBackupModal() {
  document.getElementById('backup-modal').style.display = 'none';
}

// ============================================================
//  EXPORT
// ============================================================

function exportData() {
  const library    = getLibrary();
  const customGames = getCustomGames();
  const username   = getUsername();

  // Collect all comment keys
  const comments = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('gv_comments_')) {
      const gameId = key.replace('gv_comments_', '');
      try { comments[gameId] = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
    }
  }

  const exportObj = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    username,
    library,
    customGames,
    comments,
  };

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `gamembrance-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Backup berhasil didownload! 💾', 'success');
}

// ============================================================
//  IMPORT
// ============================================================

let pendingImportData = null;

function handleImportFile(e) {
  const file = e.target.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    showToast('Hanya file .json yang diterima!', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.library && !data.customGames) {
        throw new Error('Format file tidak valid');
      }
      pendingImportData = data;
      showImportPreview(data);
    } catch (err) {
      showToast('File tidak valid atau rusak!', 'error');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function showImportPreview(data) {
  const libCount     = Object.keys(data.library || {}).length;
  const customCount  = Object.keys(data.customGames || {}).length;
  const commentCount = Object.values(data.comments || {}).reduce((acc, arr) => acc + arr.length, 0);
  const exportedAt   = data.exportedAt ? new Date(data.exportedAt).toLocaleString('id-ID') : '—';

  const preview = document.getElementById('import-preview');
  preview.innerHTML = `
    <div class="import-preview-inner">
      <div class="import-preview-title">📋 Preview Backup</div>
      <div class="import-stats">
        <div class="import-stat"><span class="import-stat-num">${libCount}</span><span>Games di Library</span></div>
        <div class="import-stat"><span class="import-stat-num">${customCount}</span><span>Custom Games</span></div>
        <div class="import-stat"><span class="import-stat-num">${commentCount}</span><span>Komentar</span></div>
      </div>
      <div class="import-meta">
        ${data.username ? `<span>👤 ${escHtml(data.username)}</span>` : ''}
        <span>📅 ${exportedAt}</span>
      </div>
    </div>
  `;
  preview.style.display = 'block';
  document.getElementById('import-actions').style.display = 'flex';
}

function confirmImport() {
  if (!pendingImportData) return;

  const { library = {}, customGames = {}, comments = {}, username } = pendingImportData;

  // Merge library (imported wins on conflict)
  const existingLib = getLibrary();
  saveLibrary({ ...existingLib, ...library });

  // Merge custom games
  const existingCustom = getCustomGames();
  saveCustomGames({ ...existingCustom, ...customGames });

  // Merge comments (append unique)
  Object.entries(comments).forEach(([gameId, importedComments]) => {
    const existing = getComments(gameId);
    const existingIds = new Set(existing.map(c => c.id));
    const merged = [...existing, ...importedComments.filter(c => !existingIds.has(c.id))];
    saveComments(gameId, merged);
  });

  // Optionally restore username if none set
  if (username && !getUsername()) {
    saveUsername(username);
    updateNavUsername();
  }

  closeBackupModal();
  pendingImportData = null;

  showToast('Data berhasil diimport! 🎉', 'success');

  // Refresh current view
  if (currentView === 'mylist') {
    const activeTab = document.querySelector('.list-tab.active')?.dataset.tab || 'playing';
    renderMyList(activeTab);
  }
}

// ============================================================
//  BOOTSTRAP / EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // Username check
  if (!getUsername()) {
    showUsernameModal();
  }
  updateNavUsername();

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

  document.getElementById('user-chip').addEventListener('click', showUsernameModal);

  // Navigation
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

  // Refresh recently updated
  document.getElementById('refresh-updated-btn')?.addEventListener('click', () => {
    loadRecentlyUpdated();
  });

  // Search
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

  // Genre pills
  document.getElementById('genre-pills').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;

    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentGenre = pill.dataset.genre;
    loadGames(true);
  });

  // Sort select
  document.getElementById('sort-select').addEventListener('change', e => {
    currentOrdering = e.target.value;
    loadGames(true);
  });

  // Load more
  document.getElementById('load-more-btn').addEventListener('click', () => {
    currentPage++;
    loadGames(false);
  });

  // Detail modal close
  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-modal').style.display = 'none';
  });

  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-modal')) {
      document.getElementById('detail-modal').style.display = 'none';
    }
  });

  // My Memory tabs
  document.querySelectorAll('.list-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderMyList(tab.dataset.tab);
    });
  });

  // Custom Game Modal triggers
  document.getElementById('nav-add-custom').addEventListener('click', () => openCustomGameModal());
  document.getElementById('mylist-add-custom')?.addEventListener('click', () => openCustomGameModal());
  document.getElementById('search-add-custom')?.addEventListener('click', () => openCustomGameModal());
  document.getElementById('custom-game-close').addEventListener('click', closeCustomGameModal);
  document.getElementById('custom-game-cancel').addEventListener('click', closeCustomGameModal);
  document.getElementById('custom-game-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('custom-game-modal')) closeCustomGameModal();
  });

  // Custom game status buttons
  document.getElementById('cg-status-group').addEventListener('click', e => {
    const btn = e.target.closest('.cg-status-btn');
    if (!btn) return;
    cgStatus = btn.dataset.status;
    document.querySelectorAll('.cg-status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Save custom game
  document.getElementById('custom-game-save').addEventListener('click', saveCustomGameFromForm);

  // Cover upload — init on first modal open (handled inside openCustomGameModal)

  // Enter in title field saves
  document.getElementById('cg-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveCustomGameFromForm();
  });

  // Clear validation errors on input
  ['cg-title', 'cg-genres', 'cg-platform'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('cg-field-error');
        el.parentNode.querySelector('.cg-error-msg')?.remove();
      }
    });
  });

  // Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('detail-modal').style.display = 'none';
      document.getElementById('username-modal').style.display = 'none';
      closeCustomGameModal();
    }
  });

  // Search filter dropdowns — re-run search when changed
  document.getElementById('search-sort-select')?.addEventListener('change', () => {
    const q = document.getElementById('search-input').value.trim();
    if (q) doSearch(q);
  });

  document.getElementById('search-age-filter')?.addEventListener('change', () => {
    const q = document.getElementById('search-input').value.trim();
    if (q) doSearch(q);
  });

  // Age rating filter
  document.getElementById('age-rating-filter').addEventListener('change', e => {
    currentAgeRating = e.target.value;
    loadGames(true);
  });

  // ── Backup / Export / Import ──
  document.getElementById('nav-export').addEventListener('click', openBackupModal);
  document.getElementById('backup-close').addEventListener('click', closeBackupModal);
  document.getElementById('backup-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('backup-modal')) closeBackupModal();
  });
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-file-input').addEventListener('change', handleImportFile);

  // Drag & drop on import zone
  const dropZone = document.getElementById('import-drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processImportFile(file);
  });

  document.getElementById('import-cancel-btn').addEventListener('click', () => {
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('import-actions').style.display = 'none';
    document.getElementById('import-file-input').value = '';
    pendingImportData = null;
  });

  document.getElementById('import-confirm-btn').addEventListener('click', confirmImport);

  // Initial load
  showView('home-view');
  loadSpotlights();
  loadRecentlyUpdated();
  loadGames(true);
});
