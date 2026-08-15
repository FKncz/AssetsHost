# AssetsHost

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![deploy](https://img.shields.io/badge/deploy-Vercel-black)](https://vercel.com)
[![live demo](https://img.shields.io/badge/live%20demo-online-brightgreen)](https://demoassets-host.vercel.app/)

A self-hosted asset CDN. Log in with one password, upload files, get permanent
public URLs, and manage everything from a dashboard. Built on Next.js 16, Vercel
Blob, and Postgres, with a public gallery for the files you choose to list.

**Live demo: [demoassets-host.vercel.app](https://demoassets-host.vercel.app/)** —
password `outofmemory`. Nothing you do there persists.

```
https://cdn.example.com/f/sunset-gradient.jpg
https://cdn.example.com/f/invoice-2026.pdf
https://cdn.example.com/f/demo-clip.mp4
```

- **Upload** through a drag-and-drop dashboard, with progress and category
  filtering.
- **Serve** from permanent public URLs. Anyone with the URL can view a file, no
  auth needed, that's the point of a CDN.
- **Manage** everything: browse, search, filter by category, rename to a vanity
  alias, soft-delete.
- **List selectively.** Reachable-by-URL and shown-in-the-gallery are separate
  concerns; a file is public only when you list it.
- **Protect** the dashboard behind a single shared password and a signed session
  cookie. No user database to run.
- **Lock individual files** behind their own password. A locked file is shared at
  `/p/<name>`, reveals nothing but its name until the password is typed, and is a
  flat "not found" to everyone else.
- **Try it first.** A zero-dependency demo mode runs the whole app with no
  Postgres, Blob, or secrets, seeded with sample files. There's one
  [running here](https://demoassets-host.vercel.app/).

Uploaded bytes live in Vercel Blob as **private** blobs. The only way to read
them is through this app's CDN route, which is what makes deletes actually stick
and lets the app own caching and headers.

## Deploy your own

No local setup at all, this runs on Vercel's free tier. Four steps, roughly 15
minutes, all of it clicking buttons on three websites: GitHub (holds the code),
Neon (the database), Vercel (runs the site & stores the files).

Keep a scratch notepad open, you'll copy a few values between the steps.

### 1. Fork the repo

Open [Creative-Softworks/AssetsHost](https://github.com/Creative-Softworks/AssetsHost),
click **Fork** at the top-right, then **Create fork**. You now have your own copy at
`github.com/YOUR-USERNAME/AssetsHost` and you never have to touch the code in it.

### 2. Get a Postgres database (Neon)

The database only stores the file list, names and which files are listed publicly.
The files themselves go to Blob storage in step 4.

1. Go to **[neon.com](https://neon.com)** and click **Sign Up** in the top-right.
   **Continue with GitHub** is quickest.
2. Neon asks you to create a project immediately:
   - **Project name**: anything, e.g. `assetshost`.
   - **Postgres version**: leave the default.
   - **Region**: pick the location closest to you.
3. Click the green **Create Project**.

Neon makes a database called `neondb` for you. That one's fine, no need to add
another.

Now copy the **connection string** — one long piece of text holding the address,
username and password together. It's what goes in `DATABASE_URL`.

4. Click **Dashboard** at the top of the left sidebar.
5. Find the **Connection Details** panel and make sure the **Database** dropdown
   says `neondb`.
6. Turn **Pooled connection** **ON**. This app runs as Vercel serverless functions,
   which open lots of short-lived connections, and pooling is what keeps that from
   exhausting the database. (If there's no toggle, check for `-pooler` in the
   hostname, that means it's already pooled.)
7. Click the **copy** icon next to the line starting with `postgresql://` and paste
   it in your notepad.

Any other Postgres host works too. On Supabase it's **Project Settings → Database →
Connection string**, and you want the pooled "Transaction" one.

### 3. Import to Vercel

1. Go to **[vercel.com](https://vercel.com)**, click **Sign Up**, choose **Continue
   with GitHub**, and **Authorize** if asked.
2. In the dashboard click **Add New…** (top-right) → **Project**.
3. Under **Import Git Repository** find **AssetsHost** and click **Import**.
4. Leave **Project Name**, **Framework Preset** and all build settings alone,
   Next.js is auto-detected.
5. Expand **Environment Variables** and add these three. Type the name in **Key**,
   paste the value in **Value**, click **Add**, repeat.

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the `postgresql://…` string from step 2 |
   | `SESSION_SECRET` | a random 32+ character string ([generate one](#configuration)) |
   | `AUTH_PASSWORD` | the password you want to type to reach the dashboard |

6. Click **Deploy** at the bottom and wait a minute or two. You get confetti and a
   **Congratulations!** screen when it's done.

### 4. Add the Blob store

The site is live now, but has nowhere to put uploads yet.

1. Click **Continue to Dashboard**, then open the **Storage** tab.
2. Click **Create Database** (or **Connect Store**), choose **Blob**, name it
   anything, confirm. Vercel wires it up and injects `BLOB_READ_WRITE_TOKEN`, you
   never copy that one yourself.
3. Go to **Deployments**, open the **…** menu on the newest one, and hit
   **Redeploy** so the app picks the token up.

Then click your `.vercel.app` link under **Domains**, open the **control panel**,
log in with the `AUTH_PASSWORD` you chose, and drag a file in.

That's it, there's no schema step. On its first boot the app creates its own tables,
indexes and the `pg_trgm` extension in whatever database `DATABASE_URL` points at,
then records what it did so later boots skip straight past. Point it at an empty
Neon or Supabase database and it just works.

Pushes to `main` auto-deploy from then on, and you can pull upstream changes into
your fork with GitHub's **Sync fork** button.

**If something's off:** a build failing on `DATABASE_URL`, or a login that rejects
your password, almost always means a missing or misspelled environment variable.
Uploads failing means step 4 was skipped. And Vercel only picks up variable changes
on a new deployment, so redeploy after editing any of them.

Want to see it before committing to any of that? Try the
[live demo](https://demoassets-host.vercel.app/) (password `outofmemory`), or deploy
your own with `DEMO_MODE=true` and `NEXT_PUBLIC_DEMO_MODE=true` as the *only* env
vars, no database, Blob store, or secrets needed. See [Demo mode](#demo-mode).

## Configuration

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob API token (auto-injected when you create a Blob store on Vercel) |
| `SESSION_SECRET` | ✅ | Random 32+ char string used to sign login sessions |
| `AUTH_PASSWORD` | ✅ | The password you type to reach the dashboard |
| `CDN_HOST` | – | Custom domain for serving files (e.g. `cdn.example.com`). Unset in dev, `/f/:name` is used instead |
| `NEXT_PUBLIC_CDN_HOST` | – | Same value, exposed to the browser for building public URLs |
| `DEMO_MODE` | – | Set to `true` to run the zero-dependency showcase (see [Demo mode](#demo-mode)) |
| `NEXT_PUBLIC_DEMO_MODE` | – | Same value, exposed to the browser |
| `SKIP_DB_BOOTSTRAP` | – | Set to `true` to stop the app creating its own schema (see [Schema bootstrap](#schema-bootstrap)) |

Generate a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Schema bootstrap

The app provisions its own database. On every server start it reads one marker row
(`assetshost_meta`); if it says the schema is current, nothing else happens. If the
marker is missing or stale it runs the `create … if not exists` DDL in
`src/server/db/bootstrap.ts` — the `files` table, its indexes, and the `pg_trgm`
extension that the filename search index needs — then writes the marker. So an empty
database becomes a working one on first boot, and an existing one costs a single query.

Two things worth knowing:

- **If the role can't create extensions**, `pg_trgm` is skipped and so is that one
  index. Search still works, it just falls back to a slower scan. The marker records
  the partial state, so a later boot with a privileged role finishes the job. You can
  also do it by hand once: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- **If the role can't create anything at all** but the tables already exist, the app
  logs a warning and carries on. To manage the schema yourself, run `pnpm db:push`
  and set `SKIP_DB_BOOTSTRAP=true`.

## Running locally

Only needed if you want to hack on the code, deploying doesn't require it.
Requires Node.js 22 (see `engines` in `package.json`), and pnpm.

```bash
git clone https://github.com/YOUR-USERNAME/AssetsHost
cd AssetsHost
pnpm install
cp .env.example .env   # then fill it in
pnpm dev
```

Open http://localhost:5000. The landing page has two doors: the public
**gallery**, and the **control panel** (`/control-panel`), which prompts for your
`AUTH_PASSWORD`.

The first `pnpm dev` creates the schema in whatever `DATABASE_URL` points at. If you're
changing `src/server/db/schema.ts` you'll want `pnpm db:push` as well, which is the
authoritative Drizzle sync — see [Schema bootstrap](#schema-bootstrap).

For a look around with no database or Blob store at all, put `DEMO_MODE=true` and
`NEXT_PUBLIC_DEMO_MODE=true` in `.env` and skip straight to `pnpm dev`.

## How auth works

There's no user database, just one shared password (`AUTH_PASSWORD`).

When you log in with the right password, the server signs a small token with
`SESSION_SECRET` and hands it to your browser as a cookie. On every later request
the server re-signs the token and checks the signatures match: if they do you're
in; if the token was tampered with they diverge and it's rejected.

The important part: **`SESSION_SECRET` never leaves the server.** Only the signed
token travels to the browser. That's why the secret has to stay private and never
gets committed, anyone who has it could mint valid login tokens. Think of it as
the ink in a rubber stamp locked in the office: the stamped receipt (the token)
goes out into the world, the stamp stays put.

The token is *signed*, not *encrypted*, its contents (just an expiry time) are
readable, but only your server can produce a valid signature for them.

**Guessing the login is capped**, 10 tries per visitor per 10 minutes, plus 120
across the whole instance so rotating IPs doesn't buy much. Over the cap the login
answers "too many attempts" and tells the page how long to wait; signing in
successfully clears your own count, so an honest typo streak costs nothing. The
same caveat as the file passwords applies: without a trusted proxy in front of the
app the per-visitor cap can be sidestepped by faking the client IP, which is what
the instance-wide cap is there to bound. `AUTH_PASSWORD` still wants to be a real
password, nothing enforces a length.

## Public access and the "listed" model

Every uploaded file gets a permanent public URL, and anyone with that URL can
view the file. That's what a CDN is for.

Browsing (a public gallery of files) is a separate concern from access (having
the URL). A file being reachable by URL does not mean it shows up in any public
listing, a file appears in the gallery only when you toggle it on. This keeps
"share this one link" and "put this on the public wall" as two different actions.

## Password protected files

Any file can carry its own password, separate from the dashboard login. Set it
while uploading, or later from the file's card in the dashboard.

A protected file is shared at **`/p/<name>`** instead of the plain file URL. Until
the right password is entered, that page shows the file's name and nothing else:
no thumbnail, no size, no type. The file URL itself doesn't help either, it
answers "not found" for anyone without the password, exactly as if the file had
never existed. Protected files can still be listed in the gallery; they show up as
a lock, and clicking through lands on the unlock page.

Some details worth knowing:

- **Unlocking lasts an hour**, per file, in that one browser.
- **Changing or removing the password locks everyone out immediately**, including
  anyone who unlocked the file a minute ago.
- **You stay in** — logged into the dashboard, you can open and preview your own
  protected files without typing their passwords.
- **Guessing is capped**, 5 tries per visitor per 10 minutes (and 30 per file, so
  rotating IPs doesn't help). Wrong guesses say only "incorrect password".
- **Passwords are stored hashed** (PBKDF2-SHA256, 210k iterations), never in
  plain text, and a lost password can't be recovered, only replaced.
- **Locking a file that was already public doesn't un-share the copies already
  out there.** A public file is cached hard (a year) by browsers and CDN edges, so
  adding a password stops new downloads, not ones already cached. If a file was
  public and shouldn't have been, treat the URL as burned.
- **Pick a real password.** Guessing is capped, but on a self-hosted deploy with no
  trusted proxy in front the per-visitor cap can be sidestepped by faking the
  client IP; the per-file cap still holds it to roughly 4000 guesses a day, which
  is plenty to find a dictionary word.
- **No extra configuration.** The feature reuses `SESSION_SECRET`; there are no
  new environment variables.

## Demo mode

A demo instance is live at
**[demoassets-host.vercel.app](https://demoassets-host.vercel.app/)** — log in with
`outofmemory` (prefilled) and poke at everything. It's a real deploy of this repo
with the two flags below and nothing else, so it costs no database and keeps no
state.

For an open-source showcase you can run the entire app with **no external
services**: no Postgres, no Blob store, no secrets. Set both flags:

```bash
DEMO_MODE=true NEXT_PUBLIC_DEMO_MODE=true pnpm dev
```

In demo mode:

- **Login accepts the fixed password `outofmemory`.** `AUTH_PASSWORD` isn't
  needed, and the field is prefilled on the login page.
- **The dashboard and gallery come pre-seeded** with the bundled sample files
  under `public/demo`, served as static assets through the same `/f/:name` URLs.
- **Renames, gallery toggles, and deletes are illusion.** They appear to work but
  never persist, everything resets on reload.
- **Uploads fake success.** The file shows up and is interactive through an
  in-browser `blob:` URL, carries a "showcase only" disclaimer, and vanishes on
  reload.
- **One file is password protected** so you can try that flow too. Its password is
  the same `outofmemory`.

Default behavior (both flags unset) is completely unchanged. Every demo branch is
gated, so self-hosters get the normal app with zero overhead.

## Project layout

```
src/
├── middleware.ts                 ← auth guard + /f/ public file alias
├── instrumentation.ts            ← runs the schema bootstrap at server start
├── app/
│   ├── page.tsx                  ← public landing (gallery + control-panel links)
│   ├── login/page.tsx            ← password login
│   ├── gallery/page.tsx          ← public gallery of "listed" files
│   ├── control-panel/            ← dashboard: stats + upload + file browser (auth)
│   ├── api/
│   │   ├── auth/…               ← session management
│   │   ├── upload/…             ← reserve → upload → complete flow
│   │   ├── files/…             ← list (paginated/search/filter), delete, rename, list toggle, password
│   │   ├── gallery/route.ts     ← public listing of "listed" files
│   │   ├── protected/…          ← unlock endpoint for password protected files
│   │   └── stats/route.ts       ← total files + storage used
│   ├── p/[slug]/page.tsx         ← share page for a password protected file (no auth)
│   └── cdn/[...path]/route.ts    ← file serving (no auth; protected files need an unlock)
├── components/files/…            ← upload dropzone, file grid/card, gallery card, unlock form, stats bar
├── server/
│   ├── services/                 ← files, storage (Blob boundary), protection, rate limit
│   ├── demo/                     ← in-memory dataset used only in demo mode
│   ├── db/schema.ts              ← Drizzle schema
│   ├── db/bootstrap.ts           ← creates the schema on first boot
│   └── auth/…                   ← session tokens, password verification, unlock grants
└── lib/…                        ← upload client, crypto, filename/mime helpers, formatters
```

## Serving from your own domain

Point a subdomain like `cdn.example.com` at the Vercel project, then set both
`CDN_HOST` and `NEXT_PUBLIC_CDN_HOST` to it. Public URLs become
`https://cdn.example.com/f/:name` instead of falling back to the deployment URL.
The CDN route is host agnostic, so the dashboard keeps working on either host.

## Scripts

```bash
pnpm dev        # start the dev server on port 5000
pnpm build      # production build
pnpm start      # serve the production build
pnpm typecheck  # type-check without emitting
pnpm test       # unit tests (node --test, no framework)
pnpm db:push    # push the Drizzle schema (bootstrap handles a normal deploy)
```

There's also an end to end check for the password protected flow. With `pnpm dev`
running in another shell:

```bash
node scripts/smoke-protected.mjs
```

It inserts a temporary protected row, asserts that the file is unreachable while
locked, that unlocking works, that a password change revokes access, that guessing
gets rate limited, then deletes what it made.

And one for the login rate limit, which needs the same `AUTH_PASSWORD` the server
is running with:

```bash
node scripts/smoke-login-limit.mjs
```

It walks the per-visitor cap to a 429, checks another visitor isn't caught by it,
that a correct password can't step past the cap, and that signing in clears the
count. It only runs against localhost, since burning the limiter on a live
instance would lock you out for a window.

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get
set up and what to check before opening a pull request.

## A note from the dev

When I made this project, I smoked 3 kg of ganja, so I have no idea what I made. After finishing it, I ran React Doctor, and it showed 370+ errors of all kinds, so I gave up and handed the project to Claude, which overnight rewrote 60% of the website and added new UI and features. Now everything works. I tested it all out, found nothing bad, and I'm not going to use this project that often anyway, so why not make it open source?

Now here we are. You can use it, do whatever you want with it, just don't share so-called illegal files with it. 👍

## License

[MIT](./LICENSE) © revxshafi

---

<sub>This readme was compiled with assistance of AI.</sub>
