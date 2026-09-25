const aquarium = document.getElementById('aquarium');
const gameShell = document.getElementById('game-shell');
const authScreen = document.getElementById('auth-screen');
const authForm = document.getElementById('auth-form');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const authSubmitButton = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const authTabs = document.querySelectorAll('[data-auth-mode]');
const currentUserEl = document.getElementById('current-user');
const userInitialEl = document.getElementById('user-initial');
const logoutButton = document.getElementById('logout-button');
const memberSelect = document.getElementById('member-select');
const viewMemberButton = document.getElementById('view-member-button');
const returnOwnButton = document.getElementById('return-own-button');
const aquariumTitle = document.getElementById('aquarium-title');
const viewStatus = document.getElementById('view-status');
const fishForm = document.getElementById('fish-form');
const fishNameInput = document.getElementById('fish-name');
const fishTypeInput = document.getElementById('fish-type');
const feedAllButton = document.getElementById('feed-all');
const fishCountEl = document.getElementById('fish-count');
const largestFishEl = document.getElementById('largest-fish');
const statusTextEl = document.getElementById('status-text');

const ACCOUNTS_KEY = 'aquarium.accounts.v1';
const SESSION_KEY = 'aquarium.session.v1';
const fishList = [];
const foodPellets = [];
const memoryStorage = new Map();
const HUNGER_LIMIT_MS = 10 * 60 * 1000;
const STARVE_DEATH_MS = 24 * 60 * 60 * 1000;
const MAX_SIZE = 1.5;

let authMode = 'login';
let currentUser = null;
let viewedUser = null;
let previousFrame = performance.now();
let lastHudUpdate = 0;
let lastSaveAt = 0;

const FISH_TYPES = {
  goldfish: { name: 'Japon Balığı', image: 'assets/goldfish.png', width: 178, ratio: 1.5, tailStart: '62%', mouth: ['8%', '51%', '4%'] },
  angelfish: { name: 'Melek Balığı', image: 'assets/angelfish.png', width: 132, ratio: 1.07, tailStart: '72%', mouth: ['8%', '43%', '4%'] },
  betta: { name: 'Beta', image: 'assets/betta.png', width: 186, ratio: 1.5, tailStart: '59%', mouth: ['4%', '49%', '4%'] },
};

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return memoryStorage.get(key) || null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    memoryStorage.set(key, value);
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    memoryStorage.delete(key);
  }
}

function createId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch (error) {
    // Local file previews can restrict secure crypto APIs.
  }
  return `fish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeUsername(username) {
  return username.trim().toLocaleLowerCase('tr-TR');
}

function simpleHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16)}`;
}

async function hashPassword(password) {
  try {
    if (globalThis.crypto?.subtle) {
      const data = new TextEncoder().encode(password);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch (error) {
    // The fallback keeps local previews functional when SubtleCrypto is unavailable.
  }
  return simpleHash(password);
}

function getAccounts() {
  try {
    return JSON.parse(storageGet(ACCOUNTS_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function aquariumStorageKey(userKey) {
  return `aquarium.user.${encodeURIComponent(userKey)}.v1`;
}

function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.authMode === mode));
  authSubmitButton.textContent = mode === 'login' ? 'Giriş Yap' : 'Üyelik Oluştur';
  authPasswordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authError.textContent = '';
}

function clearAquarium() {
  fishList.splice(0).forEach((fish) => fish.element?.remove());
  foodPellets.splice(0).forEach((pellet) => pellet.element.remove());
  updateHud();
}

function serializeFish(fish) {
  return {
    id: fish.id,
    name: fish.name,
    typeKey: fish.typeKey,
    size: fish.size,
    health: fish.health,
    lastFedAt: fish.lastFedAt,
    x: fish.x,
    y: fish.y,
    direction: fish.direction,
    speed: fish.speed,
    verticalSpeed: fish.verticalSpeed,
    phase: fish.phase,
    alive: fish.alive,
  };
}

function saveCurrentAquarium() {
  if (!currentUser || viewedUser?.key !== currentUser.key) return;
  storageSet(aquariumStorageKey(currentUser.key), JSON.stringify(fishList.map(serializeFish)));
}

function isViewingOwnAquarium() {
  return Boolean(currentUser && viewedUser?.key === currentUser.key);
}

function setOwnerControlsEnabled(enabled) {
  fishForm.querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = !enabled;
  });
  feedAllButton.disabled = !enabled;
  returnOwnButton.hidden = enabled;
}

function refreshMemberList() {
  const accounts = getAccounts();
  const members = Object.entries(accounts).filter(([key]) => key !== currentUser?.key);
  memberSelect.replaceChildren();

  if (members.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Henüz başka üye yok';
    memberSelect.appendChild(option);
    memberSelect.disabled = true;
    viewMemberButton.disabled = true;
    return;
  }

  members.forEach(([key, account]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = account.displayName;
    memberSelect.appendChild(option);
  });
  memberSelect.disabled = false;
  viewMemberButton.disabled = false;
}

function updateHud() {
  const alive = fishList.filter((fish) => fish.alive);
  const largest = alive.reduce((max, fish) => Math.max(max, fish.size), 0);
  fishCountEl.textContent = String(alive.length);
  largestFishEl.textContent = `${Math.round(largest * 10)} cm`;
  statusTextEl.textContent = alive.length === 0 ? 'Sessiz' : alive.length < 4 ? 'Sakin' : alive.length < 7 ? 'Canlı' : 'Hareketli';
}

function createFish(name, selectedType, startPosition, savedData = null, persist = true) {
  const typeKey = FISH_TYPES[selectedType] ? selectedType : 'goldfish';
  const fish = {
    id: savedData?.id || createId(),
    name,
    typeKey,
    size: savedData?.size ?? 0.72 + Math.random() * 0.26,
    health: savedData?.health ?? 100,
    lastFedAt: savedData?.lastFedAt ?? Date.now(),
    x: savedData?.x ?? startPosition?.x ?? 18 + Math.random() * 64,
    y: savedData?.y ?? startPosition?.y ?? 18 + Math.random() * 48,
    direction: savedData?.direction ?? (Math.random() > 0.5 ? 1 : -1),
    speed: savedData?.speed ?? 2.1 + Math.random() * 2.3,
    verticalSpeed: savedData?.verticalSpeed ?? -0.7 + Math.random() * 1.4,
    phase: savedData?.phase ?? Math.random() * Math.PI * 2,
    nextTurn: performance.now() + 3500 + Math.random() * 5500,
    targetFoodId: null,
    alive: savedData?.alive ?? true,
    element: null,
  };

  if (Date.now() - fish.lastFedAt > STARVE_DEATH_MS) {
    fish.alive = false;
    fish.health = 0;
  }

  fishList.push(fish);
  buildFishElement(fish);
  updateHud();
  if (persist) saveCurrentAquarium();
}

function buildFishElement(fish) {
  const type = FISH_TYPES[fish.typeKey];
  const element = document.createElement('div');
  element.className = `fish ${fish.typeKey}`;
  element.dataset.fishId = fish.id;
  element.style.setProperty('--tail-start', type.tailStart);
  element.style.setProperty('--mouth-x', type.mouth[0]);
  element.style.setProperty('--mouth-y', type.mouth[1]);
  element.style.setProperty('--mouth-width', type.mouth[2]);

  const createImageLayer = (className, alt = '') => {
    const image = document.createElement('img');
    image.className = `fish-image-layer ${className}`;
    image.src = type.image;
    image.alt = alt;
    image.draggable = false;
    return image;
  };

  const bodyImage = createImageLayer('fish-body-image', type.name);
  const tailImage = createImageLayer('fish-tail-image');
  const finImage = createImageLayer('fish-fin-image');
  const mouth = document.createElement('span');
  mouth.className = 'fish-mouth';
  const name = document.createElement('div');
  name.className = 'fish-name';
  name.textContent = `${fish.name} · ${type.name}`;
  const status = document.createElement('div');
  status.className = 'fish-status';
  const bar = document.createElement('span');
  bar.className = 'fish-status-bar';
  status.appendChild(bar);
  element.append(bodyImage, tailImage, finImage, mouth, name, status);
  aquarium.appendChild(element);
  fish.element = element;
  renderFish(fish, performance.now());
}

function renderFish(fish, now) {
  const type = FISH_TYPES[fish.typeKey];
  const width = type.width * fish.size;
  const height = width / type.ratio;
  const sway = Math.sin(now / 850 + fish.phase) * 1.4;
  const facing = fish.direction > 0 ? -1 : 1;
  fish.element.style.width = `${width}px`;
  fish.element.style.height = `${height}px`;
  fish.element.style.left = `${fish.x}%`;
  fish.element.style.top = `${fish.y}%`;
  fish.element.style.transform = `translate(-50%, -50%) scaleX(${facing}) rotate(${sway * fish.direction}deg)`;
  fish.element.classList.toggle('facing-right', fish.direction > 0);
  fish.element.classList.toggle('dead', !fish.alive);
  fish.element.querySelector('.fish-status-bar').style.width = `${fish.health}%`;
}

function seedAquarium() {
  createFish('Nemo', 'goldfish', { x: 72, y: 20 }, null, false);
  createFish('Atlas', 'angelfish', { x: 27, y: 39 }, null, false);
  createFish('Mercan', 'betta', { x: 68, y: 57 }, null, false);
  saveCurrentAquarium();
}

function loadAquarium(owner) {
  clearAquarium();
  let savedFish = [];
  try {
    savedFish = JSON.parse(storageGet(aquariumStorageKey(owner.key)) || '[]');
  } catch (error) {
    savedFish = [];
  }

  if (!Array.isArray(savedFish) || savedFish.length === 0) {
    if (owner.key === currentUser.key) seedAquarium();
    return;
  }

  savedFish.forEach((data) => {
    if (!data?.name || !FISH_TYPES[data.typeKey]) return;
    createFish(data.name, data.typeKey, null, data, false);
  });
  saveCurrentAquarium();
}

function showAquarium(owner) {
  if (isViewingOwnAquarium()) saveCurrentAquarium();
  viewedUser = owner;
  const isOwn = owner.key === currentUser.key;
  aquariumTitle.textContent = isOwn ? `${owner.displayName} Akvaryumu` : `${owner.displayName} adlı üyenin akvaryumu`;
  viewStatus.classList.toggle('visiting', !isOwn);
  viewStatus.lastChild.textContent = isOwn ? ' Kendi akvaryumun' : ' Ziyaret görünümü';
  setOwnerControlsEnabled(isOwn);
  loadAquarium(owner);
  previousFrame = performance.now();
}

function showOwnAquarium() {
  if (!currentUser) return;
  showAquarium(currentUser);
}

function enterApp(userKey, displayName) {
  currentUser = { key: userKey, displayName };
  storageSet(SESSION_KEY, userKey);
  currentUserEl.textContent = displayName;
  userInitialEl.textContent = displayName.charAt(0).toLocaleUpperCase('tr-TR');
  authScreen.classList.add('is-hidden');
  gameShell.classList.remove('is-hidden');
  refreshMemberList();
  showOwnAquarium();
}

function logout() {
  saveCurrentAquarium();
  clearAquarium();
  currentUser = null;
  viewedUser = null;
  storageRemove(SESSION_KEY);
  gameShell.classList.add('is-hidden');
  authScreen.classList.remove('is-hidden');
  authPasswordInput.value = '';
  authError.textContent = '';
  authUsernameInput.focus();
}

function createFoodPellets(count = 12, centerX = null) {
  for (let index = 0; index < count; index += 1) {
    const element = document.createElement('span');
    element.className = 'feed-pellet';
    const x = centerX === null ? 12 + Math.random() * 76 : Math.max(8, Math.min(92, centerX - 8 + Math.random() * 16));
    const pellet = {
      id: createId(), element, x, y: 4 + Math.random() * 7,
      sinkSpeed: 2.4 + Math.random() * 2,
      drift: -0.28 + Math.random() * 0.56,
      bornAt: performance.now(), claimedBy: null,
    };
    foodPellets.push(pellet);
    aquarium.appendChild(element);
  }
}

function removePellet(pellet) {
  const index = foodPellets.indexOf(pellet);
  if (index !== -1) foodPellets.splice(index, 1);
  fishList.forEach((fish) => {
    if (fish.targetFoodId === pellet.id) fish.targetFoodId = null;
  });
  pellet.element.remove();
}

function rewardFish(fish) {
  fish.lastFedAt = Date.now();
  fish.health = Math.min(100, fish.health + 35);
  fish.size = Math.min(MAX_SIZE, fish.size + 0.035);
  fish.speed = Math.min(5.4, fish.speed + 0.12);
  saveCurrentAquarium();
}

function updatePellets(now, delta) {
  [...foodPellets].forEach((pellet) => {
    pellet.y += pellet.sinkSpeed * delta;
    pellet.x += pellet.drift * delta;
    pellet.element.style.left = `${pellet.x}%`;
    pellet.element.style.top = `${pellet.y}%`;
    pellet.element.style.transform = `translate(-50%, -50%) rotate(${pellet.y * 5}deg)`;
    if (pellet.y > 84 || now - pellet.bornAt > 18000) removePellet(pellet);
  });
}

function getNearestPellet(fish) {
  const currentTarget = foodPellets.find((pellet) => pellet.id === fish.targetFoodId);
  if (currentTarget) {
    return { pellet: currentTarget, distance: Math.hypot(currentTarget.x - fish.x, (currentTarget.y - fish.y) * 1.25) };
  }

  const nearest = foodPellets.reduce((candidate, pellet) => {
    if (pellet.claimedBy && pellet.claimedBy !== fish.id) return candidate;
    const distance = Math.hypot(pellet.x - fish.x, (pellet.y - fish.y) * 1.25);
    return !candidate || distance < candidate.distance ? { pellet, distance } : candidate;
  }, null);
  if (nearest) {
    nearest.pellet.claimedBy = fish.id;
    fish.targetFoodId = nearest.pellet.id;
  }
  return nearest;
}

function swimFish(fish, now, delta) {
  const foodTarget = getNearestPellet(fish);
  if (foodTarget) {
    const { pellet, distance } = foodTarget;
    const dx = pellet.x - fish.x;
    const dy = pellet.y - fish.y;
    const safeDistance = Math.max(distance, 0.01);
    if (Math.abs(dx) > 0.35) fish.direction = dx > 0 ? 1 : -1;
    fish.x += (dx / safeDistance) * fish.speed * 1.65 * delta;
    fish.y += (dy / safeDistance) * fish.speed * 1.2 * delta;
    fish.element.classList.toggle('eating', distance < 13);
    if (distance < 3.2) {
      removePellet(pellet);
      rewardFish(fish);
      fish.element.classList.remove('eating');
    }
    return;
  }

  fish.element.classList.remove('eating');
  if (now > fish.nextTurn) {
    if (Math.random() > 0.55) fish.direction *= -1;
    fish.verticalSpeed = -0.85 + Math.random() * 1.7;
    fish.nextTurn = now + 3500 + Math.random() * 6000;
  }
  fish.x += fish.direction * fish.speed * delta;
  fish.y += fish.verticalSpeed * delta + Math.sin(now / 1150 + fish.phase) * 0.008;
  if (fish.x < 7 || fish.x > 93) {
    fish.direction *= -1;
    fish.x = Math.max(7, Math.min(93, fish.x));
  }
  if (fish.y < 10 || fish.y > 72) {
    fish.verticalSpeed *= -1;
    fish.y = Math.max(10, Math.min(72, fish.y));
  }
}

function animate(now) {
  const delta = Math.min((now - previousFrame) / 1000, 0.04);
  previousFrame = now;
  if (currentUser) {
    updatePellets(now, delta);
    fishList.forEach((fish) => {
      if (!fish.alive) return;
      if (isViewingOwnAquarium()) {
        const hungryFor = Date.now() - fish.lastFedAt;
        if (hungryFor > HUNGER_LIMIT_MS) fish.health = Math.max(0, fish.health - delta * 0.02);
        if (hungryFor > STARVE_DEATH_MS || fish.health <= 0) {
          fish.alive = false;
          fish.health = 0;
          saveCurrentAquarium();
        }
      }
      if (fish.alive) swimFish(fish, now, delta);
      renderFish(fish, now);
    });

    if (now - lastHudUpdate > 500) {
      updateHud();
      lastHudUpdate = now;
    }
    if (now - lastSaveAt > 5000) {
      saveCurrentAquarium();
      lastSaveAt = now;
    }
  }
  requestAnimationFrame(animate);
}

authTabs.forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const displayName = authUsernameInput.value.trim();
  const userKey = normalizeUsername(displayName);
  const password = authPasswordInput.value;
  authError.textContent = '';

  if (displayName.length < 3 || password.length < 4) {
    authError.textContent = 'Kullanıcı adı en az 3, şifre en az 4 karakter olmalı.';
    return;
  }

  authSubmitButton.disabled = true;
  const accounts = getAccounts();
  const passwordHash = await hashPassword(password);

  if (authMode === 'register') {
    if (accounts[userKey]) {
      authError.textContent = 'Bu kullanıcı adı zaten kayıtlı.';
      authSubmitButton.disabled = false;
      return;
    }
    accounts[userKey] = { displayName, passwordHash, createdAt: Date.now() };
    storageSet(ACCOUNTS_KEY, JSON.stringify(accounts));
    enterApp(userKey, displayName);
  } else {
    const account = accounts[userKey];
    if (!account || account.passwordHash !== passwordHash) {
      authError.textContent = 'Kullanıcı adı veya şifre hatalı.';
      authSubmitButton.disabled = false;
      return;
    }
    enterApp(userKey, account.displayName);
  }

  authSubmitButton.disabled = false;
  authPasswordInput.value = '';
});

logoutButton.addEventListener('click', logout);
viewMemberButton.addEventListener('click', () => {
  const userKey = memberSelect.value;
  const account = getAccounts()[userKey];
  if (account) showAquarium({ key: userKey, displayName: account.displayName });
});
returnOwnButton.addEventListener('click', showOwnAquarium);

fishForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isViewingOwnAquarium()) return;
  const name = fishNameInput.value.trim();
  if (!name) return;
  createFish(name, fishTypeInput.value);
  fishNameInput.value = '';
  fishNameInput.focus();
});

feedAllButton.addEventListener('click', () => {
  if (!isViewingOwnAquarium()) return;
  createFoodPellets(Math.max(14, fishList.filter((fish) => fish.alive).length * 4));
});

aquarium.addEventListener('click', (event) => {
  if (!isViewingOwnAquarium()) return;
  const fishElement = event.target.closest('.fish');
  if (!fishElement) return;
  const fish = fishList.find((item) => item.id === fishElement.dataset.fishId);
  if (fish?.alive) createFoodPellets(4, fish.x);
});

window.addEventListener('beforeunload', saveCurrentAquarium);

function restoreSession() {
  const userKey = storageGet(SESSION_KEY);
  if (!userKey) return;
  const account = getAccounts()[userKey];
  if (account) enterApp(userKey, account.displayName);
  else storageRemove(SESSION_KEY);
}

restoreSession();
requestAnimationFrame(animate);
