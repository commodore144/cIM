// cIM — commodore. Instant Messenger

const API        = 'https://inspire.tail0e8d21.ts.net/cim';
const EMOJI_PATH = 'src/emojis/';

// ── State ──────────────────────────────────────────────────────────────────
let token        = localStorage.getItem('cim_token')    || null;
let myUsername   = localStorage.getItem('cim_username') || null;
let ws           = null;
let wsReconnectTimer = null;
let commMode     = 'ws';
let pollTimer    = null;
let buddies      = {};           // username -> {online, status, away_message, emoji, status_type}
let pendingRequests = [];        // [{from, at}]
let openChats    = {};           // username -> {winEl, unread}
let openRooms    = {};           // room -> {winEl}
let zCounter     = 10;
let soundEnabled = localStorage.getItem('cim_sound') !== 'off';
let totalUnread  = 0;
let activeEmojiPicker = null;
let isAdmin      = false;
let roomInvites  = [];
// Own status tracking (can't use buddies[myUsername] - not in own list)
let myStatusType  = 'os';   // 'os' or 'as'
let myStatusMsg   = '';
let myStatusEmoji = '';
// Idle detection
let idleTimer     = null;
let isIdle        = false;   // currently in AS-idle?
let idleStarted   = false;   // only run after login
let lastActivityAt = 0;

// ── Emoji state ────────────────────────────────────────────────────────────
let EMOJIS    = [];
let EMOJI_SET = new Set();
let recentEmojis = JSON.parse(localStorage.getItem('cim_recent_emojis') || '[]');

async function loadEmojis() {
  try {
    const res = await fetch(`${EMOJI_PATH}emojis.json`);
    EMOJIS    = await res.json();
    EMOJI_SET = new Set(EMOJIS);
  } catch (e) { console.warn('Could not load emojis.json:', e); }
}

// ── Audio ──────────────────────────────────────────────────────────────────
const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() { if (!audioCtx) audioCtx = new AudioCtxClass(); return audioCtx; }

function playTone(freq, duration, type = 'sine', vol = 0.15) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch { }
}

function playDoorSound()     { playTone(800, 0.08, 'square', 0.1); setTimeout(() => playTone(400, 0.12, 'square', 0.1), 80); }
function playMsgSound()      { playTone(880, 0.06, 'sine', 0.12);  setTimeout(() => playTone(1100, 0.08, 'sine', 0.12), 60); }
function playBuddyOnSound()  { playTone(880, 0.08, 'sine', 0.1); setTimeout(() => playTone(1100, 0.06, 'sine', 0.1), 90); setTimeout(() => playTone(1320, 0.1, 'sine', 0.1), 170); }
function playRequestSound()  { playTone(660, 0.1, 'sine', 0.12); setTimeout(() => playTone(880, 0.15, 'sine', 0.12), 120); }

// ── Utilities ──────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateClock() { const c = el('taskbar-clock'); if (c) c.textContent = formatTime(); }
setInterval(updateClock, 5000);
updateClock();

function updateTitle() {
  document.title = totalUnread > 0 ? `(${totalUnread}) cIM — ${myUsername || ''}` : `cIM — ${myUsername || 'Sign On'}`;
}

function updateSelfStatusLine() {
  const line = el('self-status-line');
  if (!line) return;
  if (!myStatusMsg && !myStatusEmoji) {
    line.innerHTML = '';
    return;
  }
  const emojiHtml = myStatusEmoji
    ? `<img class="chat-emoji emoji-inline" src="${EMOJI_PATH}${myStatusEmoji}.png" alt="" style="width:11px;height:11px;vertical-align:middle;margin-right:2px;">`
    : '';
  const text = myStatusMsg ? myStatusMsg : '';
  const style = myStatusType === 'as' ? 'font-style:italic;color:#808080' : 'color:#000080';
  line.innerHTML = `<span style="${style}">${emojiHtml}${text}</span>`;
}

// ── Browser Notifications ──────────────────────────────────────────────────
function requestNotifPerms() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function sendNotif(title, body) {
  if (document.hasFocus()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: `${EMOJI_PATH}speech-balloon.png` });
}

// ── Emoji rendering ────────────────────────────────────────────────────────
function emojiMatches(name, query) {
  if (!query) return true;
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(p => name.includes(p));
}

// Detect if content is emoji-only (ignoring whitespace)
function isEmojiOnly(rawText) {
  return /^(\s*:[a-z0-9_-]+:\s*)+$/.test(rawText.trim());
}

function countEmojis(rawText) {
  return (rawText.match(/:[a-z0-9_-]+:/g) || []).length;
}

function renderContent(rawText) {
  const escaped = rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const onlyEmoji = isEmojiOnly(rawText);
  const emojiCount = onlyEmoji ? countEmojis(rawText) : 0;
  // solo = 1-3 emojis with no text → 32px; few-only = 4+ emojis only → 22px; inline = mixed → 16px
  const sizeClass = onlyEmoji
    ? (emojiCount <= 3 ? 'emoji-solo' : 'emoji-few')
    : 'emoji-inline';

  return escaped.replace(/:([a-z0-9_-]+):/g, (match, name) => {
    if (EMOJI_SET.has(name)) {
      return `<img class="chat-emoji ${sizeClass}" src="${EMOJI_PATH}${name}.png" alt=":${name}:" title=":${name}:">`;
    }
    return match;
  });
}

function renderStatusEmoji(name) {
  name = name.replace(/:/g, '');
  if (EMOJI_SET.has(name)) {
    return `<img class="status-emoji" src="${EMOJI_PATH}${name}.png" alt=":${name}:" title=":${name}:" style="width:16px; height:16px; margin-right:4px; vertical-align:middle;">`;
  }
  return '';
}

function updateStatusEmojiPreview(name) {
  name = name.replace(/:/g, '');
  const btn = el('status-emoji-btn');
  if (EMOJI_SET.has(name)) {
    btn.innerHTML = `<img src="${EMOJI_PATH}${name}.png" style="width:20px; height:20px;">`;
  } else {
    btn.innerHTML = '';
  }
}

function insertAtCursor(textarea, text) {
  const s = textarea.selectionStart, e = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, s) + text + textarea.value.slice(e);
  textarea.selectionStart = textarea.selectionEnd = s + text.length;
  textarea.focus();
}

function addRecentEmoji(name) {
  recentEmojis = [name, ...recentEmojis.filter(x => x !== name)].slice(0, 24);
  localStorage.setItem('cim_recent_emojis', JSON.stringify(recentEmojis));
}

// ── Emoji Picker ───────────────────────────────────────────────────────────
function createEmojiPicker(inputEl) {
  if (activeEmojiPicker) { activeEmojiPicker.remove(); activeEmojiPicker = null; }

  const picker = document.createElement('div');
  picker.className = 'emoji-picker';

  const search = document.createElement('input');
  search.type = 'text'; search.className = 'emoji-search';
  search.placeholder = 'Search... (e.g. "smiling face")';
  picker.appendChild(search);

  const tabs = document.createElement('div');
  tabs.className = 'emoji-tabs';
  const tabRecent = document.createElement('button'); tabRecent.className = 'emoji-tab active'; tabRecent.textContent = 'Recent';
  const tabAll    = document.createElement('button'); tabAll.className    = 'emoji-tab';        tabAll.textContent    = `All (${EMOJIS.length})`;
  tabs.appendChild(tabRecent); tabs.appendChild(tabAll);
  picker.appendChild(tabs);

  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  picker.appendChild(grid);

  let currentTab = 'recent';

  function renderGrid(filter = '') {
    grid.innerHTML = '';
    const hasFilter = filter.trim().length > 0;
    const source = (currentTab === 'recent' && !hasFilter) ? recentEmojis : EMOJIS;
    const filtered = hasFilter ? EMOJIS.filter(e => emojiMatches(e, filter)) : source;
    if (filtered.length === 0) {
      grid.innerHTML = `<div style="padding:6px;font-size:11px;color:#808080;">${hasFilter ? 'No results' : 'No recent emojis yet'}</div>`;
      return;
    }
    filtered.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn'; btn.title = `:${name}:`;
      const img = document.createElement('img');
      img.src = `${EMOJI_PATH}${name}.png`; img.alt = `:${name}:`;
      btn.appendChild(img);
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        insertAtCursor(inputEl, `:${name}:`);
        addRecentEmoji(name);
        picker.remove(); activeEmojiPicker = null;
      });
      grid.appendChild(btn);
    });
  }

  tabRecent.addEventListener('mousedown', e => { e.preventDefault(); currentTab = 'recent'; tabRecent.classList.add('active'); tabAll.classList.remove('active'); renderGrid(search.value); });
  tabAll.addEventListener('mousedown',    e => { e.preventDefault(); currentTab = 'all';    tabAll.classList.add('active'); tabRecent.classList.remove('active'); renderGrid(search.value); });
  search.addEventListener('input', () => renderGrid(search.value));
  renderGrid();

  document.body.appendChild(picker);
  const rect = inputEl.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  const top = rect.top - 264;
  picker.style.top = (top < 4 ? rect.bottom + 4 : top) + 'px';
  activeEmojiPicker = picker;
  search.focus();

  setTimeout(() => {
    function outside(e) { if (!picker.contains(e.target) && e.target !== inputEl) { picker.remove(); activeEmojiPicker = null; document.removeEventListener('mousedown', outside); } }
    document.addEventListener('mousedown', outside);
  }, 0);
}

// ── API helpers ────────────────────────────────────────────────────────────
async function apiPost(path, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

async function apiGet(path) {
  const res  = await fetch(API + path, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

async function apiDelete(path) {
  return fetch(API + path, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
}

// ── Window management ──────────────────────────────────────────────────────
function makeDraggable(winEl, handleEl) {
  let dragging = false, ox = 0, oy = 0;
  handleEl.addEventListener('mousedown', e => {
    if (e.target.classList.contains('win-btn')) return;
    dragging = true; ox = e.clientX - winEl.offsetLeft; oy = e.clientY - winEl.offsetTop;
    focusWindow(winEl); e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    winEl.style.left = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - winEl.offsetWidth)) + 'px';
    winEl.style.top  = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - 28 - winEl.offsetHeight)) + 'px';
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

// Escape closes the focused window
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const focused = document.querySelector('.cim-window.focused');
  if (focused && focused.id !== 'buddy-list-window') focused.style.display = 'none';
});

function placeWindowCascade() {
  const count = document.querySelectorAll('.chat-window, .room-window').length;
  return { top: 40 + count * 24, left: 280 + count * 24 };
}

function updateTaskbar() {
  const items = el('taskbar-items');
  items.innerHTML = '';
  const focused = document.querySelector('.cim-window.focused');
  addTaskbarItem('💬 Buddy List', el('buddy-list-window'), focused === el('buddy-list-window'));
  totalUnread = 0;
  Object.entries(openChats).forEach(([user, chat]) => {
    totalUnread += chat.unread || 0;
    addTaskbarItem(chat.unread ? `✉ ${user} (${chat.unread})` : `✉ ${user}`, chat.winEl, focused === chat.winEl);
  });
  Object.entries(openRooms).forEach(([room, r]) => addTaskbarItem(`# ${room}`, r.winEl, focused === r.winEl));
  updateTitle();
}

function addTaskbarItem(label, winEl, active) {
  const btn = document.createElement('button');
  btn.className = 'taskbar-item' + (active ? ' active-win' : '');
  btn.textContent = label;
  btn.addEventListener('click', () => { winEl.style.display = 'block'; focusWindow(winEl); });
  el('taskbar-items').appendChild(btn);
}

// ── Sound toggle ───────────────────────────────────────────────────────────
function updateSoundBtn() {
  const btn = el('sound-toggle');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔊' : '🔇';
  btn.title = soundEnabled ? 'Sound ON' : 'Sound OFF';
}

el('sound-toggle')?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('cim_sound', soundEnabled ? 'on' : 'off');
  updateSoundBtn();
});

// ── Connection mode ────────────────────────────────────────────────────────
function setCommMode(mode) {
  commMode = mode;
  const ind = el('conn-indicator'), txt = el('conn-mode-text');
  if (mode === 'ws') {
    ind.className = 'conn-indicator ws'; txt.textContent = 'WS';
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    connectWS();
  } else {
    ind.className = 'conn-indicator rest'; txt.textContent = 'REST';
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
  el('login-window').querySelector('.titlebar-title').textContent = 'cIM — New User';
});

async function doLogin() {
  const username = el('login-username').value.trim(), password = el('login-password').value;
  el('login-error').textContent = '';
  if (!username || !password) { el('login-error').textContent = 'Fill in all fields'; return; }
  try {
    const data = await apiPost('/login', { username, password });
    token = data.token; myUsername = data.username;
    localStorage.setItem('cim_token', token); localStorage.setItem('cim_username', myUsername);
    enterDesktop();
  } catch (e) { el('login-error').textContent = e.message; }
}

async function doRegister() {
  const username = el('login-username').value.trim(), password = el('login-password').value;
  el('login-error').textContent = '';
  if (!username || !password) { el('login-error').textContent = 'Fill in all fields'; return; }
  if (username.length < 3) { el('login-error').textContent = 'Screen name must be 3+ chars'; return; }
  try {
    const data = await apiPost('/register', { username, password });
    token = data.token; myUsername = data.username;
    localStorage.setItem('cim_token', token); localStorage.setItem('cim_username', myUsername);
    enterDesktop();
  } catch (e) { el('login-error').textContent = e.message; }
}

// ── Desktop init ───────────────────────────────────────────────────────────
function enterDesktop() {
  el('login-screen').style.display = 'none';
  el('desktop').classList.add('active');
  el('taskbar').classList.add('active');
  el('self-name').textContent = myUsername;
  el('start-menu-username').textContent = myUsername;

  makeDraggable(el('buddy-list-window'), el('buddy-titlebar'));
  makeDraggable(el('away-dialog'),       el('away-titlebar'));
  makeDraggable(el('add-buddy-dialog'), el('add-buddy-titlebar'));
  makeDraggable(el('rooms-window'),     el('rooms-titlebar'));
  makeDraggable(el('about-dialog'),     el('about-titlebar'));
  makeDraggable(el('admin-window'),     el('admin-titlebar'));
  makeDraggable(el('invite-dialog'),    el('invite-titlebar'));

  updateSoundBtn(); updateTitle(); requestNotifPerms(); loadEmojis();
  focusWindow(el('buddy-list-window'));
  setCommMode(localStorage.getItem('cim_commmode') || 'ws');
  startIdleDetection();
}

if (token && myUsername) enterDesktop();

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS() {
  if (commMode !== 'ws') return;
  if (ws) ws.close();
  const wsUrl = API.replace('https://', 'wss://').replace('http://', 'ws://');
  ws = new WebSocket(`${wsUrl}/ws?token=${token}`);
  ws.onopen    = () => { el('disconnect-banner').classList.remove('visible'); if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; } };
  ws.onmessage = e => { try { handleWSMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose   = () => { if (commMode !== 'ws') return; el('disconnect-banner').classList.add('visible'); wsReconnectTimer = setTimeout(connectWS, 3000); };
  ws.onerror   = () => { if (ws) ws.close(); setCommMode('rest'); };
}

async function startRESTPolling() {
  if (commMode !== 'rest') return;
  try { handleWSMessage(await apiPost('/poll/connect', {}, true)); pollLoop(); }
  catch (e) { console.error('Poll connect failed', e); setTimeout(startRESTPolling, 5000); }
}

async function pollLoop() {
  if (commMode !== 'rest') return;
  try {
    const data = await apiGet('/poll/messages');
    if (data.messages) data.messages.forEach(handleWSMessage);
    el('disconnect-banner').classList.remove('visible');
    pollLoop();
  } catch { el('disconnect-banner').classList.add('visible'); pollTimer = setTimeout(pollLoop, 3000); }
}

function wsSend(msg) {
  if (commMode === 'ws' && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else if (commMode === 'rest') handleRestSend(msg);
}

async function handleRestSend(msg) {
  try {
    if      (msg.type === 'dm')           { await apiPost('/poll/dm', { to: msg.to, content: msg.content }, true); appendDMMessage(msg.to, 'self', myUsername, msg.content); }
    else if (msg.type === 'room_message') await apiPost('/poll/room/message', { room: msg.room, content: msg.content }, true);
    else if (msg.type === 'join_room')    handleWSMessage(await apiPost('/poll/room/join',  { room: msg.room }, true));
    else if (msg.type === 'leave_room')   await apiPost('/poll/room/leave', { room: msg.room }, true);
    else if (msg.type === 'typing')       await apiPost('/poll/typing', { to: msg.to }, true);
  } catch (e) { console.error('Rest send failed', e); }
}

// ── Message handler ────────────────────────────────────────────────────────
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'init':
      el('self-name').textContent = msg.username;
      // Restore own status from server
      myStatusMsg   = msg.away_message || '';
      myStatusEmoji = msg.emoji || '';
      myStatusType  = msg.status_type || 'os';
      if (myStatusMsg || myStatusEmoji) {
        const dotClass = (myStatusType === 'as' && myStatusMsg) ? 'away' : 'online';
        el('self-status-dot').className = 'status-dot ' + dotClass;
        el('away-input').value = myStatusMsg;
        if (myStatusEmoji) {
          el('status-emoji-input').value = myStatusEmoji;
          updateStatusEmojiPreview(myStatusEmoji);
        }
      }
      updateSelfStatusLine();
      msg.buddies.forEach(b => { buddies[b.username] = b; });
      pendingRequests = msg.pending_requests || [];
      roomInvites = msg.room_invites || [];
      isAdmin = msg.is_admin || false;
      if (isAdmin) {
        el('smenu-admin').style.display = 'flex';
        el('smenu-admin-div').style.display = 'block';
      }
      renderBuddyList();
      break;
    case 'dm':                receiveDM(msg.from, msg.content); break;
    case 'dm_echo':           appendDMMessage(msg.to, 'self', myUsername, msg.content); break;
    case 'typing':            showTyping(msg.from); break;
    case 'presence':          handlePresence(msg.user, msg.status, msg.away_message, msg.emoji, msg.status_type); break;
    case 'room_message':
    case 'room_message_echo': appendRoomMessage(msg.room, msg.from, msg.content); break;
    case 'room_joined':       onRoomJoined(msg.room, msg.members); break;
    case 'room_event':        handleRoomEvent(msg); break;
    case 'buddy_request':     handleIncomingRequest(msg.from); break;
    case 'buddy_accepted':    handleBuddyAccepted(msg); break;
    case 'buddy_removed':     handleBuddyRemoved(msg.username); break;
    case 'room_invite_received':
      playRequestSound();
      sendNotif(`cIM`, `${msg.from} invited you to #${msg.room}`);
      if (!roomInvites.find(r => r.room === msg.room && r.from === msg.from)) {
        roomInvites.push({ room: msg.room, from: msg.from, at: new Date().toISOString() });
      }
      renderBuddyList();
      break;
    case 'room_error':
      showToast(msg.error);
      if (openRooms[msg.room]) {
          openRooms[msg.room].winEl.style.display = 'none';
          delete openRooms[msg.room];
          updateTaskbar();
      }
      break;
  }
}

// ── Buddy Requests ─────────────────────────────────────────────────────────
function handleIncomingRequest(fromUser) {
  playRequestSound();
  sendNotif('cIM — Buddy Request', `${fromUser} wants to add you as a buddy`);
  if (!pendingRequests.find(r => r.from === fromUser)) {
    pendingRequests.push({ from: fromUser, at: new Date().toISOString() });
  }
  renderBuddyList();
}

function handleBuddyAccepted(msg) {
  // They accepted our request OR we accepted theirs — add to local buddy list
  buddies[msg.username] = {
    username: msg.username,
    online: msg.online,
    status: msg.status,
    away_message: msg.away_message || '',
    emoji: msg.emoji || '',
    status_type: msg.status_type || 'os'
  };
  playBuddyOnSound();
  sendNotif('cIM', `${msg.username} accepted your buddy request!`);
  renderBuddyList();
}

function handleBuddyRemoved(username) {
  delete buddies[username];
  renderBuddyList();
  // If DM window is open, show system message
  if (openChats[username]) appendDMMessage(username, 'system', null, `${username} removed you from their buddy list`);
}

async function sendBuddyRequest(username) {
  try {
    await apiPost(`/buddy/request/${username}`, {}, true);
    showToast(`Buddy request sent to ${username}!`);
    el('add-buddy-dialog').style.display = 'none';
  } catch (e) {
    const msgEl = el('add-buddy-msg');
    msgEl.className = 'dialog-msg error';
    msgEl.textContent = e.message;
  }
}

async function acceptRequest(fromUser) {
  try {
    const data = await apiPost(`/buddy/request/accept/${fromUser}`, {}, true);
    pendingRequests = pendingRequests.filter(r => r.from !== fromUser);
    if (data.buddy) {
      buddies[data.buddy.username] = data.buddy;
    }
    renderBuddyList();
  } catch (e) { console.error(e); }
}

async function declineRequest(fromUser) {
  try {
    await apiPost(`/buddy/request/decline/${fromUser}`, {}, true);
    pendingRequests = pendingRequests.filter(r => r.from !== fromUser);
    renderBuddyList();
  } catch (e) { console.error(e); }
}

async function acceptRoomInvite(roomName) {
  try {
    await apiPost(`/rooms/invite/accept/${roomName}`, {}, true);
    roomInvites = roomInvites.filter(r => r.room !== roomName);
    renderBuddyList();
    openRoomWindow(roomName);
  } catch (e) { showToast(e.message); }
}

async function declineRoomInvite(roomName) {
  try {
    await apiPost(`/rooms/invite/decline/${roomName}`, {}, true);
    roomInvites = roomInvites.filter(r => r.room !== roomName);
    renderBuddyList();
  } catch (e) { showToast(e.message); }
}

// ── Buddy List ─────────────────────────────────────────────────────────────
function renderBuddyList() {
  const body    = el('buddy-list-body');
  const online  = Object.values(buddies).filter(b => b.online && b.status !== 'away');
  const away    = Object.values(buddies).filter(b => b.online && b.status === 'away');
  const offline = Object.values(buddies).filter(b => !b.online);

  body.innerHTML = '';

  // ── Pending requests section ────────────────────────────────────────────
  if (pendingRequests.length > 0) {
    const section = document.createElement('div');
    section.className = 'buddy-requests-section';

    const hdr = document.createElement('div');
    hdr.className = 'buddy-requests-header';
    hdr.innerHTML = `⚠ ${pendingRequests.length} Buddy Request${pendingRequests.length > 1 ? 's' : ''}`;
    section.appendChild(hdr);

    pendingRequests.forEach(req => {
      const row = document.createElement('div');
      row.className = 'buddy-request-row';
      row.innerHTML = `
        <span class="buddy-request-name">${req.from}</span>
        <div class="buddy-request-btns">
          <button class="req-btn accept" title="Accept">✓</button>
          <button class="req-btn decline" title="Decline">✕</button>
        </div>
      `;
      row.querySelector('.accept').addEventListener('click',  () => acceptRequest(req.from));
      row.querySelector('.decline').addEventListener('click', () => declineRequest(req.from));
      section.appendChild(row);
    });

    body.appendChild(section);
  }

  if (roomInvites.length > 0) {
    const rSection = document.createElement('div');
    rSection.className = 'buddy-requests-section';

    const rHdr = document.createElement('div');
    rHdr.className = 'buddy-requests-header';
    rHdr.innerHTML = `✉ ${roomInvites.length} Room Invite${roomInvites.length > 1 ? 's' : ''}`;
    rSection.appendChild(rHdr);

    roomInvites.forEach(inv => {
      const row = document.createElement('div');
      row.className = 'buddy-request-row';
      row.innerHTML = `
        <span class="buddy-request-name" style="font-size:10px;">#${inv.room} (by ${inv.from})</span>
        <div class="buddy-request-btns">
          <button class="req-btn accept" title="Join">✓</button>
          <button class="req-btn decline" title="Decline">✕</button>
        </div>
      `;
      row.querySelector('.accept').addEventListener('click', () => acceptRoomInvite(inv.room));
      row.querySelector('.decline').addEventListener('click', () => declineRoomInvite(inv.room));
      rSection.appendChild(row);
    });
    body.appendChild(rSection);
  }

  if (Object.keys(buddies).length === 0 && pendingRequests.length === 0 && roomInvites.length === 0) {
    body.innerHTML = '<div style="padding:8px 6px;font-size:11px;color:#808080;">No buddies yet.<br>Use Add to send a request.</div>';
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
    const emojiHtml = buddy.emoji ? renderStatusEmoji(buddy.emoji) : '';
    entry.innerHTML = `<div class="status-dot ${statusClass}"></div>${emojiHtml}<span class="buddy-name">${buddy.username}</span>`;
    entry.addEventListener('dblclick', () => openDMWindow(buddy.username));
    entry.addEventListener('contextmenu', e => { e.preventDefault(); showBuddyContextMenu(e.clientX, e.clientY, buddy.username); });
    items.appendChild(entry);

    if (buddy.away_message) {
      const awayLine = document.createElement('div');
      awayLine.className = 'buddy-away-text';
      awayLine.textContent = `"${buddy.away_message}"`;
      // AS = italic (auto/away), OS = normal weight (custom online status)
      if (buddy.status_type === 'as') {
        awayLine.style.fontStyle = 'italic';
        awayLine.style.color = '#808080';
      } else {
        awayLine.style.fontStyle = 'normal';
        awayLine.style.color = '#000080';
      }
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

// ── Buddy Context Menu ─────────────────────────────────────────────────────
function showBuddyContextMenu(x, y, username) {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = x + 'px'; menu.style.top = y + 'px';

  [
    { label: '✉ Send Message', fn: () => openDMWindow(username) },
    { sep: true },
    { label: '✕ Remove Buddy', fn: () => removeBuddy(username), danger: true },
  ].forEach(item => {
    if (item.sep) { const s = document.createElement('div'); s.className = 'context-menu-sep'; menu.appendChild(s); return; }
    const btn = document.createElement('div');
    btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('mousedown', e => { e.preventDefault(); menu.remove(); item.fn(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  if (x + menu.offsetWidth  > window.innerWidth)  menu.style.left = (x - menu.offsetWidth)  + 'px';
  if (y + menu.offsetHeight > window.innerHeight) menu.style.top  = (y - menu.offsetHeight) + 'px';

  setTimeout(() => {
    function close(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } }
    document.addEventListener('mousedown', close);
  }, 0);
}

async function removeBuddy(username) {
  if (!confirm(`Remove ${username} from your buddy list?\nThis removes you from their list too.`)) return;
  try {
    await apiDelete(`/buddy/${username}`);
    delete buddies[username];
    renderBuddyList();
  } catch (e) { console.error(e); }
}

function handlePresence(username, status, away_message, emoji = '', status_type = 'os') {
  if (!buddies[username]) return;
  const wasOnline = buddies[username].online;
  buddies[username].online = status !== 'offline';
  buddies[username].status = status;
  buddies[username].away_message = away_message;
  buddies[username].emoji = emoji;
  buddies[username].status_type = status_type;

  if (!wasOnline && status !== 'offline') {
    playBuddyOnSound();
    sendNotif('cIM', `${username} is now online`);
    if (openChats[username]) appendDMMessage(username, 'system', null, `${username} is now online`);
  } else if (wasOnline && status === 'offline') {
    playDoorSound();
    if (openChats[username]) appendDMMessage(username, 'system', null, `${username} has signed off`);
  }

  if (openChats[username]) {
    const chatWith = openChats[username].winEl.querySelector('.chat-with');
    if (chatWith) {
      const emojiHtml = emoji ? renderStatusEmoji(emoji) : '';
      const statusDotClass = status === 'online' ? 'online' : status === 'away' ? 'away' : 'offline';
      const statusSuffix = away_message ? ` — "${away_message}"` : '';
      chatWith.innerHTML = `<div class="status-dot ${statusDotClass}"></div>${emojiHtml}${username}${statusSuffix}`;
    }
  }
  renderBuddyList();
}

// ── Toast notification ─────────────────────────────────────────────────────
function showToast(msg, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'cim-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── DM Windows ─────────────────────────────────────────────────────────────
function openDMWindow(username) {
  if (openChats[username]) { openChats[username].winEl.style.display = 'block'; focusWindow(openChats[username].winEl); return; }

  const buddy = buddies[username] || { status: 'offline', away_message: '' };
  const pos   = placeWindowCascade();
  const winEl = document.createElement('div');
  winEl.className = 'cim-window chat-window';
  winEl.style.top = pos.top + 'px'; winEl.style.left = pos.left + 'px';
  winEl.innerHTML = `
    <div class="titlebar" id="chat-title-${username}">
      <span class="titlebar-icon">✉</span>
      <span class="titlebar-title">${username}</span>
      <div class="titlebar-buttons"><button class="win-btn close chat-close">✕</button></div>
    </div>
    <div class="chat-with">
      <div class="status-dot ${buddy.status}"></div>
      ${username} — ${buddy.status}${buddy.away_message ? `: "${buddy.away_message}"` : ''}
    </div>
    <div class="chat-messages" id="msgs-${username}"></div>
    <div class="typing-indicator" id="typing-${username}"></div>
    <div class="chat-input-row">
      <button class="emoji-trigger" id="emoji-btn-dm-${username}" title="Emojis">😊</button>
      <textarea class="chat-input" id="input-${username}" placeholder="Message ${username}..."></textarea>
      <button class="send-btn" id="send-${username}">Send</button>
    </div>
  `;

  document.getElementById('desktop').appendChild(winEl);
  makeDraggable(winEl, winEl.querySelector('.titlebar'));
  focusWindow(winEl);
  openChats[username] = { winEl, unread: 0 };

  winEl.querySelector('.chat-close').addEventListener('click', () => { winEl.style.display = 'none'; delete openChats[username]; updateTaskbar(); });
  winEl.addEventListener('mousedown', () => { if (openChats[username]) { openChats[username].unread = 0; updateTaskbar(); } });

  const inputEl = document.getElementById(`input-${username}`);
  document.getElementById(`send-${username}`).addEventListener('click', () => sendDM(username));
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDM(username); } });

  let typingTimer = null;
  inputEl.addEventListener('input', () => { wsSend({ type: 'typing', to: username }); clearTimeout(typingTimer); typingTimer = setTimeout(() => {}, 2000); });
  document.getElementById(`emoji-btn-dm-${username}`).addEventListener('click', e => { e.stopPropagation(); createEmojiPicker(inputEl); });

  // Scroll-to-bottom button
  addScrollToBottom(document.getElementById(`msgs-${username}`));

  loadDMHistory(username);
  updateTaskbar();
}

async function loadDMHistory(username) {
  try {
    const data = await apiGet(`/history/dm/${username}`);
    data.messages.forEach(msg => appendDMMessage(username, msg.sender === myUsername ? 'self' : 'other', msg.sender, msg.content, msg.timestamp));
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
  sendNotif(`Message from ${from}`, content.replace(/:([a-z0-9_-]+):/g, ':$1:'));
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
    const top = document.createElement('div');
    top.className = 'msg-top';
    top.innerHTML = `<span class="msg-sender">${sender}</span><span class="msg-time">${formatTime(timestamp)}</span>`;
    div.appendChild(top);
  }

  const text = document.createElement('div');
  text.className = 'msg-text';
  if (side === 'system') { text.style.cssText = 'color:#808080;font-style:italic'; text.textContent = content; }
  else text.innerHTML = renderContent(content);
  div.appendChild(text);

  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  container.appendChild(div);
  if (wasAtBottom) container.scrollTop = container.scrollHeight;

  if (openChats[username] && document.querySelector('.cim-window.focused') === openChats[username].winEl) {
    openChats[username].unread = 0; updateTaskbar();
  }
}

let typingTimers = {};
function showTyping(from) {
  const ind = document.getElementById(`typing-${from}`);
  if (!ind) return;
  ind.textContent = `${from} is typing...`;
  clearTimeout(typingTimers[from]);
  typingTimers[from] = setTimeout(() => { ind.textContent = ''; }, 3000);
}

// ── Scroll to bottom button ────────────────────────────────────────────────
function addScrollToBottom(messagesEl) {
  const btn = document.createElement('button');
  btn.className = 'scroll-to-bottom';
  btn.title = 'Jump to bottom';
  btn.textContent = '▼';
  btn.style.display = 'none';
  messagesEl.parentNode.insertBefore(btn, messagesEl.nextSibling);

  messagesEl.addEventListener('scroll', () => {
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
    btn.style.display = atBottom ? 'none' : 'block';
  });

  btn.addEventListener('click', () => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}

// ── Room Windows ───────────────────────────────────────────────────────────
function openRoomWindow(roomName) {
  if (openRooms[roomName]) { openRooms[roomName].winEl.style.display = 'block'; focusWindow(openRooms[roomName].winEl); return; }

  const pos = placeWindowCascade();
  const winEl = document.createElement('div');
  winEl.className = 'cim-window room-window';
  winEl.style.top = pos.top + 'px'; winEl.style.left = pos.left + 'px';
  winEl.innerHTML = `
    <div class="titlebar" id="room-title-${roomName}">
      <span class="titlebar-icon">🚪</span>
      <span class="titlebar-title">#${roomName}</span>
      <div class="titlebar-buttons">
        <button class="win-btn room-invite" title="Invite User">➕</button>
        <button class="win-btn close room-close">✕</button>
      </div>
    </div>
    <div class="room-layout">
      <div class="room-messages" id="room-msgs-${roomName}"></div>
      <div class="room-members" id="room-members-${roomName}"><div class="room-members-header">USERS</div></div>
    </div>
    <div class="chat-input-row">
      <button class="emoji-trigger" id="emoji-btn-room-${roomName}" title="Emojis">😊</button>
      <textarea class="chat-input" id="room-input-${roomName}" placeholder="#${roomName}..."></textarea>
      <button class="send-btn" id="room-send-${roomName}">Send</button>
    </div>
  `;

  document.getElementById('desktop').appendChild(winEl);
  makeDraggable(winEl, winEl.querySelector('.titlebar'));
  focusWindow(winEl);
  openRooms[roomName] = { winEl };

  winEl.querySelector('.room-close').addEventListener('click', () => { wsSend({ type: 'leave_room', room: roomName }); winEl.style.display = 'none'; delete openRooms[roomName]; updateTaskbar(); });
  
  winEl.querySelector('.room-invite').addEventListener('click', () => {
    el('invite-dialog').style.cssText += ';display:block;top:100px;left:250px';
    focusWindow(el('invite-dialog'));
    el('invite-msg').textContent = '';
    el('invite-input').value = '';
    el('invite-input').dataset.room = roomName;
  });

  const roomInputEl = document.getElementById(`room-input-${roomName}`);
  document.getElementById(`room-send-${roomName}`).addEventListener('click', () => sendRoomMsg(roomName));
  roomInputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRoomMsg(roomName); } });
  document.getElementById(`emoji-btn-room-${roomName}`).addEventListener('click', e => { e.stopPropagation(); createEmojiPicker(roomInputEl); });

  addScrollToBottom(document.getElementById(`room-msgs-${roomName}`));

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
  const isSystem = from === '—';
  const div = document.createElement('div');
  div.className = `msg ${isSystem ? 'system' : from === myUsername ? 'self' : 'other'}`;

  if (!isSystem) {
    const top = document.createElement('div');
    top.className = 'msg-top';
    top.innerHTML = `<span class="msg-sender">${from}</span><span class="msg-time">${formatTime(timestamp)}</span>`;
    div.appendChild(top);
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.innerHTML = renderContent(content);
    div.appendChild(text);
  } else {
    div.innerHTML = `<div class="msg-text" style="color:#808080;font-style:italic;">${content}</div>`;
  }

  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  container.appendChild(div);
  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

function onRoomJoined(roomName, members) { updateRoomMembers(roomName, members); appendRoomMessage(roomName, '—', `You joined #${roomName}`); }

function updateRoomMembers(roomName, members) {
  const container = document.getElementById(`room-members-${roomName}`);
  if (!container) return;
  container.innerHTML = '<div class="room-members-header">USERS</div>';
  members.forEach(m => {
    const div = document.createElement('div');
    div.className = 'room-member';
    const b = buddies[m] || { online: true, status: 'online', emoji: '' };
    const emojiHtml = b.emoji ? renderStatusEmoji(b.emoji) : '';
    div.innerHTML = `<div class="status-dot online"></div>${emojiHtml}${m}`;
    div.addEventListener('dblclick', () => openDMWindow(m));
    container.appendChild(div);
  });
}

function handleRoomEvent(msg) {
  if (msg.event === 'join') {
    appendRoomMessage(msg.room, '—', `${msg.user} joined the room`);
    const membersEl = document.getElementById(`room-members-${msg.room}`);
    if (membersEl && !Array.from(membersEl.querySelectorAll('.room-member')).some(e => e.textContent.trim() === msg.user)) {
      const div = document.createElement('div');
      div.className = 'room-member';
      const b = buddies[msg.user] || { online: true, status: 'online', emoji: '' };
      const emojiHtml = b.emoji ? renderStatusEmoji(b.emoji) : '';
      div.innerHTML = `<div class="status-dot online"></div>${emojiHtml}${msg.user}`;
      div.addEventListener('dblclick', () => openDMWindow(msg.user));
      membersEl.appendChild(div);
    }
  } else if (msg.event === 'leave') {
    appendRoomMessage(msg.room, '—', `${msg.user} left the room`);
    document.getElementById(`room-members-${msg.room}`)?.querySelectorAll('.room-member').forEach(e => { if (e.textContent.trim() === msg.user) e.remove(); });
  }
}

// ── Away Message ───────────────────────────────────────────────────────────
el('btn-set-away').addEventListener('click', () => { el('away-dialog').style.cssText += ';display:block;top:100px;left:300px'; focusWindow(el('away-dialog')); });
el('btn-close-away').addEventListener('click', () => { el('away-dialog').style.display = 'none'; });
el('btn-save-away').addEventListener('click', () => {
  const msg = el('away-input').value.trim();
  const emoji = el('status-emoji-input').value;
  const type = Array.from(document.getElementsByName('status-type')).find(r => r.checked)?.value || 'os';
  saveStatus(msg, emoji, type);
});
el('btn-clear-away').addEventListener('click', () => { 
  el('away-input').value = ''; 
  el('status-emoji-input').value = '';
  updateStatusEmojiPreview('');
  saveStatus('', '', 'os'); 
});

el('status-emoji-btn').addEventListener('click', e => {
  e.stopPropagation();
  createStatusEmojiPicker();
});

function createStatusEmojiPicker() {
  if (activeEmojiPicker) { activeEmojiPicker.remove(); activeEmojiPicker = null; }
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  picker.appendChild(grid);

  EMOJIS.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.innerHTML = `<img src="${EMOJI_PATH}${name}.png" style="width:20px;height:20px;">`;
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      el('status-emoji-input').value = name;
      updateStatusEmojiPreview(name);
      picker.remove(); activeEmojiPicker = null;
    });
    grid.appendChild(btn);
  });

  document.body.appendChild(picker);
  const rect = el('status-emoji-btn').getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top = rect.bottom + 4 + 'px';
  activeEmojiPicker = picker;

  setTimeout(() => {
    function outside(e) { if (!picker.contains(e.target) && e.target !== el('status-emoji-btn')) { picker.remove(); activeEmojiPicker = null; document.removeEventListener('mousedown', outside); } }
    document.addEventListener('mousedown', outside);
  }, 0);
}

async function saveStatus(message, emoji = '', type = 'os') {
  try {
    await apiPost('/away', { message, emoji, status_type: type }, true);
    myStatusMsg   = message;
    myStatusEmoji = emoji;
    myStatusType  = type;
    const dotClass = (type === 'as' && message) ? 'away' : 'online';
    el('self-status-dot').className = 'status-dot ' + dotClass;
    el('away-dialog').style.display = 'none';
    updateSelfStatusLine();
  } catch (e) { console.error(e); }
}

// ── Idle Detection (AS) ───────────────────────────────────────────────────
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function startIdleDetection() {
  idleStarted = true;
  resetIdleTimer();
}

function resetIdleTimer() {
  if (!idleStarted || !token) return;
  clearTimeout(idleTimer);

  // If coming back from idle, clear the AS status — but only call API once
  if (isIdle) {
    isIdle = false;
    saveStatus('', '', 'os');
  }

  idleTimer = setTimeout(setIdleStatus, IDLE_TIMEOUT);
}

function setIdleStatus() {
  if (!token || !idleStarted) return;
  // Only set if not already idling and not on a manual AS status
  if (!isIdle) {
    isIdle = true;
    saveStatus('Idle (Autogenerated)', 'zzz', 'as');
  }
}

// Throttle activity events — max one check per 2 seconds to avoid API spam
function onActivity() {
  if (!idleStarted) return;
  const now = Date.now();
  if (now - lastActivityAt < 2000) {
    // Still debounce the timer reset even if we skip the API call
    clearTimeout(idleTimer);
    idleTimer = setTimeout(setIdleStatus, IDLE_TIMEOUT);
    return;
  }
  lastActivityAt = now;
  resetIdleTimer();
}

document.addEventListener('mousemove', onActivity);
document.addEventListener('keydown',   onActivity);
document.addEventListener('click',     onActivity);
// Note: startIdleDetection() is called from enterDesktop()

// ── Add Buddy ──────────────────────────────────────────────────────────────
el('btn-add-buddy').addEventListener('click', () => {
  el('add-buddy-dialog').style.cssText += ';display:block;top:120px;left:280px';
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
  msgEl.textContent = ''; msgEl.className = 'dialog-msg';
  if (!username) return;
  try {
    const data = await apiPost(`/buddy/request/${username}`, {}, true);
    if (data.auto_accepted) {
      msgEl.className = 'dialog-msg success';
      msgEl.textContent = `You and ${username} are now buddies!`;
    } else {
      msgEl.className = 'dialog-msg success';
      msgEl.textContent = `Request sent to ${username}!`;
    }
    el('add-buddy-input').value = '';
    setTimeout(() => { el('add-buddy-dialog').style.display = 'none'; }, 1200);
  } catch (e) { msgEl.className = 'dialog-msg error'; msgEl.textContent = e.message; }
}

// ── Rooms ──────────────────────────────────────────────────────────────────
el('btn-open-rooms').addEventListener('click', openRoomsList);
el('btn-close-rooms').addEventListener('click', () => { el('rooms-window').style.display = 'none'; });
el('btn-refresh-rooms').addEventListener('click', refreshRooms);
el('btn-create-room').addEventListener('click', async () => {
  const name = el('new-room-input').value.trim();
  const topic = el('new-room-topic').value.trim();
  const buddiesOnly = el('room-buddies-only').checked;
  const inviteOnly = el('room-invite-only').checked;
  if (!name) return;
  try { 
    await apiPost('/rooms', { name, topic, buddies_only: buddiesOnly, invite_only: inviteOnly }, true); 
    el('new-room-input').value = ''; 
    el('new-room-topic').value = '';
    el('room-buddies-only').checked = false;
    el('room-invite-only').checked = false;
    await refreshRooms(); 
  }
  catch (e) { alert(e.message); }
});
el('new-room-input').addEventListener('keydown', e => { if (e.key === 'Enter') el('btn-create-room').click(); });

async function openRoomsList() {
  el('rooms-window').style.cssText += ';display:block;top:60px;left:300px';
  focusWindow(el('rooms-window'));
  await refreshRooms();
}

async function refreshRooms() {
  try {
    const data = await apiGet('/rooms');
    const list = el('rooms-list');
    list.innerHTML = '';
    if (data.rooms.length === 0) { list.innerHTML = '<div style="padding:8px;font-size:11px;color:#808080;">No rooms yet. Create one below!</div>'; return; }
    data.rooms.forEach(room => {
      const div = document.createElement('div');
      div.className = 'room-entry';
      div.innerHTML = `
        <div class="room-entry-info">
          <span class="room-entry-name">#${room.name} ${room.is_private ? '🔒' : ''}</span>
          ${room.topic ? `<span class="room-entry-topic">${room.topic}</span>` : ''}
        </div>
        <span class="room-entry-count">${room.members.length} online</span>
      `;
      div.addEventListener('dblclick', () => { openRoomWindow(room.name); el('rooms-window').style.display = 'none'; });
      list.appendChild(div);
    });
  } catch { }
}

// ── Sign Off ───────────────────────────────────────────────────────────────
el('btn-signoff').addEventListener('click', doSignoff);
function doSignoff() {
  if (!confirm('Sign off from cIM?')) return;
  localStorage.removeItem('cim_token'); localStorage.removeItem('cim_username');
  if (ws) ws.close();
  location.reload();
}

// ── Start Menu ─────────────────────────────────────────────────────────────
const startMenu = el('start-menu');
el('start-btn').addEventListener('click', e => { e.stopPropagation(); startMenu.classList.toggle('open'); });
document.addEventListener('click', () => startMenu.classList.remove('open'));
startMenu.addEventListener('click', e => e.stopPropagation());
function smenu(fn) { startMenu.classList.remove('open'); fn(); }

el('smenu-buddy-list').addEventListener('click', () => smenu(() => { el('buddy-list-window').style.display = 'block'; focusWindow(el('buddy-list-window')); }));
el('smenu-rooms').addEventListener('click',      () => smenu(() => openRoomsList()));
el('smenu-away').addEventListener('click',       () => smenu(() => { el('away-dialog').style.cssText += ';display:block;top:80px;left:220px'; focusWindow(el('away-dialog')); }));
el('smenu-add-buddy').addEventListener('click',  () => smenu(() => { el('add-buddy-dialog').style.cssText += ';display:block;top:80px;left:220px'; el('add-buddy-msg').textContent = ''; el('add-buddy-input').value = ''; focusWindow(el('add-buddy-dialog')); }));
el('smenu-about').addEventListener('click',      () => smenu(() => openAbout()));
el('smenu-signoff').addEventListener('click',    () => smenu(() => doSignoff()));

// ── Admin Panel ────────────────────────────────────────────────────────────
el('smenu-admin').addEventListener('click', () => smenu(() => {
  el('admin-window').style.cssText += ';display:block;top:80px;left:280px';
  focusWindow(el('admin-window'));
  loadAdminUsers();
}));

el('btn-close-admin').addEventListener('click', () => { el('admin-window').style.display = 'none'; });

el('tab-admin-users').addEventListener('click', () => {
  el('tab-admin-users').classList.add('active');
  el('tab-admin-rooms').classList.remove('active');
  el('admin-users-list').style.display = 'block';
  el('admin-rooms-list').style.display = 'none';
  loadAdminUsers();
});

el('tab-admin-rooms').addEventListener('click', () => {
  el('tab-admin-rooms').classList.add('active');
  el('tab-admin-users').classList.remove('active');
  el('admin-rooms-list').style.display = 'block';
  el('admin-users-list').style.display = 'none';
  loadAdminRooms();
});

async function loadAdminUsers() {
  try {
    const data = await apiGet('/admin/users');
    const list = el('admin-users-list');
    list.innerHTML = '';
    data.users.forEach(u => {
      const div = document.createElement('div');
      div.className = 'room-entry';
      div.innerHTML = `
        <span class="room-entry-name">${u.username} ${u.is_admin ? '<span style="color:#0000ff;font-size:10px">(Admin)</span>' : ''}</span>
        <div>
          <button class="cim-btn btn-toggle">Toggle Admin</button>
          <button class="cim-btn btn-delete" style="color:red">Delete</button>
        </div>
      `;
      div.querySelector('.btn-toggle').addEventListener('click', async () => {
        try { await apiPost(`/admin/users/${u.username}/toggle-admin`, {}, true); loadAdminUsers(); }
        catch (e) { showToast(e.message); }
      });
      div.querySelector('.btn-delete').addEventListener('click', async () => {
        if (!confirm(`Are you sure you want to delete user ${u.username}? This cannot be undone.`)) return;
        try { await apiDelete(`/admin/users/${u.username}`); loadAdminUsers(); }
        catch (e) { showToast(e.message); }
      });
      list.appendChild(div);
    });
  } catch (e) { showToast(e.message); }
}

async function loadAdminRooms() {
  try {
    const data = await apiGet('/rooms');
    const list = el('admin-rooms-list');
    list.innerHTML = '';
    data.rooms.forEach(r => {
      const div = document.createElement('div');
      div.className = 'room-entry';
      div.innerHTML = `
        <div class="room-entry-info">
          <span class="room-entry-name">#${r.name} ${r.is_private ? '🔒' : ''}</span>
          <span class="room-entry-count" style="margin-left:8px;">${r.members.length} online</span>
        </div>
        <button class="cim-btn">Delete</button>
      `;
      div.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Delete room #${r.name}?`)) return;
        try { await apiDelete(`/admin/rooms/${r.name}`); loadAdminRooms(); }
        catch (e) { showToast(e.message); }
      });
      list.appendChild(div);
    });
  } catch (e) { showToast(e.message); }
}

// ── Invite Dialog ──────────────────────────────────────────────────────────
el('btn-close-invite').addEventListener('click', () => { el('invite-dialog').style.display = 'none'; });
el('btn-do-invite').addEventListener('click', doRoomInvite);
el('invite-input').addEventListener('keydown', e => { if (e.key === 'Enter') doRoomInvite(); });

async function doRoomInvite() {
  const target = el('invite-input').value.trim();
  const room = el('invite-input').dataset.room;
  if (!target || !room) return;
  const msgEl = el('invite-msg');
  msgEl.textContent = ''; msgEl.className = 'dialog-msg';
  try {
    await apiPost(`/rooms/${room}/invite/${target}`, {}, true);
    msgEl.className = 'dialog-msg success';
    msgEl.textContent = `Invite sent to ${target}!`;
    el('invite-input').value = '';
    setTimeout(() => { el('invite-dialog').style.display = 'none'; }, 1000);
  } catch (e) { msgEl.className = 'dialog-msg error'; msgEl.textContent = e.message; }
}

// ── About ──────────────────────────────────────────────────────────────────
function openAbout() {
  const about = el('about-dialog');
  about.style.display = 'block'; about.style.top = '80px'; about.style.left = '50%'; about.style.transform = 'translateX(-50%)';
  el('about-username').textContent = myUsername || '—';
  focusWindow(about);
}
el('btn-close-about').addEventListener('click',    () => { el('about-dialog').style.display = 'none'; });
el('btn-close-about-ok').addEventListener('click', () => { el('about-dialog').style.display = 'none'; });

