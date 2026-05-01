# cIM
commodore. Instant Messenger - AIM-Inspired chat server! ("commodore." refers to me the developer not the C64 or brand behind it no affiliation whatsoever)

---

## Bot SDK
i made cIM bots. here's the SDK and a full tutorial on how to register one and get it running.

### Registration

1. Open up yo dayum terminal, we gettin real.

2. First you need your user token. This is obtainable by doing:
   ```bash
   curl -X POST https://inspire.tail0e8d21.ts.net/cim/login \
     -H "Content-Type: application/json" \
     -d '{"username": "YOUR_USERNAME", "password": "YOUR_PASSWORD"}'
   ```
   or for my loyal [apic](https://github.com/Knittight/apic) users:
   ```bash
   apic -p https://inspire.tail0e8d21.ts.net/cim/login --body '{"username":"user", "password":"pass"}'
   ```
   If you did it right you'll get back a `token` field. **Do NOT share this. Ever.**

3. Now register your bot. Swap in your user token and pick a name:
   ```bash
   curl -X POST https://inspire.tail0e8d21.ts.net/cim/bot/register \
     -H "Authorization: Bearer YOUR_USER_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"bot_name": "my-bot", "description": "does cool stuff"}'
   ```
   or with apic:
   ```bash
   apic -p https://inspire.tail0e8d21.ts.net/cim/bot/register \
     -H "Authorization: Bearer YOUR_USER_TOKEN" \
     --body '{"bot_name": "my-bot", "description": "does cool stuff"}'
   ```
   You'll get back a `token` that starts with `cim_bot_...`. **Store this somewhere safe — it will NOT be shown again.** If you lose it, use `/bot/regenerate/{bot_name}` to get a new one.

---

### Writing a Bot

Install the one dependency:
```bash
pip install websockets
```

Drop `cimbot.py` somewhere your bot can import it, then write your bot:

```python
from cimbot import CommandBot

bot = CommandBot(token="cim_bot_YOUR_TOKEN_HERE", prefix="!")

@bot.on_ready
async def ready(username):
    print(f"Logged in as {username}")
    await bot.join_room("lobby")
    await bot.set_status("vibing", "robot", "os")

@bot.command("ping")
async def ping(message, args):
    await bot.send_room(message.room, "pong!")

@bot.command("hello")
async def hello(message, args):
    await bot.send_room(message.room, f"hey {message.sender}!")

bot.run()
```

Run it:
```bash
CIM_TOKEN=cim_bot_... python my_bot.py
```

---

### Events

| Decorator | When it fires | Handler signature |
|---|---|---|
| `@bot.on_ready` | Connected + init received | `async def fn(username: str)` |
| `@bot.on_room_message` | Message in a joined room | `async def fn(message: Message)` |
| `@bot.on_dm` | Bot receives a DM | `async def fn(dm: DirectMessage)` |
| `@bot.on_presence` | A user's status changes | `async def fn(presence: Presence)` |
| `@bot.on_room_join` | Someone joins a room | `async def fn(event: RoomEvent)` |
| `@bot.on_room_leave` | Someone leaves a room | `async def fn(event: RoomEvent)` |
| `@bot.on_disconnect` | Bot disconnects | `async def fn()` |
| `@bot.on_error` | Handler throws an exception | `async def fn(error: Exception)` |

---

### Methods

```python
await bot.send_room(room, content)           # send a message to a room
await bot.send_dm(username, content)         # send a DM
await bot.join_room(room)                    # join a room (auto-rejoins on reconnect)
await bot.leave_room(room)                   # leave a room
await bot.set_status(message, emoji, type)  # set bot status ("os" or "as")
await bot.get_room_list()                    # returns list of all rooms
await bot.get_dm_history(username)           # DM history with a user
await bot.get_room_history(room)             # room message history
await bot.get_emojis()                       # list of available emoji shortcodes
```

Emojis in messages use `:shortcode:` format, same as the cIM client — e.g. `:fire:`, `:robot:`, `:thumbs-up:`.

---

### Context objects

**`Message`** (room message)
```python
message.room     # room name
message.sender   # who sent it
message.content  # what they said
message.is_bot   # True if sender is a bot
```

**`DirectMessage`**
```python
dm.sender   # who sent it
dm.content  # what they said
dm.is_bot   # True if sender is a bot
```

**`Presence`**
```python
presence.username     # whose status changed
presence.status       # "online" / "away" / "offline"
presence.online       # bool shorthand
presence.away_message # their status message
presence.emoji        # their status emoji shortcode
```

---

### Bot management

List your bots:
```bash
curl https://inspire.tail0e8d21.ts.net/cim/bot/list \
  -H "Authorization: Bearer YOUR_USER_TOKEN"
```

Regenerate a token (if you leaked it or lost it):
```bash
curl -X POST https://inspire.tail0e8d21.ts.net/cim/bot/regenerate/my-bot \
  -H "Authorization: Bearer YOUR_USER_TOKEN"
```

Delete a bot:
```bash
curl -X DELETE https://inspire.tail0e8d21.ts.net/cim/bot/my-bot \
  -H "Authorization: Bearer YOUR_USER_TOKEN"
```

Get public info about any bot:
```bash
curl https://inspire.tail0e8d21.ts.net/cim/bot/info/my-bot
```

---

### Notes

- Bots appear in the buddy list with a `[BOT]` badge (handled client-side)
- Auto-reconnect is on by default — if the server restarts your bot comes back automatically
- There's a built-in rate limiter (1.5 msg/s, burst of 6) so you don't accidentally spam
- The `CommandBot` subclass handles the `!prefix` parsing for you!


enjoy.
