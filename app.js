/* ========================================================
   RELAX — Main App JavaScript
   Optimized: debounced search, lazy loading, caching, 
   better error handling, no memory leaks
   ======================================================== */

'use strict';

// ===== STATE =====
let allListings = [], filtered = [], currentUser = null;
let activeType = 'all', activeCity = 'all';
let sortBy = 'date';
let visibleCount = 12;
let firebaseOk = false;
let favorites = new Set(JSON.parse(localStorage.getItem('relax_favs') || '[]'));
let showingFavs = false;
let lang = localStorage.getItem('relax_lang') || 'ar';
let currentCurrency = localStorage.getItem('relax_currency') || 'MAD';
let nearMeMode = false, availNowMode = false;
let compareList = [];
let searchHistory = JSON.parse(localStorage.getItem('relax_searchHistory') || '[]');
let recentlyViewed = JSON.parse(localStorage.getItem('relax_recent') || '[]');
let selectedSlot = null;
let selectedReviewStars = {};
let uploadedPhotos = [];
let selectedImgFile = null, uploadedImgUrl = null;
const _editImgPending = {};
let authMode = 'login', splashMode = 'login';
let _deferredInstallPrompt = null;
let _qrCurrentUrl = '';
let _unreadCheckTimer = null;

// ===== CURRENCIES =====
const currencies = {
  MAD: { symbol: 'DH', rate: 1 },
  EUR: { symbol: '€', rate: 0.092 },
  USD: { symbol: '$', rate: 0.10 },
  SAR: { symbol: 'ر.س', rate: 0.375 },
  AED: { symbol: 'د.إ', rate: 0.366 },
  TND: { symbol: 'د.ت', rate: 0.31 },
};

function convertPrice(priceMAD) {
  const c = currencies[currentCurrency] || currencies.MAD;
  return Math.round(Number(priceMAD) * c.rate) + ' ' + c.symbol;
}

function setCurrency(code) {
  currentCurrency = code;
  localStorage.setItem('relax_currency', code);
  renderListings();
}

// ===== TYPE IMAGES =====
const typeImages = {
  'رياضي':   { bg: 'linear-gradient(135deg,#1A3A5C,#2E6DA4)', emoji: '💪' },
  'استرخاء': { bg: 'linear-gradient(135deg,#0d7377,#14a085)', emoji: '🌿' },
  'طب':      { bg: 'linear-gradient(135deg,#1a1a2e,#16213e)', emoji: '🏥' },
  'سبا':     { bg: 'linear-gradient(135deg,#6a0572,#ab47bc)', emoji: '🧖' },
  'تايلاندي':{ bg: 'linear-gradient(135deg,#8b0000,#c0392b)', emoji: '🇹🇭' },
};

function getDefaultImg(type, title) {
  const t = typeImages[type] || { bg: 'linear-gradient(135deg,#1A3A5C,#2E6DA4)', emoji: '💆' };
  return `<div class="card-img-placeholder" style="background:${t.bg}">
    <span style="font-size:2.5rem">${t.emoji}</span>
    <span style="color:rgba(255,255,255,0.8);font-size:0.8rem;font-weight:700;text-align:center;padding:0 8px">${title || ''}</span>
  </div>`;
}

// ===== FIREBASE LOADING =====
async function loadListings() {
  if (!window._firebaseReady) return;
  showSkeletons();
  try {
    const { collection, getDocs, query } = window._fbModules;
    const snap = await getDocs(query(collection(window._db, 'listings')));
    const now = new Date();
    allListings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(ad => {
        if (!ad.expiresAt) return true;
        const exp = ad.expiresAt?.toDate ? ad.expiresAt.toDate() : new Date(ad.expiresAt);
        return exp > now;
      })
      .sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return tb - ta;
      });
    filtered = [...allListings];
    firebaseOk = true;
    updateCityFilter();
    renderListings();
    renderRecentlyViewed();
    // Handle ?ad= deep link
    const adParam = new URLSearchParams(window.location.search).get('ad');
    if (adParam) setTimeout(() => openDetail(adParam), 500);
  } catch(e) {
    console.error('loadListings error:', e);
    document.getElementById('listingsGrid').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <p style="font-size:2rem">⚠️</p>
        <p style="margin-top:1rem">خطأ في تحميل البيانات</p>
        <button onclick="loadListings()" style="margin-top:1rem;padding:0.5rem 1.5rem;background:var(--gold);color:white;border:none;border-radius:10px;cursor:pointer;font-family:Tajawal;font-size:0.9rem">🔄 إعادة المحاولة</button>
      </div>`;
  }
}

function showSkeletons() {
  const grid = document.getElementById('listingsGrid');
  grid.innerHTML = Array(8).fill(0).map(() => `
    <div class="skel-card">
      <div class="skeleton skel-img"></div>
      <div class="skel-body">
        <div class="skeleton skel-line"></div>
        <div class="skeleton skel-line short"></div>
        <div class="skeleton skel-line shorter"></div>
      </div>
    </div>`).join('');
}

// ===== CITY FILTER =====
function updateCityFilter() {
  const select = document.getElementById('citySelect');
  if (!select) return;
  const cities = [...new Set(allListings.map(a => a.city).filter(Boolean))].sort();
  const firstOpt = select.options[0];
  select.innerHTML = '';
  select.appendChild(firstOpt);
  if (cities.length) {
    const group = document.createElement('optgroup');
    group.label = '📍 المدن المتاحة';
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      group.appendChild(opt);
    });
    select.appendChild(group);
  }
}

// ===== RENDER LISTINGS =====
const _origSort = arr => {
  if (sortBy === 'price') return [...arr].sort((a, b) => (a.price || 0) - (b.price || 0));
  if (sortBy === 'rating') return [...arr].sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
  return [...arr];
};

function renderListings() {
  const t = T[lang] || T['ar'];
  const grid = document.getElementById('listingsGrid');
  const countEl = document.getElementById('resultsCount');
  if (countEl) countEl.textContent = `${filtered.length} ${t.sAvail}`;
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><p style="font-size:2.5rem">🔍</p><p style="margin-top:1rem">${t.noResults}</p></div>`;
    document.getElementById('loadMoreBtn').style.display = 'none';
    return;
  }
  let sorted = _origSort(filtered);
  // PRO listings always first
  sorted.sort((a, b) => (b.isPro ? 1 : 0) - (a.isPro ? 1 : 0));
  const page = sorted.slice(0, visibleCount);
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.style.display = sorted.length > visibleCount ? 'block' : 'none';

  const adSlot = `<div style="grid-column:1/-1;background:var(--cream);border-radius:16px;padding:1rem;text-align:center;border:1px dashed rgba(61,53,41,0.15);min-height:90px;display:flex;align-items:center;justify-content:center;color:var(--blue);font-size:0.8rem;opacity:0.6">📢 إعلان</div>`;

  let html = '';
  page.forEach((l, i) => {
    const img = l.imgUrl
      ? `<img class="card-img" src="${l.imgUrl}" alt="${escHtml(l.title)}" loading="lazy">`
      : getDefaultImg(l.type, l.title);
    const proTop = l.isPro ? `<div class="card-pro-top">${t.featuredTag}</div>` : '';
    const proClass = l.isPro ? 'card-pro-border' : '';
    const isFav = favorites.has(l.id);
    const avgRating = l.avgRating ? Math.round(l.avgRating) : 0;
    let starsHTML = '';
    if (avgRating > 0) {
      for (let s = 1; s <= 5; s++) starsHTML += `<span style="color:${s <= avgRating ? '#F6AD55' : '#ddd'}">★</span>`;
      starsHTML += `<span class="rating-count">(${l.ratingCount || 0})</span>`;
    }
    const couponBadge = l.coupon ? `<div class="coupon-badge">🎟️ ${l.coupon}${l.couponDiscount ? ` -${l.couponDiscount}%` : ''}</div>` : '';
    const verifiedBadge = l.isVerified ? `<span style="position:absolute;bottom:10px;left:10px;background:rgba(16,185,129,0.9);color:white;font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:10px;z-index:3">✓ موثق</span>` : '';
    html += `<div class="card ${proClass}" onclick="openDetail('${l.id}')" style="position:relative">
      ${proTop}${img}
      <button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleFav(event,'${l.id}')">${isFav ? '❤️' : '🤍'}</button>
      <div class="card-badge">${l.type}</div>
      ${couponBadge}${verifiedBadge}
      <div class="card-body">
        <div class="card-type">${l.isPro ? '<span class="pro-badge">PRO</span>' : ''}✦ ${l.type}</div>
        <div class="card-title">${escHtml(l.title)}</div>
        ${starsHTML ? `<div class="stars-row">${starsHTML}</div>` : ''}
        <div class="card-desc">${escHtml(l.desc || '')}</div>
        <div class="card-footer">
          <div class="card-price">${l.price} <span>${t.perHour}</span></div>
          <div class="card-location">📍 ${l.city}${l.age ? ` · 🎂 ${l.age} ${t.years}` : ''}${l.views > 0 ? ` · 👁️ ${l.views}` : ''}</div>
        </div>
      </div>
    </div>`;
    if ((i + 1) % 6 === 0 && i < page.length - 1) html += adSlot;
  });
  grid.innerHTML = html;
}

// XSS protection
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== FILTERS =====
// Debounced search for performance
const _debouncedFilter = debounce(applyFilters, 250);

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function applyFilters() {
  const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const priceMin = parseInt(document.getElementById('priceMin')?.value || 0);
  const priceMax = parseInt(document.getElementById('priceMax')?.value || 9999);
  const ageMin = parseInt(document.getElementById('ageMin')?.value || 0);
  const ageMax = parseInt(document.getElementById('ageMax')?.value || 100);
  const gender = document.getElementById('genderFilter')?.value || 'all';
  const mobile = document.getElementById('mobileFilter')?.value || 'all';
  const city = document.getElementById('citySelect')?.value || 'all';
  activeCity = city;
  
  if (searchVal) saveSearchHistory(searchVal);

  filtered = allListings.filter(l => {
    if (showingFavs && !favorites.has(l.id)) return false;
    if (activeType !== 'all' && l.type !== activeType) return false;
    if (activeCity !== 'all' && l.city !== activeCity) return false;
    if (l.price < priceMin || l.price > priceMax) return false;
    if (l.age && (l.age < ageMin || l.age > ageMax)) return false;
    if (gender !== 'all' && l.gender && l.gender !== 'all' && l.gender !== gender) return false;
    if (mobile !== 'all' && l.mobile && l.mobile !== mobile) return false;
    if (searchVal && !`${l.title} ${l.desc} ${l.city} ${l.type}`.toLowerCase().includes(searchVal)) return false;
    if (availNowMode) {
      const day = new Date().getDay();
      if (l.availability?.length && !l.availability.includes(day)) return false;
    }
    if (nearMeMode && window._userLat && window._userLng) {
      const coords = cityCoords[l.city];
      if (!coords) return false;
      const dist = getDistance(window._userLat, window._userLng, coords[0], coords[1]);
      if (dist > 50) return false;
    }
    return true;
  });
  visibleCount = 12;
  renderListings();
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateLabels() {
  const pm = document.getElementById('priceMin'), pM = document.getElementById('priceMax');
  const am = document.getElementById('ageMin'), aM = document.getElementById('ageMax');
  if (pm) document.getElementById('priceMinVal').textContent = pm.value;
  if (pM) document.getElementById('priceMaxVal').textContent = pM.value;
  if (am) document.getElementById('ageMinVal').textContent = am.value;
  if (aM) document.getElementById('ageMaxVal').textContent = aM.value;
}

function resetFilters() {
  activeType = 'all'; activeCity = 'all'; availNowMode = false; nearMeMode = false;
  const si = document.getElementById('searchInput'); if (si) si.value = '';
  const pm = document.getElementById('priceMin'); if (pm) pm.value = 0;
  const pM = document.getElementById('priceMax'); if (pM) pM.value = 2000;
  const am = document.getElementById('ageMin'); if (am) am.value = 18;
  const aM = document.getElementById('ageMax'); if (aM) aM.value = 70;
  const gf = document.getElementById('genderFilter'); if (gf) gf.value = 'all';
  const mf = document.getElementById('mobileFilter'); if (mf) mf.value = 'all';
  const an = document.getElementById('availNowBtn'); if (an) an.classList.remove('active');
  const nb = document.getElementById('nearBtn'); if (nb) nb.classList.remove('active');
  updateLabels();
  document.querySelectorAll('.filter-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  const cs = document.querySelector('.filter-select'); if (cs) cs.value = 'all';
  filtered = [...allListings];
  visibleCount = 12;
  renderListings();
}

function setType(type, el) {
  activeType = type;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  applyFilters();
}

function setSort(s, el) {
  sortBy = s;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderListings();
}

function loadMore() {
  visibleCount += 12;
  renderListings();
}

function toggleAvailNow(el) {
  availNowMode = !availNowMode;
  el.classList.toggle('active', availNowMode);
  applyFilters();
}

function toggleNearMe(el) {
  if (nearMeMode) {
    nearMeMode = false;
    el.classList.remove('active');
    el.textContent = '📍 قريب مني';
    applyFilters();
    return;
  }
  if (!navigator.geolocation) { showToast('⚠️ المتصفح لا يدعم GPS', true); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    window._userLat = pos.coords.latitude;
    window._userLng = pos.coords.longitude;
    nearMeMode = true;
    el.classList.add('active');
    el.textContent = '📍 قريب مني ✓';
    applyFilters();
  }, () => showToast('⚠️ تعذر الحصول على الموقع', true));
}

// ===== FAVORITES =====
function saveFavs() {
  localStorage.setItem('relax_favs', JSON.stringify([...favorites]));
  const el = document.getElementById('favCount');
  if (el) el.textContent = favorites.size;
}

function toggleFav(e, id) {
  e.stopPropagation();
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  saveFavs();
  renderListings();
}

function showTab(tab) {
  showingFavs = (tab === 'fav');
  document.getElementById('tabAll')?.classList.toggle('active', !showingFavs);
  document.getElementById('tabFav')?.classList.toggle('active', showingFavs);
  applyFilters();
}

// ===== TOAST =====
let _toastTimer;
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(_toastTimer);
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ===== DARK MODE =====
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const on = document.body.classList.contains('dark-mode');
  localStorage.setItem('relax_dark', on ? '1' : '0');
  const btn = document.getElementById('darkToggle');
  if (btn) btn.textContent = on ? '☀️' : '🌙';
}

// ===== RATINGS =====
async function submitQuickRating(id, stars) {
  if (!currentUser) { showToast('⚠️ سجل دخولك لتقييم الخدمة', true); openAuthModal(); return; }
  const l = allListings.find(x => x.id === id);
  if (!l) return;
  try {
    const { doc, updateDoc, setDoc, getDoc } = window._fbModules;
    const ratingRef = doc(window._db, 'ratings', id + '_' + currentUser.uid);
    const existing = await getDoc(ratingRef);
    if (existing.exists()) { showToast('⚠️ لقد قيّمت هذا الإعلان من قبل', true); return; }
    await setDoc(ratingRef, { userId: currentUser.uid, adId: id, stars, createdAt: new Date() });
    const newCount = (l.ratingCount || 0) + 1;
    const newAvg = ((l.avgRating || 0) * (l.ratingCount || 0) + stars) / newCount;
    await updateDoc(doc(window._db, 'listings', id), { avgRating: newAvg, ratingCount: newCount });
    l.avgRating = newAvg; l.ratingCount = newCount;
    const starsEls = document.querySelectorAll(`#detailContent .detail-star`);
    starsEls.forEach((el, i) => { el.style.color = i < Math.round(newAvg) ? '#F6AD55' : '#ddd'; });
    renderListings();
    showToast(`✅ شكراً على تقييمك! (${stars} نجوم)`);
  } catch(e) { showToast('❌ خطأ في التقييم', true); console.error(e); }
}
function rateAd(id, stars) { submitQuickRating(id, stars); }

// ===== AUTH =====
function openAuthModal() {
  switchAuthTab('login');
  document.getElementById('authModal')?.classList.add('open');
}

function switchAuthTab(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  document.getElementById('tabLogin')?.classList.toggle('active', !isRegister);
  document.getElementById('tabRegister')?.classList.toggle('active', isRegister);
  const rf = document.getElementById('registerFields');
  if (rf) rf.style.display = isRegister ? 'block' : 'none';
  const fp = document.getElementById('forgotPassDiv');
  if (fp) fp.style.display = isRegister ? 'none' : 'block';
  const sb = document.getElementById('authSubmitBtn');
  if (sb) sb.textContent = isRegister ? 'إنشاء حساب ✨' : 'تسجيل الدخول';
  const title = document.getElementById('authModalTitle');
  if (title) title.textContent = isRegister ? '✨ إنشاء حساب' : '🔑 تسجيل الدخول';
}

async function submitAuth() {
  const email = document.getElementById('authEmail')?.value.trim();
  const password = document.getElementById('authPassword')?.value;
  const btn = document.getElementById('authSubmitBtn');
  if (!email || !password) { showToast('⚠️ أدخل الإيميل وكلمة المرور', true); return; }
  if (!window._firebaseReady) { showToast('⚠️ انتظر قليلاً...', true); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري...'; }
  try {
    if (authMode === 'register') {
      const name = document.getElementById('authName')?.value.trim() || email.split('@')[0];
      await window._emailRegister(email, password, name);
      showToast('✅ تم إنشاء الحساب!');
    } else {
      await window._emailLogin(email, password);
      showToast('✅ مرحباً بك!');
    }
    document.getElementById('authModal')?.classList.remove('open');
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': '⚠️ الإيميل مستخدم من قبل',
      'auth/weak-password': '⚠️ كلمة المرور قصيرة (6 أحرف minimum)',
      'auth/wrong-password': '⚠️ كلمة المرور غلط',
      'auth/user-not-found': '⚠️ الحساب غير موجود',
      'auth/invalid-email': '⚠️ الإيميل غير صحيح',
      'auth/invalid-credential': '⚠️ الإيميل أو كلمة المرور غلط',
      'auth/too-many-requests': '⚠️ محاولات كثيرة، انتظر قليلاً',
      'auth/network-request-failed': '⚠️ مشكل في الاتصال',
    };
    showToast(msgs[e.code] || '❌ ' + e.message, true);
  } finally {
    if (btn) { btn.disabled = false; switchAuthTab(authMode); }
  }
}

window.onUserChanged = function(user) {
  currentUser = user;
  const loginBtn = document.getElementById('loginBtn');
  const userMenuWrap = document.getElementById('userMenuWrap');
  const splash = document.getElementById('splashScreen');
  if (splash) splash.style.display = 'none';
  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userMenuWrap) userMenuWrap.style.display = 'flex';
    const ua = document.getElementById('userAvatar'); if (ua) ua.src = user.photoURL || '';
    const un = document.getElementById('userNameShort'); if (un) un.textContent = user.displayName?.split(' ')[0] || '';
    const da = document.getElementById('dashAvatar'); if (da) da.src = user.photoURL || '';
    const dn = document.getElementById('dashName'); if (dn) dn.textContent = user.displayName || '';
    const de = document.getElementById('dashEmail'); if (de) de.textContent = user.email || '';
    checkAdmin(user);
    // Cleanup old timer before setting new one
    if (_unreadCheckTimer) clearInterval(_unreadCheckTimer);
    setTimeout(checkUnreadMessages, 2000);
    _unreadCheckTimer = setInterval(checkUnreadMessages, 60000);
    showWelcomeNotif(user);
    setTimeout(checkProExpiry, 4000);
    if (localStorage.getItem('relax_notif') !== '1') setTimeout(requestNotifPermission, 3000);
  } else {
    if (loginBtn) { loginBtn.style.display = 'flex'; loginBtn.onclick = openAuthModal; }
    if (userMenuWrap) userMenuWrap.style.display = 'none';
    if (_unreadCheckTimer) { clearInterval(_unreadCheckTimer); _unreadCheckTimer = null; }
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isPWA && splash) splash.style.display = 'flex';
  }
};

if (window._pendingAuthUser !== undefined) {
  window.onUserChanged(window._pendingAuthUser);
  delete window._pendingAuthUser;
}

async function doLogin() {
  if (!window._firebaseReady) { showToast('⚠️ انتظر قليلاً...', true); return; }
  try {
    const result = await window._googleLogin();
    if (result?.user) {
      showToast('✅ مرحباً ' + (result.user.displayName?.split(' ')[0] || 'بك') + '!');
      document.getElementById('authModal')?.classList.remove('open');
    }
  } catch(e) {
    if (e.code === 'auth/popup-blocked') showToast('⚠️ السماح بالـ Popup في المتصفح', true);
    else if (e.code !== 'auth/popup-closed-by-user') showToast('❌ ' + (e.message || 'فشل تسجيل الدخول'), true);
  }
}

async function doLogout() {
  await window._googleLogout();
  closeUserMenu();
  showToast('👋 تم تسجيل الخروج');
}

function toggleUserMenu(e) { e.stopPropagation(); document.getElementById('userDropdown')?.classList.toggle('open'); }
function closeUserMenu() { document.getElementById('userDropdown')?.classList.remove('open'); }
document.addEventListener('click', closeUserMenu);

function openForgotPassword() {
  const email = document.getElementById('authEmail')?.value.trim();
  if (!email) { showToast('⚠️ أدخل إيميلك أولاً', true); return; }
  window._resetPassword(email)
    .then(() => showToast('✅ تم إرسال رابط إعادة التعيين!'))
    .catch(e => showToast('❌ ' + (e.code === 'auth/user-not-found' ? 'الإيميل غير موجود' : e.message), true));
}

// ===== SEARCH HISTORY =====
function saveSearchHistory(term) {
  if (!term || term.length < 2) return;
  searchHistory = [term, ...searchHistory.filter(t => t !== term)].slice(0, 8);
  localStorage.setItem('relax_searchHistory', JSON.stringify(searchHistory));
}

function showSearchHistory() {
  if (!searchHistory.length) return;
  let box = document.getElementById('searchHistoryBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'searchHistoryBox';
    box.style.cssText = 'position:absolute;top:100%;right:0;left:0;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:999;overflow:hidden;margin-top:4px';
    document.getElementById('searchInput')?.parentElement?.appendChild(box);
  }
  box.innerHTML = searchHistory.map(t =>
    `<div onclick="document.getElementById('searchInput').value='${t}';applyFilters();hideSearchHistory()"
     style="padding:0.7rem 1rem;cursor:pointer;font-family:Tajawal;font-size:0.9rem;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:0.5rem;color:#333"
     onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
      🕐 ${t}
      <span onclick="event.stopPropagation();removeSearchHistory('${t}')" style="margin-right:auto;color:#aaa;font-size:0.75rem;padding:2px 6px">×</span>
    </div>`).join('');
  box.style.display = 'block';
}

function hideSearchHistory() {
  const box = document.getElementById('searchHistoryBox');
  if (box) box.style.display = 'none';
}

function removeSearchHistory(term) {
  searchHistory = searchHistory.filter(t => t !== term);
  localStorage.setItem('relax_searchHistory', JSON.stringify(searchHistory));
  showSearchHistory();
}

// ===== RECENTLY VIEWED =====
function trackRecentlyViewed(adId) {
  recentlyViewed = [adId, ...recentlyViewed.filter(id => id !== adId)].slice(0, 5);
  localStorage.setItem('relax_recent', JSON.stringify(recentlyViewed));
  renderRecentlyViewed();
}

function renderRecentlyViewed() {
  const sec = document.getElementById('recentSection');
  const chips = document.getElementById('recentChips');
  if (!sec || !chips) return;
  const recent = recentlyViewed.map(id => allListings.find(a => a.id === id)).filter(Boolean);
  if (!recent.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  chips.innerHTML = recent.map(a => `<div class="recent-chip" onclick="openDetail('${a.id}')">${a.title.slice(0, 20)}...</div>`).join('');
}

// ===== COMPARE =====
function addToCompare(adId) {
  if (compareList.includes(adId)) { showToast('⚠️ الإعلان مضاف للمقارنة', true); return; }
  if (compareList.length >= 3) { showToast('⚠️ الحد الأقصى 3 إعلانات', true); return; }
  compareList.push(adId);
  updateCompareFloat();
  showToast(`✅ تمت الإضافة (${compareList.length}/3)`);
}

function updateCompareFloat() {
  const fl = document.getElementById('compareFloat');
  const cnt = document.getElementById('compareCount');
  if (!fl) return;
  fl.style.display = compareList.length > 0 ? 'block' : 'none';
  if (cnt) cnt.textContent = compareList.length;
}

function clearCompare() {
  compareList = [];
  updateCompareFloat();
  document.getElementById('compareModal')?.classList.remove('open');
}

function openCompareModal() {
  if (compareList.length < 2) { showToast('⚠️ أضف إعلانين على الأقل للمقارنة', true); return; }
  const ads = compareList.map(id => allListings.find(a => a.id === id)).filter(Boolean);
  const rows = [
    ['📌 العنوان', a => a.title],
    ['📍 المدينة', a => a.city],
    ['💰 السعر', a => a.price + ' درهم'],
    ['🎂 العمر', a => a.age || '—'],
    ['⭐ التقييم', a => a.avgRating ? a.avgRating.toFixed(1) + ` (${a.ratingCount||0})` : '—'],
    ['👁️ المشاهدات', a => a.views || 0],
    ['👥 الجنس', a => a.gender === 'male' ? '👨 رجال' : a.gender === 'female' ? '👩 نساء' : 'الجميع'],
    ['⚡ الاستجابة', a => a.responseTime || '—'],
  ];
  const bestPrice = Math.min(...ads.map(a => a.price || 9999));
  const bestRating = Math.max(...ads.map(a => a.avgRating || 0));
  let html = `<table class="compare-table"><thead><tr><th>المعيار</th>${ads.map(a => `<th>${a.title.substring(0,20)}</th>`).join('')}</tr></thead><tbody>`;
  rows.forEach(([label, fn]) => {
    html += `<tr><td style="font-weight:700;color:var(--navy);text-align:right">${label}</td>`;
    ads.forEach(a => {
      let cls = '';
      if (label.includes('السعر') && a.price === bestPrice) cls = 'compare-winner';
      if (label.includes('التقييم') && a.avgRating === bestRating && bestRating > 0) cls = 'compare-winner';
      html += `<td class="${cls}">${fn(a)}</td>`;
    });
    html += '</tr>';
  });
  html += `</tbody></table><div style="font-size:0.75rem;color:#888;margin-top:0.5rem;text-align:center">🟩 الأفضل في الفئة</div>`;
  document.getElementById('compareContent').innerHTML = html;
  document.getElementById('compareModal')?.classList.add('open');
}

// ===== COUPONS =====
function copyCoupon(code) {
  navigator.clipboard?.writeText(code).then(() => showToast('✅ تم نسخ الكوبون: ' + code)).catch(() => showToast('🎟️ الكوبون: ' + code));
}

// ===== SHARE =====
function shareAd(adId, title) {
  const url = window.location.href.split('?')[0] + '?ad=' + adId;
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('✅ تم نسخ الرابط!')).catch(() => showToast('🔗 ' + url));
  }
}

function shareWhatsApp(adId, title, city, price) {
  const url = window.location.href.split('?')[0] + '?ad=' + adId;
  const text = `🌿 *${title}*\n📍 ${city} · 💰 ${price} DH\n🔗 ${url}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

// ===== CLOUDINARY UPLOAD =====
const CLOUD_NAME = 'dhyqowfxt';
const UPLOAD_PRESET = 'relax_upload';

function handleImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedImgFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const preview = document.getElementById('imgPreview');
    if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
    const ph = document.getElementById('uploadPlaceholder');
    if (ph) ph.style.display = 'none';
    const strip = document.getElementById('photosStrip');
    if (strip) strip.style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  const progressBar = document.getElementById('uploadProgressBar');
  const progressDiv = document.getElementById('uploadProgress');
  if (progressDiv) progressDiv.style.display = 'block';
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && progressBar) progressBar.style.width = Math.round(e.loaded / e.total * 100) + '%';
    };
    xhr.onload = () => {
      if (progressDiv) progressDiv.style.display = 'none';
      if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url);
      else reject(new Error('Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`);
    xhr.send(formData);
  });
}

async function handleExtraImgs(event) {
  const files = [...event.target.files].slice(0, 3);
  const strip = document.getElementById('photosStrip');
  for (const file of files) {
    const url = await uploadToCloudinary(file);
    if (url) {
      uploadedPhotos.push(url);
      const thumb = document.createElement('img');
      thumb.className = 'photo-thumb'; thumb.src = url;
      thumb.onclick = () => { document.getElementById('imgPreview').src = url; document.getElementById('imgPreview').style.display='block'; document.getElementById('uploadPlaceholder').style.display='none'; };
      strip?.insertBefore(thumb, strip.querySelector('.photo-add-btn'));
    }
  }
}

function switchMainPhoto(adId, photoUrl, thumbEl) {
  const detail = document.getElementById('detailContent');
  if (!detail) return;
  const mainImg = detail.querySelector('.detail-img');
  if (mainImg) mainImg.src = photoUrl;
  document.querySelectorAll(`#galleryStrip_${adId} .photo-thumb`).forEach(t => t.classList.remove('active'));
  if (thumbEl) thumbEl.classList.add('active');
}

// ===== PWA =====
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  if (!localStorage.getItem('relax_pwa_dismissed')) setTimeout(showPWABanner, 3000);
  const btn = document.getElementById('btnInstall');
  if (btn) btn.style.opacity = '1';
});

window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
  hidePWABanner();
  showToast('✅ تم تثبيت التطبيق!');
});

function showPWABanner() { document.getElementById('pwaInstallBanner')?.classList.add('show'); }
function hidePWABanner() { document.getElementById('pwaInstallBanner')?.classList.remove('show'); }
function dismissPWABanner() { hidePWABanner(); localStorage.setItem('relax_pwa_dismissed', '1'); }

async function doInstallPWA() {
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') { showToast('✅ جاري التثبيت...'); hidePWABanner(); _deferredInstallPrompt = null; }
  } else {
    showToast('📲 iOS: اضغط "مشاركة" ثم "إضافة إلى الشاشة الرئيسية"');
  }
}
function installPWA() { doInstallPWA(); }

// ===== NOTIFICATIONS =====
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') localStorage.setItem('relax_notif', '1');
}

// ===== WELCOME =====
function showWelcomeNotif(user) {
  if (!user || localStorage.getItem('relax_welcomed_' + user.uid)) return;
  localStorage.setItem('relax_welcomed_' + user.uid, '1');
  setTimeout(() => showToast(`🌿 مرحباً ${user.displayName?.split(' ')[0] || 'بك'}! يسعدنا انضمامك لـ Relax`), 1500);
}

// ===== COOKIE CONSENT =====
function initCookieBanner() {
  if (!localStorage.getItem('relax_cookies_consent')) {
    setTimeout(() => { const b = document.getElementById('cookieBanner'); if (b) b.style.display = 'block'; }, 2500);
  }
}
function acceptCookies() { localStorage.setItem('relax_cookies_consent', 'accepted'); document.getElementById('cookieBanner').style.display = 'none'; showToast('✅ تم قبول Cookies'); }
function declineCookies() { localStorage.setItem('relax_cookies_consent', 'declined'); document.getElementById('cookieBanner').style.display = 'none'; }

// ===== BOOKING =====
async function submitBooking(adId) {
  if (!currentUser) { openAuthModal(); return; }
  const dateInput = document.getElementById('bookDate_' + adId);
  const date = dateInput?.value;
  if (!date) { showToast('⚠️ اختر التاريخ', true); return; }
  if (!selectedSlot) { showToast('⚠️ اختر الوقت', true); return; }
  const ad = allListings.find(a => a.id === adId);
  if (!ad) return;
  const btn = document.querySelector(`#bookSlots_${adId}`)?.closest('.booking-section')?.querySelector('.btn-book');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري...'; }
  try {
    const { collection, addDoc, serverTimestamp, doc, setDoc } = window._fbModules;
    await addDoc(collection(window._db, 'bookings'), {
      adId, adTitle: ad.title,
      userId: currentUser.uid, userName: currentUser.displayName || 'مجهول',
      adOwnerId: ad.userId, date, time: selectedSlot,
      status: 'pending', createdAt: serverTimestamp()
    });
    await setDoc(doc(window._db, 'booking_notifications', `${adId}_${currentUser.uid}_${Date.now()}`), {
      adId, adTitle: ad.title,
      fromUid: currentUser.uid, fromName: currentUser.displayName || 'مجهول',
      toUid: ad.userId, date, time: selectedSlot, seen: false, createdAt: serverTimestamp()
    });
    showToast('✅ تم إرسال طلب الحجز!');
    selectedSlot = null;
    document.querySelectorAll(`#bookSlots_${adId} .slot-btn`).forEach(b => b.classList.remove('selected'));
  } catch(e) { showToast('❌ خطأ في الحجز', true); console.error(e); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '✅ تأكيد الحجز'; } }
}

function selectSlot(el, adId, time) {
  if (el.classList.contains('booked')) return;
  document.querySelectorAll(`#bookSlots_${adId} .slot-btn`).forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedSlot = time;
}

async function loadBookingSlots(adId) {
  const date = document.getElementById('bookDate_' + adId)?.value;
  if (!date) return;
  const slotsEl = document.getElementById('bookSlots_' + adId);
  if (!slotsEl) return;
  const slots = ['9:00','10:00','11:00','12:00','14:00','15:00','16:00','17:00','18:00'];
  try {
    const { collection, getDocs, query, where } = window._fbModules;
    const snap = await getDocs(query(collection(window._db, 'bookings'), where('adId','==',adId), where('date','==',date), where('status','!=','rejected')));
    const bookedTimes = snap.docs.map(d => d.data().time);
    slotsEl.innerHTML = slots.map(s => `<div class="slot-btn ${bookedTimes.includes(s) ? 'booked' : ''}" onclick="selectSlot(this,'${adId}','${s}')">${s}</div>`).join('');
  } catch(e) { console.error(e); }
}

// ===== REVIEWS =====
function selectReviewStar(s, adId) {
  selectedReviewStars[adId] = s;
  const container = document.getElementById('reviewsList_' + adId)?.closest('.reviews-section');
  if (!container) return;
  container.querySelectorAll('.rev-star').forEach((el, i) => { el.style.color = i < s ? '#F6AD55' : '#ddd'; });
}

async function submitReview(adId) {
  if (!currentUser) { openAuthModal(); return; }
  const input = document.getElementById('reviewInput_' + adId);
  const text = input?.value.trim();
  const stars = selectedReviewStars[adId] || 0;
  if (!text) { showToast('⚠️ اكتب تعليقاً', true); return; }
  try {
    const { collection, addDoc, serverTimestamp, doc, updateDoc, getDocs, query, where } = window._fbModules;
    const existing = await getDocs(query(collection(window._db,'listings',adId,'reviews'), where('userId','==',currentUser.uid)));
    if (!existing.empty) { showToast('⚠️ علقت على هذا الإعلان من قبل', true); return; }
    await addDoc(collection(window._db,'listings',adId,'reviews'), {
      text, stars, userId: currentUser.uid,
      userName: currentUser.displayName || 'مجهول',
      userPhoto: currentUser.photoURL || '', createdAt: serverTimestamp(), ownerReply: null
    });
    const ad = allListings.find(a => a.id === adId);
    if (ad && stars > 0) {
      const newCount = (ad.ratingCount || 0) + 1;
      const newAvg = ((ad.avgRating || 0) * (ad.ratingCount || 0) + stars) / newCount;
      await updateDoc(doc(window._db,'listings',adId), { avgRating: newAvg, ratingCount: newCount });
      ad.avgRating = newAvg; ad.ratingCount = newCount;
    }
    if (input) input.value = '';
    selectedReviewStars[adId] = 0;
    document.getElementById('reviewsSection_' + adId)?.querySelectorAll('.rev-star').forEach(el => el.style.color = '#ddd');
    showToast('✅ تم إرسال تعليقك!');
    await loadReviews(adId);
    renderListings();
  } catch(e) { showToast('❌ خطأ', true); console.error(e); }
}

async function loadReviews(adId) {
  const listEl = document.getElementById('reviewsList_' + adId);
  if (!listEl) return;
  try {
    const { collection, getDocs, query } = window._fbModules;
    const snap = await getDocs(query(collection(window._db,'listings',adId,'reviews')));
    const reviews = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return tb - ta;
      });
    if (!reviews.length) { listEl.innerHTML = '<div style="color:#888;font-size:0.82rem;padding:0.3rem 0">لا توجد تعليقات — كن أول من يعلق!</div>'; return; }
    const ad = allListings.find(a => a.id === adId);
    const isOwner = ad?.userId === currentUser?.uid;
    listEl.innerHTML = reviews.map(r => {
      const starsHtml = r.stars ? [1,2,3,4,5].map(s=>`<span style="color:${s<=r.stars?'#F6AD55':'#ddd'};font-size:0.9rem">★</span>`).join('') : '';
      const avatarHtml = r.userPhoto
        ? `<img src="${r.userPhoto}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0" loading="lazy">`
        : `<div style="width:32px;height:32px;border-radius:50%;background:var(--beige);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">👤</div>`;
      const replyHtml = r.ownerReply
        ? `<div style="margin-top:0.6rem;padding:0.5rem 0.8rem;background:rgba(123,158,122,0.12);border-radius:8px;border-right:3px solid var(--sky)"><div style="font-size:0.72rem;color:var(--sky);font-weight:700;margin-bottom:2px">↩️ رد المعلن:</div><div style="font-size:0.82rem;color:var(--navy)">${escHtml(r.ownerReply)}</div></div>`
        : (isOwner ? `<button onclick="replyToReview('${adId}','${r._id}')" style="margin-top:0.4rem;background:none;border:1px solid var(--sky);color:var(--sky);border-radius:6px;padding:2px 8px;font-size:0.72rem;cursor:pointer;font-family:Tajawal">↩️ رد</button>` : '');
      return `<div class="review-item" style="display:flex;gap:0.7rem;align-items:flex-start">${avatarHtml}<div style="flex:1"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;font-size:0.85rem">${escHtml(r.userName)}</span><span>${starsHtml}</span></div><div style="font-size:0.85rem;color:var(--navy);margin-top:3px;line-height:1.5">${escHtml(r.text)}</div>${replyHtml}</div></div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

async function replyToReview(adId, reviewId) {
  if (!currentUser) return;
  const ad = allListings.find(a => a.id === adId);
  if (ad?.userId !== currentUser.uid) { showToast('⚠️ فقط صاحب الإعلان يمكنه الرد', true); return; }
  const replyText = prompt('اكتب ردك على التعليق:');
  if (!replyText?.trim()) return;
  try {
    const { doc, updateDoc } = window._fbModules;
    await updateDoc(doc(window._db,'listings',adId,'reviews',reviewId), { ownerReply: replyText.trim(), ownerReplyAt: new Date() });
    showToast('✅ تم إرسال ردك!');
    await loadReviews(adId);
  } catch(e) { showToast('❌ خطأ', true); }
}

// ===== PRO EXPIRY =====
async function checkProExpiry() {
  if (!currentUser) return;
  try {
    const { doc, getDoc } = window._fbModules;
    const snap = await getDoc(doc(window._db,'users',currentUser.uid));
    if (!snap.exists()) return;
    const data = snap.data();
    if (!data.proExpiry) return;
    const expiry = data.proExpiry.toDate ? data.proExpiry.toDate() : new Date(data.proExpiry);
    const daysLeft = Math.ceil((expiry - new Date()) / (1000*60*60*24));
    if (daysLeft <= 3 && daysLeft > 0) setTimeout(() => showToast(`⚠️ اشتراك PRO ينتهي خلال ${daysLeft} أيام!`, true), 3000);
    else if (daysLeft <= 0) setTimeout(() => showToast('❌ انتهى اشتراك PRO — جدد للاستمرار', true), 3000);
  } catch(e) { /* silent */ }
}

// ===== AVATAR UPLOAD =====
function triggerAvatarUpload() { document.getElementById('avatarFileInput')?.click(); }

async function uploadAvatar(event) {
  if (!currentUser) return;
  const file = event.target.files[0];
  if (!file) return;
  showToast('📸 جاري رفع الصورة...');
  try {
    const url = await uploadToCloudinary(file);
    await window._updateUserProfile({ photoURL: url });
    currentUser.photoURL = url;
    document.getElementById('myProfileAvatarWrap').innerHTML = `<img class="profile-avatar" src="${url}">`;
    const headerAvatar = document.querySelector('.user-avatar');
    if (headerAvatar) headerAvatar.src = url;
    showToast('✅ تم تحديث الصورة!');
  } catch(e) { showToast('❌ خطأ في رفع الصورة', true); }
}

async function uploadEditImg(event, adId) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.getElementById('ef_imgpreview_' + adId);
  if (preview) preview.src = URL.createObjectURL(file);
  _editImgPending[adId] = file;
}

// ===== QR CODE =====
function openQR(adId, title, city, price) {
  const url = window.location.href.split('?')[0] + '?ad=' + adId;
  _qrCurrentUrl = url;
  const titleEl = document.getElementById('qrAdTitle');
  if (titleEl) titleEl.textContent = title + ' · ' + city + ' · ' + price + ' درهم';
  const canvas = document.getElementById('qrCanvas');
  if (!canvas) return;
  canvas.innerHTML = '';
  const generateQR = () => {
    canvas.innerHTML = '';
    new QRCode(canvas, { text: url, width: 200, height: 200, colorDark: '#3D3529', colorLight: '#F5F0E8', correctLevel: QRCode.CorrectLevel.H });
  };
  if (window.QRCode) generateQR();
  else {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = generateQR;
    document.head.appendChild(script);
  }
  document.getElementById('qrModal')?.classList.add('open');
}

function downloadQR() {
  const canvas = document.querySelector('#qrCanvas canvas');
  if (!canvas) { showToast('⚠️ انتظر تحميل QR', true); return; }
  const link = document.createElement('a');
  link.download = 'relax-qr.png';
  link.href = canvas.toDataURL();
  link.click();
  showToast('✅ تم تحميل QR Code');
}

// ===== PHONE REVEAL =====
function revealPhone(e, phone, adId) {
  e.stopPropagation();
  const btn = document.getElementById('phoneReveal_' + adId);
  if (!btn) return;
  btn.textContent = '📞 ' + phone;
  btn.style.background = 'var(--sky)';
  btn.style.color = 'white';
  btn.onclick = () => window.open('tel:' + phone.replace(/[^0-9+]/g,''));
}

// ===== REPORT =====
async function openReport(adId) {
  if (!currentUser) { openAuthModal(); return; }
  const reason = prompt('سبب الإبلاغ:');
  if (!reason?.trim()) return;
  try {
    const { collection, addDoc, serverTimestamp } = window._fbModules;
    await addDoc(collection(window._db,'reports'), { adId, reason, userId: currentUser.uid, createdAt: serverTimestamp() });
    showToast('✅ تم الإبلاغ عن الإعلان، شكراً');
  } catch(e) { showToast('❌ خطأ في الإبلاغ', true); }
}

// ===== INIT =====
window.addEventListener('load', () => {
  // Dark mode
  if (localStorage.getItem('relax_dark') === '1') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('darkToggle');
    if (btn) btn.textContent = '☀️';
  }
  // Currency
  const cs = document.getElementById('currencySelect');
  if (cs) cs.value = currentCurrency;
  // Fav count
  const fc = document.getElementById('favCount');
  if (fc) fc.textContent = favorites.size;
  // Cookie banner
  initCookieBanner();
  // Lang
  if (lang !== 'ar') setLang(lang);
});

if (window._firebaseReady && window._db) {
  loadListings();
} else {
  window.addEventListener('firebaseReady', loadListings);
}
