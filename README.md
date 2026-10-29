# Publish Etherpad to MediaWiki

Adds a **Publish** button inside Etherpad. Enter a wiki page URL and publish the pad on demand.

- **Replace:** updates the whole target page; MediaWiki retains previous revisions in history.
- **Archive then replace:** copies the old page content to `Page/Archive/TIMESTAMP-ID`, then updates the original. The archive is a content snapshot, not a move of the original page's revision history. Its edit summary identifies the source page and revision.
- Creates the target if it does not exist. Remembers destination, API URL, article path and publishing options for each pad.
- Aborts on an edit conflict. Archive failures stop publication; if replacement fails after an archive succeeds, the error identifies the saved archive.
- Uses the saved pad revision, checking it against the browser's revision and text. If still syncing, publication is refused; wait and retry.

This is a standalone plugin, not a modification to the Etherpad core repository. No MediaWiki extension, `ep_mediawiki` plugin, scheduler or separate bridge is required.

## Status and compatibility

Version 0.1.0; Node.js 20 or newer. Checked against Etherpad develop commit `21a4bed5005744e82c9ca851192d94a07fce000c` (29 October 2026). Uses documented plugin hooks and the same access checks used by Etherpad's import route.

Automated tests cover conversion, destination validation, bot-login/edit sequences, create-only writes, conflict guards, archive ordering and failures, access checks, browser-origin checks, concurrent publication, and password exclusion from saved settings. The MediaWiki responses and Etherpad core services are simulated in these tests. This package has **not** been installed on your PikaPods or tested against your live wiki. Check your pod's Node/Etherpad version before installation, and use a test wiki page for first publication.

## Install on PikaPods

PikaPods documents plugin installation through `https://YOUR-PAD-DOMAIN/admin/plugins`. Etherpad's catalogue uses npm packages. This GitHub repository contains the source; it has **not been published to npm**, so it will not yet appear in the catalogue. PikaPods does not document a ZIP-upload installation route. Uploading the ZIP via SFTP alone will not install it.

### 1. Publish the plugin package once

On a computer with Node.js 20+ and npm, download this repository with **Code → Download ZIP**, extract it, and open a terminal in the folder containing `package.json`. On Windows, open that folder in File Explorer, type `cmd` in the address bar, and press Enter. Create an npm account at https://www.npmjs.com/signup if needed. Then run:

```bash
npm ci
npm test
npm login
npm publish --access public
```

Follow npm's browser sign-in and two-factor authentication prompts. This publishes the plugin code publicly; no wiki credentials belong in this folder. The plugin name was unregistered when checked, but npm names are first-come-first-served. If npm returns a name-ownership error, do not simply rename package.json: plugin hook paths in ep.json and the client hook's package references must remain consistent. Choose another name and update those references before publishing.

### 2. Install in the Etherpad pod

1. Visit `https://YOUR-PAD-DOMAIN/admin/plugins` and log in with your Etherpad admin credentials. PikaPods exposes the admin password through the pod's `ADMIN_PASSWORD` environment setting.
2. Search for `ep_publish_mediawiki` and click **Install** after it appears in the catalogue.
3. Restart the pod if prompted, then reload your pad. The toolbar should contain **Publish**. No settings.json changes are needed.

New npm packages can take time to appear. Current Etherpad documentation also says the catalogue may omit plugins that its compatibility registry cannot run on the current release. If the published package remains absent or is rejected, ask PikaPods support to confirm package installation and compatibility for your pod version. Do not assume a ZIP upload or shell access is available.

Official references:
- https://docs.pikapods.com/apps/etherpad
- https://docs.etherpad.org/plugins.html

## Connect the wiki and publish

1. Log into your MediaWiki and open **Special:BotPasswords**. Create a bot named `Etherpad`. Grant **Edit existing pages** and **Create, edit, and move pages** (needed for new pages and archive copies). The account itself must also have those rights. Use the generated bot username, usually `YourUsername@Etherpad`, and bot password. This does not require membership in the bot group.
2. Find your wiki's API endpoint. In **Special:Version**, inspect **Entry point URLs**; the API address ends in `/api.php`. Common examples are `https://domain.net/api.php` or `https://domain.net/w/api.php`. A page URL alone does not reliably reveal the API path.
3. Open a pad and click **Publish**. Paste the destination, e.g. `https://domain.net/wiki/Test_publish`.
4. Open **Wiki connection**, enter the exact API URL and article path prefix (usually `/wiki/`). `index.php?title=Page_name` destination URLs are also supported. The API and destination must have the same HTTPS origin.
5. Enter the bot username and bot password. Select a content mode and replace/archive behaviour. Click **Publish**. A successful result links to the wiki page.

The destination settings are shared with editors of that pad. Credentials are not shared: the username/password fields stay only in the current tab's memory, are sent over HTTPS to the Etherpad server for the publish operation, and are not written to the pad or plugin database. Reload the tab to clear them. Changing the API URL clears the password. A wiki bot account dedicated to this plugin makes edits identifiable.

## Content modes

**Convert Etherpad formatting** supports headings, ordered/unordered lists, bold, italic, underline, strikeout, line breaks and HTTP(S) links. Literal wiki syntax is escaped, so typing `{{Template}}` in this mode will display that text rather than transclude a template. Colours, author highlighting, indentation, images, tables and other plugin-specific formatting are not faithfully converted. Images are not uploaded. Test an example with the formatting you need before adopting this workflow.

**Pad already contains wiki markup** publishes the saved plain-text pad content directly. Write headings, wiki links, templates and tables in MediaWiki syntax yourself; Etherpad toolbar formatting is ignored. Use Etherpad's plain-text editor conventions rather than its bullet-list buttons in this mode, because native list markers are internal document characters.

Publication replaces the whole destination page. It does not merge edits from the wiki back into the pad. Avoid editing the wiki while publishing: concurrent edits detected during publication are refused, but wiki changes made before publishing begins will be replaced as requested.

## Connection restrictions

HTTPS on the standard port is required for both services in normal use. Only public Internet wiki addresses are supported. The transport blocks private/reserved IPs, pins the DNS result per request, rejects redirects, uses a per-publication cookie jar, and bounds request/response sizes. If your wiki redirects `/api.php`, enter its final API endpoint directly. A PikaPods HTTP login wall in front of MediaWiki will block the API; wiki bot credentials do not bypass an additional proxy login.

Only users with pad editing access can publish. The server checks Etherpad authentication, authorization, API group sessions and read-only IDs, and requires a same-origin JSON request. No credentials are supplied automatically by the server. Do not add credential fields to shared pad text.

Ordinary content pages and subpages are supported. Special, interface, template, file, module, user and category namespaces, along with JS/CSS/JSON pages, are intentionally excluded by the URL parser.

## Self-hosted installation for current Etherpad

Clone or extract this repository somewhere persistent, then from the **Etherpad root** run:

```bash
pnpm run plugins install --path /absolute/path/to/ep_publish_mediawiki
```

Restart Etherpad using its normal service/container controls. This command is verified against the supplied repository's current `bin/plugins.ts`; older releases have different installers. Do not run `npm install` in Etherpad's root or edit its package.json manually. Running `npm ci` inside this standalone plugin folder is fine.

## Development

```bash
npm ci
npm test
npm pack --dry-run
```

`test/routes.test.js` exercises real Express HTTP routes with stub Etherpad services. `test/plugin.test.js` covers wiki operations and conversion. A live Etherpad + MediaWiki smoke test is still needed for your deployed versions. To uninstall, use Etherpad's plugin administration page and restart/reload. Existing published pages and archive copies remain in MediaWiki.
