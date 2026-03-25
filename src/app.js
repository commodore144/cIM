// cIM — commodore. Instant Messenger
// Frontend App Logic

const API = 'https://inspire.tail0e8d21.ts.net/cim';
const EMOJI_PATH = 'src/emojis/';

// ── Emoji List ──────────────────────────────────────────────────────────────
const EMOJIS = [
  // Faces & emotions
  'face-with-tears-of-joy','grinning-face-with-big-eyes','grinning-face-with-sweat',
  'grinning-squinting-face','beaming-face-with-smiling-eyes','smiling-face-with-smiling-eyes',
  'smiling-face-with-halo','smiling-face-with-heart-eyes','smiling-face-with-hearts',
  'smiling-face-with-sunglasses','smiling-face-with-tear','smiling-face-with-horns',
  'slightly-smiling-face','upside-down-face','winking-face','winking-face-with-tongue',
  'squinting-face-with-tongue','face-with-tongue','zany-face','money-mouth-face',
  'nerd-face','cowboy-hat-face','partying-face','disguised-face','face-with-monocle',
  'thinking-face','saluting-face','melting-face','shaking-face','half-moon-face',
  'face-with-raised-eyebrow','face-with-rolling-eyes','grimacing-face','face-without-mouth',
  'dotted-line-face','smirking-face','neutral-face','expressionless-face',
  'persevering-face','confused-face','worried-face','slightly-frowning-face',
  'frowning-face','face-with-head-bandage','face-with-thermometer','face-with-medical-mask',
  'sneezing-face','hot-face','cold-face','woozy-face','face-with-crossed-out-eyes',
  'face-with-spiral-eyes','exploding-head','face-vomiting','face-savoring-food',
  'drooling-face','sleeping-face','face-with-symbols-on-mouth','face-blowing-a-kiss',
  'kissing-face','kissing-face-with-closed-eyes','kissing-face-with-smiling-eyes',
  'face-holding-back-tears','loudly-crying-face','crying-face','hushed-face',
  'yawning-face','fearful-face','flushed-face','pleading-face','anxious-face-with-sweat',
  'sad-but-relieved-face','disappointed-face','weary-face','tired-face',
  'nauseated-face','angry-face','enraged-face','angry-face-with-horns','skull',
  'lying-face','relieved-face','pensive-face','star-struck','new-moon-face',
  // Cats
  'grinning-cat','grinning-cat-with-smiling-eyes','cat-with-tears-of-joy',
  'smiling-cat-with-heart-eyes','cat-with-wry-smile','kissing-cat','weary-cat',
  'crying-cat','pouting-cat',
  // Hands & body
  'thumbs-up','thumbs-down','ok-hand','clapping-hands','raising-hands','waving-hand',
  'folded-hands','flexed-biceps','oncoming-fist','backhand-index-pointing-up',
  'backhand-index-pointing-down','backhand-index-pointing-left','backhand-index-pointing-right',
  // Symbols & misc
  'red-heart','orange-heart','yellow-heart','green-heart','blue-heart','purple-heart',
  'brown-heart','black-heart','white-heart','pink-heart','cyan-heart','mending-heart',
  'broken-heart','fire','sparkles','star','dizzy','thought-bubble','speech-balloon',
  'right-anger-bubble','eye-in-speech-bubble','zzz','cyclone','high-voltage',
  'hundred-points','check-mark','cross-mark','exclamation-question-mark',
  'double-exclamation-mark','red-exclamation-mark','white-exclamation-mark',
  'red-question-mark','white-question-mark','warning','stop-sign','no-entry',
  'prohibited','no-bicycles','no-littering','no-mobile-phones','non-potable-water',
  'no-one-under-eighteen','no-pedestrians','no-smoking','anger-symbol','police-car-light',
  // Animals
  'cat-face','bird','duck','baby-chick','hatching-chick','hedgehog','snake',
  'turtle','crab','sauropod','dinosaur','spouting-whale','ghost','alien',
  'alien-monster','robot','moai',
  // Food & drink
  'red-apple','green-apple','pear','peach','cherries','banana','watermelon',
  'tangerine','lemon','lime','kiwi-fruit','pineapple','avacado','tomato','eggplant',
  'cucumber','carrot','garlic','onion','pepper','potato','cactus','mushroom',
  'four-leaf-clover','cherry-blossom','pizza','bacon','baguette','croissant',
  'waffle','pancakes','french-fries','popcorn','poultry-leg','meat-on-bone',
  'green-salad','shallow-pan-of-food','sushi','rice-ball','rice-cracker',
  'fish-cake-with-swirl','doughnut','cookie','chocolate-bar','candy','lollipop',
  'cupcake','pie','ice-cream','coconut','egg','salt','glass-of-milk','wine-glass',
  'beverage-box',
  // Objects
  'gem-stone','money-bag','crystal-ball','game-die','pool-8-ball','puzzle-piece',
  'bowling','boxing-glove','tennis-ball','rocket','light-bulb','magnet','key',
  'locked','floppy-disk','toolbox','fire-extinguisher','roll-of-paper','soap',
  'tooth','bone','pill','camera','camera-with-flash','compass','globe-meridians',
  'rainbow','snowman','christmas-tree','jack-o-lantern','party-popper',
  'triangular-flag','triangular-ruler','thread','yarn','socks','billed-cap',
  'crown','brain','headstone','wastebasket','file-folder','open-file-folder',
  'speaker-high','hear-no-evil-monkey','see-no-evil-monkey','speak-no-evil-monkey',
  // Medals
  '1st-place-medal','2nd-place-medal','3rd-place-medal',
  // Custom
  '_custom_alert','_custom_blink','_custom_bubble','_custom_content','_custom_unimpressed',
  // Pistol (why not)
  'pistol',
];

// ── State ──────────────────────────────────────────────────────────────────
let token = localStorage.getItem('cim_token') || null;
let myUsername = localStorage.getItem('cim_username') || null;
let ws = null;
let wsReconnectTimer = null;
let commMode = 'ws'; // or 'rest'
let pollTimer = null;
let buddies = {}; // username -> {online, status, away_message}
let openChats = {}; // username -> {winEl, unread}
let openRooms = {}; // room name -> {winEl}
let zCounter = 10;
let activeEmojiPicker = null; // currently open picker

// ── Audio ──────────────────────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', vol = 0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { }
}

function playDoorSound() {
  playTone(800, 0.08, 'square', 0.1);
  setTimeout(() => playTone(400, 0.12, 'square', 0.1), 80);
}

function playMsgSound() {
  playTone(880, 0.06, 'sine', 0.12);
  setTimeout(() => playTone(1100, 0.08, 'sine', 0.12), 60);
}

function playBuddyOnSound() {
  playTone(880, 0.08, 'sine', 0.1);
  setTimeout(() => playTone(1100, 0.06, 'sine', 0.1), 90);
  setTimeout(() => playTone(1320, 0.1, 'sine', 0.1), 170);
}

// ── Utilities ──────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateClock() {
  const clock = el('taskbar-clock');
  if (clock) clock.textContent = formatTime();
}
setInterval(updateClock, 5000);
updateClock();

// ── Emoji rendering ────────────────────────────────────────────────────────
const EMOJI_SET = new Set(EMOJIS);

// Convert :shortcode: in text to <img> tags. Text is pre-escaped.
function renderContent(rawText) {
  const escaped = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/:([a-z0-9_-]+):/g, (match, name) => {
    if (EMOJI_SET.has(name)) {
      return `<img class="chat-emoji" src="${EMOJI_PATH}${name}.png" alt=":${name}:" title=":${name}:">`;
    }
    return match;
  });
}

// Insert :shortcode: at cursor in a textarea
function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  textarea.value = val.slice(0, start) + text + val.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.focus();
}

// ── Emoji Picker ───────────────────────────────────────────────────────────
function createEmojiPicker(inputEl) {
  // Close any existing picker
  if (activeEmojiPicker) {
    activeEmojiPicker.remove();
    activeEmojiPicker = null;
  }

  const picker = document.createElement('div');
  picker.className = 'emoji-picker';

  // Search bar
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'emoji-search';
  search.placeholder = 'Search emojis...';
  picker.appendChild(search);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  picker.appendChild(grid);

  function renderGrid(filter = '') {
    grid.innerHTML = '';
    const filtered = filter
      ? EMOJIS.filter(e => e.includes(filter.toLowerCase()))
      : EMOJIS;
    if (filtered.length === 0) {
      grid.innerHTML = '<div style="padding:6px;font-size:11px;color:#808080;">No results</div>';
      return;
    }
    filtered.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.title = `:${name}:`;
      const img = document.createElement('img');
      img.src = `${EMOJI_PATH}${name}.png`;
      img.alt = `:${name}:`;
      img.width = 11;
      img.height = 11;
      btn.appendChild(img);
      btn.addEventListener('mousedown', e => {
        e.preventDefault(); // don't blur textarea
        insertAtCursor(inputEl, `:${name}:`);
        picker.remove();
        activeEmojiPicker = null;
      });
      grid.appendChild(btn);
    });
  }

  renderGrid();
  search.addEventListener('input', () => renderGrid(search.value));

  // Position above the input
  document.body.appendChild(picker);
  const rect = inputEl.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.top - picker.offsetHeight - 4) + 'px';

  // If it goes off screen upward, flip below
  if (parseFloat(picker.style.top) < 0) {
    picker.style.top = (rect.bottom + 4) + 'px';
  }

  activeEmojiPicker = picker;

  // Close on outside click
  setTimeout(() => {
    function outsideClick(e) {
      if (!picker.contains(e.target) && e.target !== inputEl) {
        picker.remove();
        activeEmojiPicker = null;
        document.removeEventListener('mousedown', outsideClick);
      }
    }
    document.addEventListener('mousedown', outsideClick);
  }, 0);
}

// ── API helpers ────────────────────────────────────────────────────────────
async function apiPost(path, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

async function apiGet(path) {
  const res = await fetch(API + path, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

async function apiDelete(path) {
  const res = await fetch(API + path, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.ok;
}

// ── Window management ──────────────────────────────────────────────────────
function makeDraggable(winEl, handleEl) {
  let dragging = false, ox = 0, oy = 0;
  handleEl.addEventListener('mousedown', e => {
    if (e.target.classList.contains('win-btn')) return;
    dragging = true;
    ox = e.clientX - winEl.offsetLeft;
    oy = e.clientY - winEl.offsetTop;
    focusWindow(winEl);
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    let x = e.clientX - ox;
    let y = e.clientY - oy;
    x = Math.max(0, Math.min(x, window.innerWidth - winEl.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - 28 - winEl.offsetHeight));
    winEl.style.left = x + 'px';
    winEl.style.top = y + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
  winEl.addEventListener('mousedown', () => focusWindow(winEl));
}

function focusWindow(winEl) {
  document.querySelectorAll('.cim-window.focused').forEach(w => w.classList.remove('focused'));
  winEl.classList.add('focused');
  winEl.style.zIndex = ++zCounter;
  updateTaskbar();
}

function placeWindowCascade() {
  const count = document.querySelectorAll('.chat-window, .room-window').length;
  const offset = count * 24;
  return { top: 40 + offset, left: 280 + offset };
}

function updateTaskbar() {
  const items = el('taskbar-items');
  items.innerHTML = '';
  const focused = document.querySelector('.cim-window.focused');

  addTaskbarItem('💬 Buddy List', el('buddy-list-window'), focused === el('buddy-list-window'));

  Object.entries(openChats).forEach(([user, chat]) => {
    const unread = chat.unread ? ` (${chat.unread})` : '';
    addTaskbarItem(`✉ ${user}${unread}`, chat.winEl, focused === chat.winEl);
  });

  Object.entries(openRooms).forEach(([room, r]) => {
    addTaskbarItem(`# ${room}`, r.winEl, focused === r.winEl);
  });
}

function addTaskbarItem(label, winEl, active) {
  const btn = document.createElement('button');
  btn.className = 'taskbar-item' + (active ? ' active-win' : '');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    winEl.style.display = 'block';
    focusWindow(winEl);
  });
  el('taskbar-items').appendChild(btn);
}

// ── Connection Mode Toggle ─────────────────────────────────────────────────
function setCommMode(mode) {
  commMode = mode;
  const ind = el('conn-indicator');
  const txt = el('conn-mode-text');
  if (mode === 'ws') {
    ind.className = 'conn-indicator ws';
    txt.textContent = 'WS';
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    connectWS();
  } else {
    ind.className = 'conn-indicator rest';
    txt.textContent = 'REST';
    if (ws) { ws.close(); ws = null; }
    startRESTPolling();
  }
}

el('conn-mode-toggle').addEventListener('click', () => {
  const next = commMode === 'ws' ? 'rest' : 'ws';
  localStorage.setItem('cim_commmode', next);
  setCommMode(next);
});

// ── Login / Register ───────────────────────────────────────────────────────
el('btn-login').addEventListener('click', doLogin);
el('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
el('login-username').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

el('btn-show-register').addEventListener('click', () => {
  el('btn-show-register').textContent = 'Sign On';
  el('btn-show-register').addEventListener('click', () => location.reload(), { once: true });
  el('btn-login').textContent = 'Register';
  el('btn-login').onclick = doRegister;
  document.querySelector('#login-window .titlebar-title').textContent = 'cIM — New User';
});

async function doLogin() {
  const username = el('login-username').value.trim();
  const password = el('login-password').value;
  el('login-error').textContent = '';
  if (!username || !password) { el('login-error').textContent = 'Fill in all fields'; return; }
  try {
    const data = await apiPost('/login', { username, password });
    token = data.token;
    myUsername = data.username;
    localStorage.setItem('cim_token', token);
    localStorage.setItem('cim_username', myUsername);
    document.title = `cIM — ${myUsername}`;
    enterDesktop();
  } catch (e) {
    el('login-error').textContent = e.message;
  }
}

async function doRegister() {
  const username = el('login-username').value.trim();
  const password = el('login-password').value;
  el('login-error').textContent = '';
  if (!username || !password) { el('login-error').textContent = 'Fill in all fields'; return; }
  if (username.length < 3) { el('login-error').textContent = 'Screen name must be 3+ chars'; return; }
  try {
    const data = await apiPost('/register', { username, password });
    token = data.token;
    myUsername = data.username;
    localStorage.setItem('cim_token', token);
    localStorage.setItem('cim_username', myUsername);
    document.title = `cIM — ${myUsername}`;
    enterDesktop();
  } catch (e) {
    el('login-error').textContent = e.message;
  }
}

// ── Desktop init ───────────────────────────────────────────────────────────
function enterDesktop() {
  el('login-screen').style.display = 'none';
  el('desktop').classList.add('active');
  el('taskbar').classList.add('active');
  el('self-name').textContent = myUsername;
  el('start-menu-username').textContent = myUsername;

  makeDraggable(el('buddy-list-window'), el('buddy-titlebar'));
  makeDraggable(el('away-dialog'), el('away-titlebar'));
  makeDraggable(el('add-buddy-dialog'), el('add-buddy-titlebar'));
  makeDraggable(el('rooms-window'), el('rooms-titlebar'));
  makeDraggable(el('about-dialog'), el('about-titlebar'));

  focusWindow(el('buddy-list-window'));
  const savedMode = localStorage.getItem('cim_commmode') || 'ws';
  setCommMode(savedMode);
}

// Auto-login if token exists
if (token && myUsername) {
  document.title = `cIM — ${myUsername}`;
  enterDesktop();
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS() {
  if (commMode !== 'ws') return;
  if (ws) ws.close();
  const wsUrl = API.replace('https://', 'wss://').replace('http://', 'ws://');
  ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

  ws.onopen = () => {
    el('disconnect-banner').classList.remove('visible');
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  };

  ws.onmessage = e => {
    try { handleWSMessage(JSON.parse(e.data)); }
    catch (err) { console.error('WS parse error', err); }
  };

  ws.onclose = () => {
    if (commMode !== 'ws') return;
    el('disconnect-banner').classList.add('visible');
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {
    if (ws) ws.close();
    console.log('WS error, falling back to REST');
    setCommMode('rest');
  };
}

async function startRESTPolling() {
  if (commMode !== 'rest') return;
  try {
    const data = await apiPost('/poll/connect', {}, true);
    handleWSMessage(data);
    pollLoop();
  } catch (e) {
    console.error('Poll connect failed', e);
    setTimeout(startRESTPolling, 5000);
  }
}

async function pollLoop() {
  if (commMode !== 'rest') return;
  try {
    const data = await apiGet('/poll/messages');
    if (data.messages) data.messages.forEach(msg => handleWSMessage(msg));
    el('disconnect-banner').classList.remove('visible');
    pollLoop();
  } catch (e) {
    el('disconnect-banner').classList.add('visible');
    pollTimer = setTimeout(pollLoop, 3000);
  }
}

function wsSend(msg) {
  if (commMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else if (commMode === 'rest') {
    handleRestSend(msg);
  }
}

async function handleRestSend(msg) {
  try {
    if (msg.type === 'dm') {
      await apiPost('/poll/dm', { to: msg.to, content: msg.content }, true);
      appendDMMessage(msg.to, 'self', myUsername, msg.content);
    } else if (msg.type === 'room_message') {
      await apiPost('/poll/room/message', { room: msg.room, content: msg.content }, true);
    } else if (msg.type === 'join_room') {
      const data = await apiPost('/poll/room/join', { room: msg.room }, true);
      handleWSMessage(data);
    } else if (msg.type === 'leave_room') {
      await apiPost('/poll/room/leave', { room: msg.room }, true);
    } else if (msg.type === 'typing') {
      await apiPost('/poll/typing', { to: msg.to }, true);
    }
  } catch (e) {
    console.error('Rest send failed', e);
  }
}

// ── Message handler ────────────────────────────────────────────────────────
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'init':
      el('self-name').textContent = msg.username;
      if (msg.away_message) {
        el('self-status-dot').className = 'status-dot away';
        el('away-input').value = msg.away_message;
      }
      msg.buddies.forEach(b => { buddies[b.username] = b; });
      renderBuddyList();
      break;
    case 'dm':
      receiveDM(msg.from, msg.content);
      break;
    case 'dm_echo':
      appendDMMessage(msg.to, 'self', myUsername, msg.content);
      break;
    case 'typing':
      showTyping(msg.from);
      break;
    case 'presence':
      handlePresence(msg.user, msg.status, msg.away_message);
      break;
    case 'room_message':
    case 'room_message_echo':
      appendRoomMessage(msg.room, msg.from, msg.content);
      break;
    case 'room_joined':
      onRoomJoined(msg.room, msg.members);
      break;
    case 'room_event':
      handleRoomEvent(msg);
      break;
  }
}

// ── Buddy List ─────────────────────────────────────────────────────────────
function renderBuddyList() {
  const body = el('buddy-list-body');
  const online  = Object.values(buddies).filter(b => b.online && b.status !== 'away');
  const away    = Object.values(buddies).filter(b => b.online && b.status === 'away');
  const offline = Object.values(buddies).filter(b => !b.online);

  body.innerHTML = '';

  if (Object.keys(buddies).length === 0) {
    body.innerHTML = '<div style="padding:8px 6px;font-size:11px;color:#808080;">No buddies yet.<br>Add someone to get started.</div>';
    return;
  }

  if (online.length)  renderBuddyGroup(body, `Online (${online.length})`,  online,  'online');
  if (away.length)    renderBuddyGroup(body, `Away (${away.length})`,      away,    'away');
  if (offline.length) renderBuddyGroup(body, `Offline (${offline.length})`,offline, 'offline');

  updateTaskbar();
}

function renderBuddyGroup(container, title, list, statusClass) {
  const group = document.createElement('div');
  group.className = 'buddy-group';

  const header = document.createElement('div');
  header.className = 'buddy-group-header';
  header.innerHTML = `<span>${title}</span><span class="toggle">▾</span>`;
  group.appendChild(header);

  const items = document.createElement('div');
  items.className = 'buddy-group-items';

  list.forEach(buddy => {
    const entry = document.createElement('div');
    entry.className = `buddy-entry ${statusClass}`;
    entry.innerHTML = `<div class="status-dot ${statusClass}"></div><span class="buddy-name">${buddy.username}</span>`;
    entry.addEventListener('dblclick', () => openDMWindow(buddy.username));
    items.appendChild(entry);

    if (buddy.away_message) {
      const awayLine = document.createElement('div');
      awayLine.className = 'buddy-away-text';
      awayLine.textContent = `"${buddy.away_message}"`;
      items.appendChild(awayLine);
    }
  });

  group.appendChild(items);

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    items.style.display = collapsed ? 'none' : '';
    header.querySelector('.toggle').textContent = collapsed ? '▸' : '▾';
  });

  container.appendChild(group);
}

function handlePresence(username, status, away_message) {
  if (!buddies[username]) return;
  const wasOnline = buddies[username].online;

  buddies[username].online = status !== 'offline';
  buddies[username].status = status;
  buddies[username].away_message = away_message;

  if (!wasOnline && status !== 'offline') {
    playBuddyOnSound();
    if (openChats[username]) appendDMMessage(username, 'system', null, `${username} is now online`);
  } else if (wasOnline && status === 'offline') {
    playDoorSound();
    if (openChats[username]) appendDMMessage(username, 'system', null, `${username} has signed off`);
  }

  // Update open chat window header
  if (openChats[username]) {
    const chatWith = openChats[username].winEl.querySelector('.chat-with');
    if (chatWith) {
      const dotClass = status === 'online' ? 'online' : status === 'away' ? 'away' : 'offline';
      chatWith.innerHTML = `<div class="status-dot ${dotClass}"></div>${username} — ${status}${away_message ? `: "${away_message}"` : ''}`;
    }
  }

  renderBuddyList();
}

// ── DM Windows ─────────────────────────────────────────────────────────────
function openDMWindow(username) {
  if (openChats[username]) {
    openChats[username].winEl.style.display = 'block';
    focusWindow(openChats[username].winEl);
    return;
  }

  const buddy = buddies[username] || { status: 'offline', away_message: '' };
  const pos = placeWindowCascade();
  const winEl = document.createElement('div');
  winEl.className = 'cim-window chat-window';
  winEl.style.top = pos.top + 'px';
  winEl.style.left = pos.left + 'px';
  winEl.innerHTML = `
    <div class="titlebar" id="chat-title-${username}">
      <span class="titlebar-icon">✉</span>
      <span class="titlebar-title">${username}</span>
      <div class="titlebar-buttons">
        <button class="win-btn close chat-close">✕</button>
      </div>
    </div>
    <div class="chat-with">
      <div class="status-dot ${buddy.status}"></div>
      ${username} — ${buddy.status}${buddy.away_message ? `: "${buddy.away_message}"` : ''}
    </div>
    <div class="chat-messages" id="msgs-${username}"></div>
    <div class="typing-indicator" id="typing-${username}"></div>
    <div class="chat-input-row">
      <button class="emoji-trigger" id="emoji-btn-dm-${username}" title="Emojis">😊</button>
      <textarea class="chat-input" id="input-${username}" placeholder="Message ${username}..." rows="2"></textarea>
      <button class="send-btn" id="send-${username}">Send</button>
    </div>
  `;

  document.getElementById('desktop').appendChild(winEl);
  makeDraggable(winEl, winEl.querySelector('.titlebar'));
  focusWindow(winEl);
  openChats[username] = { winEl, unread: 0 };

  winEl.querySelector('.chat-close').addEventListener('click', () => {
    winEl.style.display = 'none';
    delete openChats[username];
    updateTaskbar();
  });

  const inputEl = document.getElementById(`input-${username}`);
  document.getElementById(`send-${username}`).addEventListener('click', () => sendDM(username));
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDM(username); }
  });

  let typingTimer = null;
  inputEl.addEventListener('input', () => {
    wsSend({ type: 'typing', to: username });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {}, 2000);
  });

  document.getElementById(`emoji-btn-dm-${username}`).addEventListener('click', e => {
    e.stopPropagation();
    createEmojiPicker(inputEl);
  });

  loadDMHistory(username);
  updateTaskbar();
}

async function loadDMHistory(username) {
  try {
    const data = await apiGet(`/history/dm/${username}`);
    data.messages.forEach(msg => {
      appendDMMessage(username,
        msg.sender === myUsername ? 'self' : 'other',
        msg.sender, msg.content, msg.timestamp
      );
    });
  } catch { }
}

function sendDM(username) {
  const input = document.getElementById(`input-${username}`);
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  wsSend({ type: 'dm', to: username, content });
}

function receiveDM(from, content) {
  playMsgSound();
  if (!openChats[from]) openDMWindow(from);
  appendDMMessage(from, 'other', from, content);
  const focused = document.querySelector('.cim-window.focused');
  if (focused !== openChats[from]?.winEl) {
    openChats[from].unread = (openChats[from].unread || 0) + 1;
    updateTaskbar();
  }
}

function appendDMMessage(username, side, sender, content, timestamp) {
  const container = document.getElementById(`msgs-${username}`);
  if (!container) return;

  const div = document.createElement('div');
  div.className = `msg ${side}`;

  if (side !== 'system' && sender) {
    const senderEl = document.createElement('div');
    senderEl.className = 'msg-sender';
    senderEl.textContent = sender;
    div.appendChild(senderEl);
  }

  const text = document.createElement('div');
  text.className = 'msg-text';
  text.innerHTML = renderContent(content);
  div.appendChild(text);

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  if (openChats[username] && document.querySelector('.cim-window.focused') === openChats[username].winEl) {
    openChats[username].unread = 0;
    updateTaskbar();
  }
}

let typingTimers = {};
function showTyping(from) {
  const indicator = document.getElementById(`typing-${from}`);
  if (!indicator) return;
  indicator.textContent = `${from} is typing...`;
  clearTimeout(typingTimers[from]);
  typingTimers[from] = setTimeout(() => { indicator.textContent = ''; }, 3000);
}

// ── Room Windows ───────────────────────────────────────────────────────────
function openRoomWindow(roomName) {
  if (openRooms[roomName]) {
    openRooms[roomName].winEl.style.display = 'block';
    focusWindow(openRooms[roomName].winEl);
    return;
  }

  const pos = placeWindowCascade();
  const winEl = document.createElement('div');
  winEl.className = 'cim-window room-window';
  winEl.style.top = pos.top + 'px';
  winEl.style.left = pos.left + 'px';
  winEl.innerHTML = `
    <div class="titlebar" id="room-title-${roomName}">
      <span class="titlebar-icon">🚪</span>
      <span class="titlebar-title">#${roomName}</span>
      <div class="titlebar-buttons">
        <button class="win-btn close room-close">✕</button>
      </div>
    </div>
    <div class="room-layout">
      <div class="room-messages" id="room-msgs-${roomName}"></div>
      <div class="room-members" id="room-members-${roomName}">
        <div class="room-members-header">USERS</div>
      </div>
    </div>
    <div class="chat-input-row">
      <button class="emoji-trigger" id="emoji-btn-room-${roomName}" title="Emojis">😊</button>
      <textarea class="chat-input" id="room-input-${roomName}" placeholder="#${roomName}" rows="2"></textarea>
      <button class="send-btn" id="room-send-${roomName}">Send</button>
    </div>
  `;

  document.getElementById('desktop').appendChild(winEl);
  makeDraggable(winEl, winEl.querySelector('.titlebar'));
  focusWindow(winEl);
  openRooms[roomName] = { winEl };

  winEl.querySelector('.room-close').addEventListener('click', () => {
    wsSend({ type: 'leave_room', room: roomName });
    winEl.style.display = 'none';
    delete openRooms[roomName];
    updateTaskbar();
  });

  const roomInputEl = document.getElementById(`room-input-${roomName}`);
  document.getElementById(`room-send-${roomName}`).addEventListener('click', () => sendRoomMsg(roomName));
  roomInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRoomMsg(roomName); }
  });

  document.getElementById(`emoji-btn-room-${roomName}`).addEventListener('click', e => {
    e.stopPropagation();
    createEmojiPicker(roomInputEl);
  });

  wsSend({ type: 'join_room', room: roomName });
  loadRoomHistory(roomName);
  updateTaskbar();
}

async function loadRoomHistory(roomName) {
  try {
    const data = await apiGet(`/history/room/${roomName}`);
    data.messages.forEach(msg => appendRoomMessage(roomName, msg.sender, msg.content, msg.timestamp));
  } catch { }
}

function sendRoomMsg(roomName) {
  const input = document.getElementById(`room-input-${roomName}`);
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  wsSend({ type: 'room_message', room: roomName, content });
}

function appendRoomMessage(roomName, from, content, timestamp) {
  const container = document.getElementById(`room-msgs-${roomName}`);
  if (!container) return;
  const div = document.createElement('div');
  div.className = `msg ${from === myUsername ? 'self' : from === '—' ? 'system' : 'other'}`;
  if (from !== '—') {
    div.innerHTML = `<div class="msg-sender">${from}</div><div class="msg-text">${renderContent(content)}</div>`;
  } else {
    div.innerHTML = `<div class="msg-text" style="color:#808080;font-style:italic">${content}</div>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function onRoomJoined(roomName, members) {
  updateRoomMembers(roomName, members);
  appendRoomMessage(roomName, '—', `You joined #${roomName}`);
}

function updateRoomMembers(roomName, members) {
  const container = document.getElementById(`room-members-${roomName}`);
  if (!container) return;
  container.innerHTML = '<div class="room-members-header">USERS</div>';
  members.forEach(m => {
    const div = document.createElement('div');
    div.className = 'room-member';
    div.innerHTML = `<div class="status-dot online"></div>${m}`;
    div.addEventListener('dblclick', () => openDMWindow(m));
    container.appendChild(div);
  });
}

function handleRoomEvent(msg) {
  if (msg.event === 'join') {
    appendRoomMessage(msg.room, '—', `${msg.user} joined the room`);
    // Refresh members
    if (openRooms[msg.room]) {
      const membersEl = document.getElementById(`room-members-${msg.room}`);
      if (membersEl) {
        const existing = Array.from(membersEl.querySelectorAll('.room-member'))
          .map(el => el.textContent.trim());
        if (!existing.includes(msg.user)) {
          const div = document.createElement('div');
          div.className = 'room-member';
          div.innerHTML = `<div class="status-dot online"></div>${msg.user}`;
          div.addEventListener('dblclick', () => openDMWindow(msg.user));
          membersEl.appendChild(div);
        }
      }
    }
  } else if (msg.event === 'leave') {
    appendRoomMessage(msg.room, '—', `${msg.user} left the room`);
  }
}

// ── Away Message ───────────────────────────────────────────────────────────
el('btn-set-away').addEventListener('click', () => {
  el('away-dialog').style.display = 'block';
  el('away-dialog').style.top = '100px';
  el('away-dialog').style.left = '300px';
  focusWindow(el('away-dialog'));
});

el('btn-close-away').addEventListener('click', () => { el('away-dialog').style.display = 'none'; });
el('btn-save-away').addEventListener('click', () => saveAway(el('away-input').value.trim()));
el('btn-clear-away').addEventListener('click', () => { el('away-input').value = ''; saveAway(''); });

async function saveAway(message) {
  try {
    await apiPost('/away', { message }, true);
    const dot = el('self-status-dot');
    dot.className = 'status-dot ' + (message ? 'away' : 'online');
    el('away-dialog').style.display = 'none';
  } catch (e) {
    console.error(e);
  }
}

// ── Add Buddy ──────────────────────────────────────────────────────────────
el('btn-add-buddy').addEventListener('click', () => {
  el('add-buddy-dialog').style.display = 'block';
  el('add-buddy-dialog').style.top = '120px';
  el('add-buddy-dialog').style.left = '280px';
  focusWindow(el('add-buddy-dialog'));
  el('add-buddy-msg').textContent = '';
  el('add-buddy-input').value = '';
});

el('btn-close-add-buddy').addEventListener('click', () => { el('add-buddy-dialog').style.display = 'none'; });
el('btn-do-add-buddy').addEventListener('click', doAddBuddy);
el('add-buddy-input').addEventListener('keydown', e => { if (e.key === 'Enter') doAddBuddy(); });

async function doAddBuddy() {
  const username = el('add-buddy-input').value.trim().toLowerCase();
  const msgEl = el('add-buddy-msg');
  msgEl.textContent = '';
  msgEl.className = 'dialog-msg';
  if (!username) return;
  try {
    await apiPost('/buddy/add', { username }, true);
    msgEl.className = 'dialog-msg success';
    msgEl.textContent = `Added ${username}!`;
    el('add-buddy-input').value = '';
    buddies[username] = { username, online: false, status: 'offline', away_message: '' };
    renderBuddyList();
    setTimeout(() => { el('add-buddy-dialog').style.display = 'none'; }, 800);
  } catch (e) {
    msgEl.className = 'dialog-msg error';
    msgEl.textContent = e.message;
  }
}

// ── Rooms ──────────────────────────────────────────────────────────────────
el('btn-open-rooms').addEventListener('click', openRoomsList);
el('btn-close-rooms').addEventListener('click', () => { el('rooms-window').style.display = 'none'; });
el('btn-refresh-rooms').addEventListener('click', refreshRooms);
el('btn-create-room').addEventListener('click', async () => {
  const name = el('new-room-input').value.trim();
  if (!name) return;
  try {
    await apiPost('/rooms', { name }, true);
    el('new-room-input').value = '';
    await refreshRooms();
  } catch (e) { alert(e.message); }
});

async function openRoomsList() {
  el('rooms-window').style.display = 'block';
  el('rooms-window').style.top = '60px';
  el('rooms-window').style.left = '300px';
  focusWindow(el('rooms-window'));
  await refreshRooms();
}

async function refreshRooms() {
  try {
    const data = await apiGet('/rooms');
    const list = el('rooms-list');
    list.innerHTML = '';
    if (data.rooms.length === 0) {
      list.innerHTML = '<div style="padding:8px;font-size:11px;color:#808080;">No rooms yet. Create one below!</div>';
      return;
    }
    data.rooms.forEach(room => {
      const div = document.createElement('div');
      div.className = 'room-entry';
      div.innerHTML = `
        <div class="room-entry-info">
          <span class="room-entry-name">#${room.name}</span>
          ${room.topic ? `<span class="room-entry-topic">${room.topic}</span>` : ''}
        </div>
        <span class="room-entry-count">${room.members.length} online</span>
      `;
      div.addEventListener('dblclick', () => {
        openRoomWindow(room.name);
        el('rooms-window').style.display = 'none';
      });
      list.appendChild(div);
    });
  } catch { }
}

// ── Sign Off ───────────────────────────────────────────────────────────────
el('btn-signoff').addEventListener('click', doSignoff);

function doSignoff() {
  if (!confirm('Sign off from cIM?')) return;
  localStorage.removeItem('cim_token');
  localStorage.removeItem('cim_username');
  if (ws) ws.close();
  location.reload();
}

// ── Start Menu ─────────────────────────────────────────────────────────────
const startMenu = el('start-menu');

el('start-btn').addEventListener('click', e => {
  e.stopPropagation();
  startMenu.classList.toggle('open');
});

document.addEventListener('click', () => startMenu.classList.remove('open'));
startMenu.addEventListener('click', e => e.stopPropagation());

function smenu(fn) { startMenu.classList.remove('open'); fn(); }

el('smenu-buddy-list').addEventListener('click', () => smenu(() => {
  el('buddy-list-window').style.display = 'block';
  focusWindow(el('buddy-list-window'));
}));
el('smenu-rooms').addEventListener('click', () => smenu(() => openRoomsList()));
el('smenu-away').addEventListener('click', () => smenu(() => {
  el('away-dialog').style.display = 'block';
  el('away-dialog').style.top = '80px';
  el('away-dialog').style.left = '220px';
  focusWindow(el('away-dialog'));
}));
el('smenu-add-buddy').addEventListener('click', () => smenu(() => {
  el('add-buddy-dialog').style.display = 'block';
  el('add-buddy-dialog').style.top = '80px';
  el('add-buddy-dialog').style.left = '220px';
  el('add-buddy-msg').textContent = '';
  el('add-buddy-input').value = '';
  focusWindow(el('add-buddy-dialog'));
}));
el('smenu-about').addEventListener('click', () => smenu(() => openAbout()));
el('smenu-signoff').addEventListener('click', () => smenu(() => doSignoff()));

// ── About Dialog ───────────────────────────────────────────────────────────
function openAbout() {
  const about = el('about-dialog');
  about.style.display = 'block';
  about.style.top = '80px';
  about.style.left = '50%';
  about.style.transform = 'translateX(-50%)';
  el('about-username').textContent = myUsername || '—';
  focusWindow(about);
}

el('btn-close-about').addEventListener('click', () => { el('about-dialog').style.display = 'none'; });
el('btn-close-about-ok').addEventListener('click', () => { el('about-dialog').style.display = 'none'; });
