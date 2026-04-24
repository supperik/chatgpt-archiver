# chatgpt-archiver

Network-based archiver for ChatGPT chats.

The project no longer parses the rendered DOM. The only supported pipeline is:

1. start or attach to an authorized Chromium-based browser
2. capture real ChatGPT API headers from that browser session
3. request chat lists and full chat payloads through `backend-api/*`
4. import those responses into local JSON records
5. render a static HTML archive

## What it stores

- raw discovery responses: `archive/network/discovery/raw`
- normalized chat targets: `archive/network/discovery/chat-targets.json`
- raw full chat payloads: `archive/network/chats/<chat-id>.json`
- rendered archive: `archive/index.html` and `archive/chats/<chat-id>/chat.html`

## Install

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

If you want Playwright to launch its own Chromium profile:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run install:browsers
```

## Main commands

### One command for the full pipeline

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run network:run -- --cdp-url http://127.0.0.1:9222
```

This does:

- capture auth headers from the authorized browser
- fetch regular chats and project chats
- fetch every full chat payload
- import everything into the archive
- rebuild HTML

### Fetch only

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run network:fetch -- --cdp-url http://127.0.0.1:9222
```

### Import and render already fetched JSON

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run network:import
```

### Built CLI

After `npm run build` you can also use the compiled CLI:

```powershell
& 'C:\Program Files\nodejs\node.exe' dist\cli.js run --cdp-url http://127.0.0.1:9222
& 'C:\Program Files\nodejs\node.exe' dist\cli.js fetch --cdp-url http://127.0.0.1:9222
& 'C:\Program Files\nodejs\node.exe' dist\cli.js import
```

## Browser setup

The most reliable mode is attaching to a normal logged-in browser over CDP.

### Chrome

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --remote-debugging-port=9222 --user-data-dir="$PWD\.remote-debug-profile\chrome"
```

Then open ChatGPT in that browser, make sure you are logged in, and run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run network:run -- --cdp-url http://127.0.0.1:9222
```

### Yandex Browser

```powershell
& 'C:\Program Files\Yandex\YandexBrowser\Application\browser.exe' --remote-debugging-port=9222 --user-data-dir="$PWD\.remote-debug-profile\yandex"
```

Then:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run network:run -- --cdp-url http://127.0.0.1:9222
```

### Let the tool launch the browser

```powershell
& 'C:\Program Files\nodejs\node.exe' dist\cli.js launch-browser --browser chrome
```

or:

```powershell
& 'C:\Program Files\nodejs\node.exe' dist\cli.js launch-browser --browser yandex
```

After the browser starts and you are logged in:

```powershell
& 'C:\Program Files\nodejs\node.exe' dist\cli.js run --cdp-url http://127.0.0.1:9222
```

## Authentication notes

- `--cdp-url` is the preferred mode
- `--manual-login` is supported when Playwright launches the browser profile itself
- header capture now accepts `/backend-api/me` as a valid source request in addition to chat list endpoints

Examples:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run network:run -- --manual-login --profile-dir .playwright-profile
& 'C:\Program Files\nodejs\node.exe' dist\cli.js fetch --manual-login --profile-dir .playwright-profile
```

## Fetch options

```text
--non-project-limit <n>            Page size for regular chats
--projects-limit <n>               Initial page size for projects
--project-conversations-limit <n>  Initial per-project chats limit
--max-sidebar-expansion-rounds <n> Maximum rounds of project sidebar expansion
--import                           Immediately import and render after fetch
```

`run` is equivalent to `fetch --import`.

## Import options

```text
--out-dir <path>         Archive root, default: ./archive
--responses-dir <path>   Raw chat payloads, default: ./archive/network/chats
--targets-file <path>    Chat targets index, default: ./archive/network/discovery/chat-targets.json
```

## Rendering model

Rendering is based on network message metadata, not DOM heuristics.

The renderer uses:

- `author.role`
- `content.content_type`
- `channel`
- `metadata.turn_exchange_id`
- `metadata.parent_id`
- `metadata.reasoning_status`
- `metadata.is_thinking_preamble_message`
- `metadata.is_visually_hidden_from_conversation`

This allows the archive to distinguish:

- user messages
- assistant final messages
- assistant commentary / preamble updates
- assistant thoughts
- assistant reasoning recap
- hidden system messages

## Development

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run check
& 'C:\Program Files\nodejs\npm.cmd' test
```

## Removed legacy behavior

The old DOM-based flow has been removed. The project no longer:

- crawls the sidebar DOM to discover chats
- parses rendered conversation HTML to build messages
- uses copy-button extraction
- downloads files from the page UI
- supports the old `discover` / `archive` / DOM `render` commands
