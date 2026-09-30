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
const classForm = document.getElementById('class-form');
const classSelect = document.getElementById('class-select');
const classNameInput = document.getElementById('class-name');
const memberSelect = document.getElementById('member-select');
const viewMemberButton = document.getElementById('view-member-button');
const returnOwnButton = document.getElementById('return-own-button');
const aquariumTitle = document.getElementById('aquarium-title');
const viewStatus = document.getElementById('view-status');
const fishForm = document.getElementById('fish-form');
const fishNameInput = document.getElementById('fish-name');
const fishTypeInput = document.getElementById('fish-type');
const feedAllButton = document.getElementById('feed-all');
const studentListEl = document.getElementById('student-list');
const classGoalEl = document.getElementById('class-goal');
const fishCountEl = document.getElementById('fish-count');
const largestFishEl = document.getElementById('largest-fish');
const statusTextEl = document.getElementById('status-text');

const ACCOUNTS_KEY = 'aquarium.accounts.v1';
const SESSION_KEY = 'aquarium.session.v1';
const DEFAULT_CLASS_ID = 'default';
const fishList = [];
const foodPellets = [];
const memoryStorage = new Map();
const HUNGER_LIMIT_MS = 10 * 60 * 1000;
const STARVE_DEATH_MS = 24 * 60 * 60 * 1000;
const MAX_SIZE = 1.5;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_GROWTH_DAYS = 7;
const GROWTH_DAYS_STEP = 3;
const BASE_GROWTH_AMOUNT = 0.06;
const GROWTH_ANIMATION_SPEED = 0.0008;
const REWARD_GLOW_MS = 9000;
const TASK_TYPES = [
  { key: 'homework', label: 'Ödev' },
  { key: 'reading', label: 'Okuma' },
  { key: 'helping', label: 'Yardım' },
];
const AQUARIUM_THEMES = ['starfish', 'rocky', 'coral', 'planted'];

let authMode = 'login';
let currentUser = null;
let viewedUser = null;
let currentClassId = DEFAULT_CLASS_ID;
let previousFrame = performance.now();
let lastHudUpdate = 0;
let lastSaveAt = 0;

const FISH_TYPES = {
  goldfish: { name: 'Japon Balığı', image: 'assets/goldfish.png', width: 178, ratio: 1.5, tailStart: '62%', mouth: ['8%', '51%', '4%'] },
  angelfish: { name: 'Melek Balığı', image: 'assets/angelfish.png', width: 132, ratio: 1.07, tailStart: '72%', mouth: ['8%', '43%', '4%'] },
  betta: { name: 'Beta', image: 'assets/betta.png', width: 186, ratio: 1.5, tailStart: '59%', mouth: ['4%', '49%', '4%'] },
  guppy: { name: 'Lepistes', image: 'assets/guppy.png', width: 142, ratio: 1.5, tailStart: '58%', mouth: ['5%', '50%', '3.5%'] },
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

function classroomListKey(userKey) {
  return `aquarium.classes.${encodeURIComponent(userKey)}.v1`;
}

function selectedClassKey(userKey) {
  return `aquarium.selectedClass.${encodeURIComponent(userKey)}.v1`;
}

function aquariumStorageKey(userKey, classId = DEFAULT_CLASS_ID) {
  return `aquarium.user.${encodeURIComponent(userKey)}.class.${encodeURIComponent(classId)}.v1`;
}

function legacyAquariumStorageKey(userKey) {
  return `aquarium.user.${encodeURIComponent(userKey)}.v1`;
}

function normalizeClassName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

function createClassId(name) {
  return `class-${normalizeUsername(name)}-${Math.random().toString(16).slice(2, 8)}`;
}

function getThemeForClassroom(classroom, index = 0) {
  const normalizedName = normalizeClassName(classroom.name || '').toLocaleLowerCase('tr-TR');
  if (/^3\s*[/.\-]?[a-zçğıöşü]?/.test(normalizedName)) return 'starfish';
  if (/^4\s*[/.\-]?[a-zçğıöşü]?/.test(normalizedName)) return 'rocky';
  return classroom.theme || AQUARIUM_THEMES[index % AQUARIUM_THEMES.length];
}

function getClassrooms(userKey) {
  try {
    const parsed = JSON.parse(storageGet(classroomListKey(userKey)) || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((classroom, index) => ({ ...classroom, theme: getThemeForClassroom(classroom, index) }));
    }
  } catch (error) {
    // Fall through to the default classroom.
  }
  return [{ id: DEFAULT_CLASS_ID, name: '3/A Sınıfı', theme: 'starfish' }];
}

function saveClassrooms(userKey, classrooms) {
  storageSet(classroomListKey(userKey), JSON.stringify(classrooms));
}

function getCurrentClassroom() {
  return getClassrooms(viewedUser?.key || currentUser?.key || '').find((classroom) => classroom.id === currentClassId)
    || { id: DEFAULT_CLASS_ID, name: '3/A Sınıfı', theme: 'starfish' };
}

function applyClassroomTheme() {
  aquarium.dataset.theme = getCurrentClassroom().theme || 'classic';
}

function refreshClassrooms() {
  if (!currentUser) return;
  const classrooms = getClassrooms(currentUser.key);
  if (!classrooms.some((classroom) => classroom.id === currentClassId)) currentClassId = classrooms[0].id;
  classSelect.replaceChildren();
  classrooms.forEach((classroom) => {
    const option = document.createElement('option');
    option.value = classroom.id;
    option.textContent = classroom.name;
    classSelect.appendChild(option);
  });
  classSelect.value = currentClassId;
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
    targetSize: fish.targetSize,
    growthLevel: fish.growthLevel,
    dailyFeedStreak: fish.dailyFeedStreak,
    lastGrowthFeedDay: fish.lastGrowthFeedDay,
    completedTasks: fish.completedTasks,
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

function getStudentLabel(fish) {
  return fish.name;
}

function getDayKey(time = Date.now()) {
  return Math.floor(time / DAY_MS);
}

function getGrowthDaysNeeded(fish) {
  return BASE_GROWTH_DAYS + fish.growthLevel * GROWTH_DAYS_STEP;
}

function getGrowthAmount(fish) {
  return Math.max(0.022, BASE_GROWTH_AMOUNT - fish.growthLevel * 0.006);
}

function getTaskDayKey() {
  return String(getDayKey());
}

function saveCurrentAquarium() {
  if (!currentUser || viewedUser?.key !== currentUser.key) return;
  storageSet(aquariumStorageKey(currentUser.key, currentClassId), JSON.stringify(fishList.map(serializeFish)));
  storageSet(selectedClassKey(currentUser.key), currentClassId);
}

function isViewingOwnAquarium() {
  return Boolean(currentUser && viewedUser?.key === currentUser.key);
}

function setOwnerControlsEnabled(enabled) {
  fishForm.querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = !enabled;
  });
  classForm.querySelectorAll('input, select, button').forEach((control) => {
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
  const fedToday = alive.filter((fish) => fish.lastGrowthFeedDay === getDayKey()).length;
  fishCountEl.textContent = String(alive.length);
  largestFishEl.textContent = `${Math.round(largest * 10)} cm`;
  statusTextEl.textContent = alive.length === 0 ? 'Liste boş' : fedToday === alive.length ? 'Bugün tamam' : `${fedToday} öğrenci yemledi`;
  classGoalEl.textContent = `${fedToday}/${alive.length}`;
  renderStudentList();
}

function createFish(name, selectedType, startPosition, savedData = null, persist = true) {
  const typeKey = FISH_TYPES[selectedType] ? selectedType : 'goldfish';
  const initialSize = savedData?.size ?? 0.72 + Math.random() * 0.26;
  const fish = {
    id: savedData?.id || createId(),
    name,
    typeKey,
    size: initialSize,
    targetSize: savedData?.targetSize ?? initialSize,
    growthLevel: savedData?.growthLevel ?? 0,
    dailyFeedStreak: savedData?.dailyFeedStreak ?? 0,
    lastGrowthFeedDay: savedData?.lastGrowthFeedDay ?? null,
    completedTasks: savedData?.completedTasks ?? {},
    rewardGlowUntil: 0,
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
    alive: true,
    element: null,
  };

  fish.targetSize = Math.max(fish.size, Math.min(MAX_SIZE, fish.targetSize));

  if (Date.now() - fish.lastFedAt > STARVE_DEATH_MS) {
    fish.health = Math.max(18, fish.health - 35);
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
  name.textContent = `${getStudentLabel(fish)} · ${type.name}`;
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
  fish.element.classList.toggle('rewarded', now < fish.rewardGlowUntil);
  fish.element.querySelector('.fish-status-bar').style.width = `${fish.health}%`;
}

function seedAquarium() {
  createFish('Ayşe', 'goldfish', { x: 72, y: 20 }, null, false);
  createFish('Mert', 'angelfish', { x: 27, y: 39 }, null, false);
  createFish('Zeynep', 'guppy', { x: 68, y: 57 }, null, false);
  saveCurrentAquarium();
}

function loadAquarium(owner) {
  clearAquarium();
  let savedFish = [];
  try {
    const saved = storageGet(aquariumStorageKey(owner.key, currentClassId));
    const legacySaved = currentClassId === DEFAULT_CLASS_ID ? storageGet(legacyAquariumStorageKey(owner.key)) : null;
    savedFish = JSON.parse(saved || legacySaved || '[]');
  } catch (error) {
    savedFish = [];
  }

  if (!Array.isArray(savedFish) || savedFish.length === 0) {
    if (owner.key === currentUser.key && currentClassId === DEFAULT_CLASS_ID) seedAquarium();
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
  const classroom = getCurrentClassroom();
  applyClassroomTheme();
  aquariumTitle.textContent = isOwn ? `${classroom.name} Akvaryumu` : `${owner.displayName} · ${classroom.name}`;
  viewStatus.classList.toggle('visiting', !isOwn);
  viewStatus.lastChild.textContent = isOwn ? ` ${classroom.name}` : ' Ziyaret görünümü';
  setOwnerControlsEnabled(isOwn);
  loadAquarium(owner);
  previousFrame = performance.now();
}

function showOwnAquarium() {
  if (!currentUser) return;
  showAquarium(currentUser);
}

function switchClassroom(classId) {
  if (!currentUser || !isViewingOwnAquarium()) return;
  saveCurrentAquarium();
  currentClassId = classId || DEFAULT_CLASS_ID;
  storageSet(selectedClassKey(currentUser.key), currentClassId);
  refreshClassrooms();
  viewedUser = currentUser;
  const classroom = getCurrentClassroom();
  applyClassroomTheme();
  aquariumTitle.textContent = `${classroom.name} Akvaryumu`;
  viewStatus.classList.remove('visiting');
  viewStatus.lastChild.textContent = ` ${classroom.name}`;
  setOwnerControlsEnabled(true);
  loadAquarium(currentUser);
  previousFrame = performance.now();
}

function enterApp(userKey, displayName) {
  currentUser = { key: userKey, displayName };
  currentClassId = storageGet(selectedClassKey(userKey)) || DEFAULT_CLASS_ID;
  storageSet(SESSION_KEY, userKey);
  currentUserEl.textContent = displayName;
  userInitialEl.textContent = displayName.charAt(0).toLocaleUpperCase('tr-TR');
  authScreen.classList.add('is-hidden');
  gameShell.classList.remove('is-hidden');
  refreshClassrooms();
  refreshMemberList();
  showOwnAquarium();
}

function logout() {
  saveCurrentAquarium();
  clearAquarium();
  currentUser = null;
  viewedUser = null;
  currentClassId = DEFAULT_CLASS_ID;
  storageRemove(SESSION_KEY);
  gameShell.classList.add('is-hidden');
  authScreen.classList.remove('is-hidden');
  authPasswordInput.value = '';
  authError.textContent = '';
  authUsernameInput.focus();
}

function createFoodPellets(count = 1, centerX = null, ownerFishId = null) {
  for (let index = 0; index < count; index += 1) {
    const element = document.createElement('span');
    element.className = 'feed-pellet';
    const x = centerX === null ? 12 + Math.random() * 76 : Math.max(8, Math.min(92, centerX - 8 + Math.random() * 16));
    const pellet = {
      id: createId(), element, x, y: 4 + Math.random() * 7,
      sinkSpeed: 2.4 + Math.random() * 2,
      drift: -0.28 + Math.random() * 0.56,
      bornAt: performance.now(), ownerFishId, claimedBy: ownerFishId,
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
  recordDailyFeeding(fish);
  saveCurrentAquarium();
  updateHud();
}

function recordDailyFeeding(fish) {
  const today = getDayKey();
  if (fish.lastGrowthFeedDay === today) return;

  fish.dailyFeedStreak = fish.lastGrowthFeedDay === today - 1 ? fish.dailyFeedStreak + 1 : 1;
  fish.lastGrowthFeedDay = today;

  if (fish.dailyFeedStreak < getGrowthDaysNeeded(fish)) return;

  const growthAmount = getGrowthAmount(fish);
  fish.growthLevel += 1;
  fish.dailyFeedStreak = 0;
  fish.targetSize = Math.min(MAX_SIZE, fish.targetSize + growthAmount);
  fish.speed = Math.min(5.4, fish.speed + 0.06);
}

function updateFishGrowth(fish, delta) {
  if (fish.size >= fish.targetSize) return;
  fish.size = Math.min(fish.targetSize, fish.size + GROWTH_ANIMATION_SPEED * delta);
}

function getStudentStatus(fish) {
  if (fish.lastGrowthFeedDay === getDayKey()) return 'Bugün yemlendi';
  if (fish.health < 45) return 'İlgi bekliyor';
  return 'Bugün bekliyor';
}

function renderStudentList() {
  if (!studentListEl) return;
  studentListEl.replaceChildren();

  if (fishList.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'student-empty';
    empty.textContent = 'Öğrenci ekleyince balıkları burada görünecek.';
    studentListEl.appendChild(empty);
    return;
  }

  fishList.forEach((fish) => {
    const item = document.createElement('div');
    item.className = 'student-item';
    item.dataset.fishId = fish.id;

    const type = FISH_TYPES[fish.typeKey];
    const todayFed = fish.lastGrowthFeedDay === getDayKey();
    const daysNeeded = getGrowthDaysNeeded(fish);
    const streak = Math.min(fish.dailyFeedStreak, daysNeeded);
    const todayTasks = fish.completedTasks?.[getTaskDayKey()] ?? {};

    const name = document.createElement('strong');
    name.textContent = getStudentLabel(fish);

    const meta = document.createElement('span');
    meta.textContent = `${type.name} · ${getStudentStatus(fish)}`;

    const progress = document.createElement('small');
    progress.textContent = `Büyüme: ${streak}/${daysNeeded} gün`;

    const action = document.createElement('em');
    action.textContent = todayFed ? 'Tamam' : 'Yem ver';
    action.className = 'student-feed';

    const tasks = document.createElement('div');
    tasks.className = 'task-row';
    TASK_TYPES.forEach((task) => {
      const taskButton = document.createElement('button');
      taskButton.type = 'button';
      taskButton.className = 'task-button';
      taskButton.dataset.task = task.key;
      taskButton.disabled = !isViewingOwnAquarium() || Boolean(todayTasks[task.key]);
      taskButton.textContent = todayTasks[task.key] ? `${task.label} ✓` : task.label;
      tasks.appendChild(taskButton);
    });

    item.append(name, meta, progress, action, tasks);
    studentListEl.appendChild(item);
  });
}

function feedFish(fish, reward = false) {
  if (!fish?.alive || !isViewingOwnAquarium()) return;
  if (fish.lastGrowthFeedDay === getDayKey()) return;
  if (reward) fish.rewardGlowUntil = performance.now() + REWARD_GLOW_MS;
  createFoodPellets(1, fish.x, fish.id);
}

function rewardTask(fish, taskKey) {
  if (!fish?.alive || !TASK_TYPES.some((task) => task.key === taskKey) || !isViewingOwnAquarium()) return;
  const dayKey = getTaskDayKey();
  fish.completedTasks[dayKey] = fish.completedTasks[dayKey] ?? {};
  if (fish.completedTasks[dayKey][taskKey]) return;
  fish.completedTasks[dayKey][taskKey] = true;
  fish.rewardGlowUntil = performance.now() + REWARD_GLOW_MS;
  feedFish(fish, true);
  saveCurrentAquarium();
  updateHud();
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
  const currentTarget = foodPellets.find((pellet) => pellet.id === fish.targetFoodId && (!pellet.ownerFishId || pellet.ownerFishId === fish.id));
  if (currentTarget) {
    return { pellet: currentTarget, distance: Math.hypot(currentTarget.x - fish.x, (currentTarget.y - fish.y) * 1.25) };
  }

  const nearest = foodPellets.reduce((candidate, pellet) => {
    if (pellet.ownerFishId && pellet.ownerFishId !== fish.id) return candidate;
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
    const horizontalDistance = Math.max(Math.abs(dx), 0.01);
    const verticalDistance = Math.max(Math.abs(dy), 0.01);
    if (Math.abs(dx) > 0.35) fish.direction = dx > 0 ? 1 : -1;
    fish.x += (dx / horizontalDistance) * Math.min(horizontalDistance, fish.speed * 1.65 * delta);
    fish.y += (dy / verticalDistance) * Math.min(verticalDistance, fish.speed * 1.55 * delta);
    fish.x = Math.max(7, Math.min(93, fish.x));
    fish.y = Math.max(5, Math.min(76, fish.y));
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
        if (hungryFor > HUNGER_LIMIT_MS) fish.health = Math.max(18, fish.health - delta * 0.02);
      }
      updateFishGrowth(fish, delta);
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

classSelect.addEventListener('change', () => {
  if (!isViewingOwnAquarium()) return;
  switchClassroom(classSelect.value || DEFAULT_CLASS_ID);
});

classForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isViewingOwnAquarium()) return;
  const className = normalizeClassName(classNameInput.value);
  if (!className) return;
  const classrooms = getClassrooms(currentUser.key);
  const existing = classrooms.find((classroom) => classroom.name.toLocaleLowerCase('tr-TR') === className.toLocaleLowerCase('tr-TR'));
  const nextClassId = existing?.id || createClassId(className);
  if (!existing) {
    const classroom = { id: nextClassId, name: className };
    classrooms.push({ ...classroom, theme: getThemeForClassroom(classroom, classrooms.length) });
    saveClassrooms(currentUser.key, classrooms);
  }
  classNameInput.value = '';
  switchClassroom(nextClassId);
});

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
  fishList.filter((fish) => fish.alive && fish.lastGrowthFeedDay !== getDayKey()).forEach((fish) => feedFish(fish));
});

studentListEl.addEventListener('click', (event) => {
  const item = event.target.closest('.student-item');
  if (!item) return;
  const fish = fishList.find((candidate) => candidate.id === item.dataset.fishId);
  const taskButton = event.target.closest('[data-task]');
  if (taskButton) {
    rewardTask(fish, taskButton.dataset.task);
    return;
  }
  if (event.target.closest('.student-feed')) feedFish(fish);
});

aquarium.addEventListener('click', (event) => {
  if (!isViewingOwnAquarium()) return;
  const fishElement = event.target.closest('.fish');
  if (!fishElement) return;
  const fish = fishList.find((item) => item.id === fishElement.dataset.fishId);
  feedFish(fish);
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
