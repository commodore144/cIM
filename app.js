// cIM — commodore. Instant Messenger
// Frontend App Logic

const API = 'https://inspire.tail0e8d21.ts.net/cim';

// ── State ──────────────────────────────────────────────────────────────────
let token = localStorage.getItem('cim_token') || null;
let myUsername = localStorage.getItem('cim_username') || null;
let ws = null;
let wsReconnectTimer = null;
let commMode = 'ws'; // or 'rest'
let pollTimer = null;
let buddies = {}; // username -> {online, status, away_message}
let openChats = {}; // username -> {window el, unread}
let openRooms = {}; // room name -> {window el}
let zCounter = 10;

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
  // Simulate classic AIM door close
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

  // Buddy list always first
  addTaskbarItem('💬 Buddy List', el('buddy-list-window'), focused === el('buddy-list-window'));

  // Open chats
  Object.entries(openChats).forEach(([user, chat]) => {
    const unread = chat.unread ? ` (${chat.unread})` : '';
    addTaskbarItem(`✉ ${user}${unread}`, chat.winEl, focused === chat.winEl);
  });

  // Open rooms
  Object.entries(openRooms).forEach(([room, r]) => {
    addTaskbarItem(`⊞ #${room}`, r.winEl, focused === r.winEl);
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

// ── Connection Mode Toggle ────────────────────────────────────────────────
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
  setCommMode(commMode === 'ws' ? 'rest' : 'ws');
});

// ── Login / Register ───────────────────────────────────────────────────────
el('btn-login').addEventListener('click', doLogin);
el('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
el('login-username').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

el('btn-show-register').addEventListener('click', () => {
  el('btn-show-register').textContent = 'SIGN ON';
  el('btn-show-register').addEventListener('click', () => location.reload(), { once: true });
  el('btn-login').textContent = 'REGISTER';
  el('btn-login').onclick = doRegister;
  document.querySelector('.titlebar-title').innerHTML = '<span class="brand">c</span>IM — New User';
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

  makeDraggable(el('buddy-list-window'), el('buddy-titlebar'));
  makeDraggable(el('away-dialog'), el('away-titlebar'));
  makeDraggable(el('add-buddy-dialog'), el('add-buddy-titlebar'));
  makeDraggable(el('rooms-window'), el('rooms-titlebar'));

  focusWindow(el('buddy-list-window'));
  const savedMode = localStorage.getItem('cim_commmode') || 'ws';
  setCommMode(savedMode);
}

// Auto-login if token exists
if (token && myUsername) {
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
    // Auto-fallback after some time? Let's just let the user toggle or 
    // we could count failures.
  };

  ws.onerror = () => {
    if (ws) ws.close();
    // Fallback to REST?
    console.log("WS Error, falling back to REST");
    setCommMode('rest');
  };
}

async function startRESTPolling() {
  if (commMode !== 'rest') return;
  try {
    const data = await apiPost('/poll/connect', {}, true);
    handleWSMessage(data); // Init packet
    pollLoop();
  } catch (e) {
    console.error("Poll connect failed", e);
    setTimeout(startRESTPolling, 5000);
  }
}

async function pollLoop() {
  if (commMode !== 'rest') return;
  try {
    const data = await apiGet('/poll/messages');
    if (data.messages) {
      data.messages.forEach(msg => handleWSMessage(msg));
    }
    el('disconnect-banner').classList.remove('visible');
    pollLoop(); // Immediate next poll
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
    console.error("Rest send failed", e);
  }
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'init':
      el('self-name').textContent = msg.username;
      if (msg.away_message) {
        el('away-preview').textContent = `"${msg.away_message}"`;
        el('self-status-dot').className = 'status-dot away';
        el('away-input').value = msg.away_message;
      }
      msg.buddies.forEach(b => {
        buddies[b.username] = b;
      });
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
  const online = Object.values(buddies).filter(b => b.online && b.status !== 'away');
  const away = Object.values(buddies).filter(b => b.online && b.status === 'away');
  const offline = Object.values(buddies).filter(b => !b.online);

  body.innerHTML = '';

  if (Object.keys(buddies).length === 0) {
    body.innerHTML = '<div style="padding:12px 10px; color:var(--text-dim); font-size:14px;">No buddies yet.<br>Add someone to get started.</div>';
    return;
  }

  if (online.length) renderBuddyGroup(body, `Online (${online.length})`, online, 'online');
  if (away.length) renderBuddyGroup(body, `Away (${away.length})`, away, 'away');
  if (offline.length) renderBuddyGroup(body, `Offline (${offline.length})`, offline, 'offline');

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
    entry.innerHTML = `
      <div class="status-dot ${statusClass}"></div>
      <span class="buddy-name">${buddy.username}</span>
    `;
    if (buddy.away_message) {
      const awayLine = document.createElement('div');
      awayLine.className = 'buddy-away-text';
      awayLine.textContent = `"${buddy.away_message}"`;
      // Insert after this entry
      entry.addEventListener('dblclick', () => openDMWindow(buddy.username));
      items.appendChild(entry);
      items.appendChild(awayLine);
      return;
    }
    entry.addEventListener('dblclick', () => openDMWindow(buddy.username));
    items.appendChild(entry);
  });

  group.appendChild(items);

  // Toggle collapse
  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    items.style.display = collapsed ? 'none' : '';
    header.querySelector('.toggle').textContent = collapsed ? '▸' : '▾';
  });

  container.appendChild(group);
}

function handlePresence(username, status, away_message) {
  const wasOnline = buddies[username]?.online;
  if (!buddies[username]) return; // Not in our buddy list

  const wasOffline = !buddies[username].online;
  buddies[username].online = status !== 'offline';
  buddies[username].status = status;
  buddies[username].away_message = away_message;

  if (!wasOnline && status !== 'offline') {
    playBuddyOnSound();
    // Show system message in any open DM window
    if (openChats[username]) {
      appendDMMessage(username, 'system', null, `${username} is now online`);
    }
  } else if (wasOnline && status === 'offline') {
    playDoorSound();
    if (openChats[username]) {
      appendDMMessage(username, 'system', null, `${username} has signed off`);
    }
  }

  // Update chat window status
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
      <textarea class="chat-input" id="input-${username}" placeholder="Message ${username}..." rows="2"></textarea>
      <button class="send-btn" id="send-${username}">SEND ▶</button>
    </div>
  `;

  document.getElementById('desktop').appendChild(winEl);
  makeDraggable(winEl, winEl.querySelector('.titlebar'));
  focusWindow(winEl);

  openChats[username] = { winEl, unread: 0 };

  // Close button
  winEl.querySelector('.chat-close').addEventListener('click', () => {
    winEl.style.display = 'none';
    delete openChats[username];
    updateTaskbar();
  });

  // Send on button click
  document.getElementById(`send-${username}`).addEventListener('click', () => sendDM(username));

  // Send on Enter (Shift+Enter for newline)
  document.getElementById(`input-${username}`).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDM(username);
    }
  });

  // Typing indicator
  let typingTimer = null;
  document.getElementById(`input-${username}`).addEventListener('input', () => {
    wsSend({ type: 'typing', to: username });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { }, 2000);
  });

  // Load DM history
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
  if (!openChats[from]) {
    openDMWindow(from);
  }
  appendDMMessage(from, 'other', from, content);
  // Update unread if not focused
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
  text.textContent = content;
  div.appendChild(text);

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // Clear unread when focused
  if (openChats[username] && document.querySelector('.cim-window.focused') === openChats[username].winEl) {
    openChats[username].unread = 0;
    updateTaskbar();
  }
}

let typingTimers = {};
function showTyping(from) {
  const el_ = document.getElementById(`typing-${from}`);
  if (!el_) return;
  el_.textContent = `${from} is typing...`;
  clearTimeout(typingTimers[from]);
  typingTimers[from] = setTimeout(() => { el_.textContent = ''; }, 3000);
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
    <div class="titlebar purple" id="room-title-${roomName}">
      <span class="titlebar-icon">⊞</span>
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
      <textarea class="chat-input" id="room-input-${roomName}" placeholder="#${roomName}" rows="2"></textarea>
      <button class="send-btn" id="room-send-${roomName}">SEND ▶</button>
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

  document.getElementById(`room-send-${roomName}`).addEventListener('click', () => sendRoomMsg(roomName));
  document.getElementById(`room-input-${roomName}`).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendRoomMsg(roomName);
    }
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
  div.className = `msg ${from === myUsername ? 'self' : 'other'}`;
  div.innerHTML = `<div class="msg-sender">${from}</div><div>${escapeHtml(content)}</div>`;
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
  } else if (msg.event === 'leave') {
    appendRoomMessage(msg.room, '—', `${msg.user} left the room`);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Away Message ───────────────────────────────────────────────────────────
el('btn-set-away').addEventListener('click', () => {
  el('away-dialog').classList.add('visible');
  el('away-dialog').style.display = 'block';
  el('away-dialog').style.top = '100px';
  el('away-dialog').style.left = '300px';
  focusWindow(el('away-dialog'));
});

el('btn-close-away').addEventListener('click', () => {
  el('away-dialog').style.display = 'none';
  el('away-dialog').classList.remove('visible');
});

el('btn-save-away').addEventListener('click', () => saveAway(el('away-input').value.trim()));
el('btn-clear-away').addEventListener('click', () => { el('away-input').value = ''; saveAway(''); });

async function saveAway(message) {
  try {
    await apiPost('/away', { message }, true);
    el('away-preview').textContent = message ? `"${message}"` : '';
    const dot = el('self-status-dot');
    dot.className = 'status-dot ' + (message ? 'away' : 'online');
    el('away-dialog').style.display = 'none';
  } catch (e) {
    console.error(e);
  }
}

// ── Add Buddy ──────────────────────────────────────────────────────────────
el('btn-add-buddy').addEventListener('click', () => {
  el('add-buddy-dialog').classList.add('visible');
  el('add-buddy-dialog').style.display = 'block';
  el('add-buddy-dialog').style.top = '120px';
  el('add-buddy-dialog').style.left = '280px';
  focusWindow(el('add-buddy-dialog'));
  el('add-buddy-msg').textContent = '';
  el('add-buddy-input').value = '';
});

el('btn-close-add-buddy').addEventListener('click', () => {
  el('add-buddy-dialog').style.display = 'none';
});

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
    // Add to local state
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
el('btn-close-rooms').addEventListener('click', () => {
  el('rooms-window').style.display = 'none';
});

async function openRoomsList() {
  el('rooms-window').classList.add('visible');
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
    data.rooms.forEach(room => {
      const div = document.createElement('div');
      div.className = 'room-entry';
      div.innerHTML = `
        <span class="room-entry-name">#${room.name}</span>
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

el('btn-create-room').addEventListener('click', async () => {
  const name = el('new-room-input').value.trim();
  if (!name) return;
  try {
    const data = await apiPost('/rooms', { name }, true);
    el('new-room-input').value = '';
    await refreshRooms();
  } catch (e) {
    alert(e.message);
  }
});

// ── Sign Off ───────────────────────────────────────────────────────────────
el('btn-signoff').addEventListener('click', () => {
  if (!confirm('Sign off from cIM?')) return;
  localStorage.removeItem('cim_token');
  localStorage.removeItem('cim_username');
  if (ws) ws.close();
  location.reload();
});

// ── Start Menu ─────────────────────────────────────────────────────────────
const startMenu = el('start-menu');

el('start-btn').addEventListener('click', e => {
  e.stopPropagation();
  startMenu.classList.toggle('open');
});

document.addEventListener('click', () => startMenu.classList.remove('open'));
startMenu.addEventListener('click', e => e.stopPropagation());

function openStartMenuItem(fn) {
  startMenu.classList.remove('open');
  fn();
}

el('smenu-buddy-list').addEventListener('click', () => openStartMenuItem(() => {
  el('buddy-list-window').style.display = 'block';
  focusWindow(el('buddy-list-window'));
}));

el('smenu-rooms').addEventListener('click', () => openStartMenuItem(() => openRoomsList()));

el('smenu-away').addEventListener('click', () => openStartMenuItem(() => {
  el('away-dialog').style.display = 'block';
  el('away-dialog').style.top = '80px';
  el('away-dialog').style.left = '220px';
  focusWindow(el('away-dialog'));
}));

el('smenu-add-buddy').addEventListener('click', () => openStartMenuItem(() => {
  el('add-buddy-dialog').style.display = 'block';
  el('add-buddy-dialog').style.top = '80px';
  el('add-buddy-dialog').style.left = '220px';
  el('add-buddy-msg').textContent = '';
  el('add-buddy-input').value = '';
  focusWindow(el('add-buddy-dialog'));
}));

el('smenu-about').addEventListener('click', () => openStartMenuItem(() => openAbout()));

el('smenu-signoff').addEventListener('click', () => openStartMenuItem(() => {
  if (!confirm('Sign off from cIM?')) return;
  localStorage.removeItem('cim_token');
  localStorage.removeItem('cim_username');
  if (ws) ws.close();
  location.reload();
}));

// ── About Dialog ───────────────────────────────────────────────────────────
makeDraggableById = (winId, titlebarId) => {
  const w = el(winId), h = el(titlebarId);
  if (w && h) makeDraggable(w, h);
};

function openAbout() {
  const about = el('about-dialog');
  about.style.display = 'block';
  about.style.top = '80px';
  about.style.left = '50%';
  about.style.transform = 'translateX(-50%)';
  el('about-username').textContent = myUsername || '—';
  focusWindow(about);
  makeDraggable(about, el('about-titlebar'));
}

el('btn-close-about').addEventListener('click', () => { el('about-dialog').style.display = 'none'; });
el('btn-close-about-ok').addEventListener('click', () => { el('about-dialog').style.display = 'none'; });

// ── Rooms refresh button ────────────────────────────────────────────────────
el('btn-refresh-rooms')?.addEventListener('click', refreshRooms);

// update rooms render to show topic + count better
const _origRefreshRooms = refreshRooms;
// patch refreshRooms to use new room-entry-info layout
window.refreshRooms = async function() {
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
  } catch {}
}
