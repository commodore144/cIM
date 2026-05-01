"""
cimbot.py — Official cIM Bot SDK
commodore. Instant Messenger Bot Framework

Usage:
    from cimbot import CIMBot

    bot = CIMBot(token="cim_bot_...", server="wss://inspire.tail0e8d21.ts.net/cim")

    @bot.on_ready
    async def ready(username):
        print(f"Logged in as {username}")
        await bot.join_room("lobby")

    @bot.on_room_message
    async def message(room, sender, content):
        if content == "!ping":
            await bot.send_room(room, "pong!")

    bot.run()
"""

import asyncio
import json
import time
import logging
import inspect
import urllib.request
import urllib.parse
from typing import Callable, Optional

try:
    import websockets
except ImportError:
    raise ImportError("websockets is required: pip install websockets")

log = logging.getLogger("cimbot")

# ── Context objects ────────────────────────────────────────────────────────────

class Message:
    """A message received in a room."""
    def __init__(self, room: str, sender: str, content: str, is_bot: bool = False):
        self.room    = room
        self.sender  = sender
        self.content = content
        self.is_bot  = is_bot

    def __repr__(self):
        return f"<Message room={self.room!r} sender={self.sender!r} content={self.content!r}>"


class DirectMessage:
    """A direct message received from a user."""
    def __init__(self, sender: str, content: str, is_bot: bool = False):
        self.sender  = sender
        self.content = content
        self.is_bot  = is_bot

    def __repr__(self):
        return f"<DirectMessage sender={self.sender!r} content={self.content!r}>"


class Presence:
    """A presence update for a user."""
    def __init__(self, username: str, status: str, away_message: str = "", emoji: str = ""):
        self.username     = username
        self.status       = status
        self.away_message = away_message
        self.emoji        = emoji
        self.online       = status != "offline"

    def __repr__(self):
        return f"<Presence user={self.username!r} status={self.status!r}>"


class RoomEvent:
    """A user joining or leaving a room."""
    def __init__(self, room: str, user: str, event: str):
        self.room  = room
        self.user  = user
        self.event = event   # "join" or "leave"

    def __repr__(self):
        return f"<RoomEvent room={self.room!r} user={self.user!r} event={self.event!r}>"


# ── Rate limiter ───────────────────────────────────────────────────────────────

class RateLimiter:
    """Simple token bucket rate limiter."""
    def __init__(self, rate: float = 1.0, burst: int = 5):
        self.rate     = rate    # messages per second
        self.burst    = burst   # max burst size
        self._tokens  = burst
        self._last    = time.monotonic()

    async def acquire(self):
        now = time.monotonic()
        elapsed = now - self._last
        self._last = now
        self._tokens = min(self.burst, self._tokens + elapsed * self.rate)
        if self._tokens < 1:
            wait = (1 - self._tokens) / self.rate
            await asyncio.sleep(wait)
            self._tokens = 0
        else:
            self._tokens -= 1


# ── Main Bot class ─────────────────────────────────────────────────────────────

class CIMBot:
    """
    cIM Bot client.

    Parameters
    ----------
    token : str
        Your bot token (starts with cim_bot_...).
    server : str
        WebSocket base URL e.g. wss://inspire.tail0e8d21.ts.net/cim
    rest_base : str
        REST base URL (defaults to https:// version of server)
    reconnect : bool
        Auto-reconnect on disconnect (default True)
    reconnect_delay : float
        Seconds between reconnect attempts (default 5)
    rate_limit : float
        Messages per second outgoing rate limit (default 1.0)
    rate_burst : int
        Rate limit burst size (default 5)
    log_level : int
        Logging level (default logging.INFO)
    """

    def __init__(
        self,
        token: str,
        server: str = "wss://inspire.tail0e8d21.ts.net/cim",
        rest_base: str = None,
        reconnect: bool = True,
        reconnect_delay: float = 5.0,
        rate_limit: float = 1.0,
        rate_burst: int = 5,
        log_level: int = logging.INFO,
    ):
        self.token          = token
        self.server         = server.rstrip("/")
        self.rest_base      = rest_base or server.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
        self.reconnect      = reconnect
        self.reconnect_delay = reconnect_delay
        self._limiter       = RateLimiter(rate_limit, rate_burst)

        self.username: Optional[str] = None
        self._ws            = None
        self._connected     = False
        self._running       = False
        self._rooms: set[str] = set()
        self._rejoin_rooms: set[str] = set()  # rooms to rejoin on reconnect

        # Event handlers: event_name -> list of coroutine functions
        self._handlers: dict[str, list[Callable]] = {}

        logging.basicConfig(
            level=log_level,
            format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
            datefmt="%H:%M:%S"
        )

    # ── Decorators ─────────────────────────────────────────────────────────────

    def _register(self, event: str):
        def decorator(fn: Callable):
            if not asyncio.iscoroutinefunction(fn):
                raise TypeError(f"Handler for '{event}' must be async")
            self._handlers.setdefault(event, []).append(fn)
            return fn
        return decorator

    def on_ready(self, fn: Callable):
        """Fired once when the bot connects and receives its init packet.
        Signature: async def handler(username: str)"""
        return self._register("ready")(fn)

    def on_room_message(self, fn: Callable):
        """Fired when a message is sent in a room the bot is in.
        Signature: async def handler(message: Message)"""
        return self._register("room_message")(fn)

    def on_dm(self, fn: Callable):
        """Fired when the bot receives a direct message.
        Signature: async def handler(dm: DirectMessage)"""
        return self._register("dm")(fn)

    def on_presence(self, fn: Callable):
        """Fired when a user's presence changes.
        Signature: async def handler(presence: Presence)"""
        return self._register("presence")(fn)

    def on_room_join(self, fn: Callable):
        """Fired when a user joins a room the bot is in.
        Signature: async def handler(event: RoomEvent)"""
        return self._register("room_join")(fn)

    def on_room_leave(self, fn: Callable):
        """Fired when a user leaves a room the bot is in.
        Signature: async def handler(event: RoomEvent)"""
        return self._register("room_leave")(fn)

    def on_disconnect(self, fn: Callable):
        """Fired when the bot disconnects from the server.
        Signature: async def handler()"""
        return self._register("disconnect")(fn)

    def on_error(self, fn: Callable):
        """Fired when an unhandled exception occurs in a handler.
        Signature: async def handler(error: Exception)"""
        return self._register("error")(fn)

    # ── Internal event dispatch ─────────────────────────────────────────────────

    async def _dispatch(self, event: str, *args):
        for handler in self._handlers.get(event, []):
            try:
                await handler(*args)
            except Exception as e:
                log.error(f"Error in {event} handler: {e}", exc_info=True)
                await self._dispatch("error", e)

    # ── Sending ─────────────────────────────────────────────────────────────────

    async def _ws_send(self, data: dict):
        """Send a raw WS message with rate limiting."""
        if not self._ws or not self._connected:
            raise RuntimeError("Bot is not connected")
        await self._limiter.acquire()
        await self._ws.send(json.dumps(data))

    async def send_room(self, room: str, content: str):
        """Send a message to a room."""
        await self._ws_send({"type": "room_message", "room": room, "content": content})

    async def send_dm(self, username: str, content: str):
        """Send a direct message to a user."""
        await self._ws_send({"type": "dm", "to": username, "content": content})

    async def join_room(self, room: str):
        """Join a chat room."""
        self._rejoin_rooms.add(room)
        await self._ws_send({"type": "join_room", "room": room})
        self._rooms.add(room)
        log.info(f"Joined room #{room}")

    async def leave_room(self, room: str):
        """Leave a chat room."""
        self._rejoin_rooms.discard(room)
        await self._ws_send({"type": "leave_room", "room": room})
        self._rooms.discard(room)

    async def set_status(self, message: str = "", emoji: str = "", status_type: str = "os"):
        """
        Set the bot's status.
        status_type: 'os' = online status (shows online), 'as' = auto status (shows away)
        emoji: shortcode without colons e.g. 'robot'
        """
        await self._rest_post("/away", {
            "message": message,
            "emoji": emoji,
            "status_type": status_type
        })

    # ── REST helpers ────────────────────────────────────────────────────────────

    def _rest_request(self, method: str, path: str, body: dict = None) -> dict:
        url = self.rest_base + path
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            raise RuntimeError(f"HTTP {e.code}: {body}")

    async def _rest_post(self, path: str, body: dict) -> dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self._rest_request("POST", path, body))

    async def _rest_get(self, path: str) -> dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self._rest_request("GET", path))

    async def get_room_list(self) -> list[dict]:
        """Fetch list of all rooms."""
        data = await self._rest_get("/rooms")
        return data.get("rooms", [])

    async def get_dm_history(self, username: str, limit: int = 50) -> list[dict]:
        """Fetch DM history with a user."""
        data = await self._rest_get(f"/history/dm/{username}")
        msgs = data.get("messages", [])
        return msgs[-limit:]

    async def get_room_history(self, room: str, limit: int = 100) -> list[dict]:
        """Fetch message history for a room."""
        data = await self._rest_get(f"/history/room/{room}")
        msgs = data.get("messages", [])
        return msgs[-limit:]

    async def get_emojis(self) -> list[str]:
        """Fetch the list of available custom emoji shortcodes."""
        data = await self._rest_get("/eref")
        return data.get("emojis", [])

    # ── Message handling ────────────────────────────────────────────────────────

    async def _handle_message(self, raw: str):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            log.warning(f"Non-JSON message: {raw[:80]}")
            return

        t = msg.get("type")

        if t == "init":
            self.username = msg.get("username")
            self._connected = True
            log.info(f"Connected as {self.username}")
            # Rejoin rooms from previous session
            for room in list(self._rejoin_rooms):
                try:
                    await self._ws_send({"type": "join_room", "room": room})
                    self._rooms.add(room)
                except Exception:
                    pass
            await self._dispatch("ready", self.username)

        elif t == "room_message":
            sender = msg.get("from", "")
            if sender == self.username:
                return  # ignore own messages echoed back
            message = Message(
                room=msg.get("room", ""),
                sender=sender,
                content=msg.get("content", ""),
                is_bot=msg.get("is_bot", False)
            )
            await self._dispatch("room_message", message)

        elif t == "dm":
            sender = msg.get("from", "")
            if sender == self.username:
                return
            dm = DirectMessage(
                sender=sender,
                content=msg.get("content", ""),
                is_bot=msg.get("is_bot", False)
            )
            await self._dispatch("dm", dm)

        elif t == "presence":
            p = Presence(
                username=msg.get("user", ""),
                status=msg.get("status", "offline"),
                away_message=msg.get("away_message", ""),
                emoji=msg.get("emoji", "")
            )
            await self._dispatch("presence", p)

        elif t == "room_event":
            event_type = msg.get("event")
            evt = RoomEvent(
                room=msg.get("room", ""),
                user=msg.get("user", ""),
                event=event_type
            )
            if event_type == "join":
                await self._dispatch("room_join", evt)
            elif event_type == "leave":
                await self._dispatch("room_leave", evt)

        elif t in ("room_message_echo", "dm_echo", "room_joined", "typing"):
            pass  # silently ignored

        else:
            log.debug(f"Unhandled event type: {t}")

    # ── Connection loop ─────────────────────────────────────────────────────────

    async def _connect_loop(self):
        ws_url = f"{self.server}/ws?token={self.token}"
        attempt = 0

        while self._running:
            attempt += 1
            try:
                log.info(f"Connecting to {self.server} (attempt {attempt})...")
                async with websockets.connect(
                    ws_url,
                    ping_interval=30,
                    ping_timeout=10,
                    close_timeout=5
                ) as ws:
                    self._ws = ws
                    attempt = 0  # reset on success
                    log.info("WebSocket connected")

                    async for raw in ws:
                        await self._handle_message(raw)

            except websockets.exceptions.ConnectionClosedOK:
                log.info("Connection closed cleanly")
            except websockets.exceptions.ConnectionClosedError as e:
                log.warning(f"Connection closed with error: {e}")
            except Exception as e:
                log.error(f"Connection error: {e}")

            self._connected = False
            self._ws = None
            await self._dispatch("disconnect")

            if not self.reconnect or not self._running:
                break

            delay = min(self.reconnect_delay * attempt, 60)
            log.info(f"Reconnecting in {delay:.1f}s...")
            await asyncio.sleep(delay)

    async def start(self):
        """Start the bot (async). Use bot.run() for blocking."""
        self._running = True
        await self._connect_loop()

    def run(self):
        """Start the bot, blocking until stopped."""
        try:
            asyncio.run(self.start())
        except KeyboardInterrupt:
            log.info("Bot stopped by user")
        finally:
            self._running = False

    def stop(self):
        """Stop the bot gracefully."""
        self._running = False
        if self._ws:
            asyncio.create_task(self._ws.close())


# ── Command helper ─────────────────────────────────────────────────────────────

class CommandBot(CIMBot):
    """
    CIMBot subclass with a built-in command handler.

    Usage:
        bot = CommandBot(token="...", prefix="!")

        @bot.command("ping")
        async def ping(message, args):
            await bot.send_room(message.room, "pong!")

        @bot.command("roll")
        async def roll(message, args):
            import random
            sides = int(args[0]) if args else 6
            await bot.send_room(message.room, f"rolled: {random.randint(1, sides)}")

        bot.run()
    """

    def __init__(self, *args, prefix: str = "!", **kwargs):
        super().__init__(*args, **kwargs)
        self.prefix = prefix
        self._commands: dict[str, Callable] = {}

        @self.on_room_message
        async def _dispatch_commands(message: Message):
            if not message.content.startswith(self.prefix):
                return
            parts = message.content[len(self.prefix):].split()
            if not parts:
                return
            cmd = parts[0].lower()
            args = parts[1:]
            handler = self._commands.get(cmd)
            if handler:
                try:
                    await handler(message, args)
                except Exception as e:
                    log.error(f"Error in command !{cmd}: {e}", exc_info=True)

    def command(self, name: str):
        """Register a command handler.
        Signature: async def handler(message: Message, args: list[str])"""
        def decorator(fn: Callable):
            if not asyncio.iscoroutinefunction(fn):
                raise TypeError(f"Command '{name}' handler must be async")
            self._commands[name.lower()] = fn
            return fn
        return decorator

    @property
    def commands(self) -> list[str]:
        return list(self._commands.keys())
