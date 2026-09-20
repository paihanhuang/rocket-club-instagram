# Setup: accounts and keys (your track, about an hour)

Three things only you can do: create the Instagram account, create the Meta
developer app that lets our program post to it, and create the Discord channel
where you approve drafts. Every secret you collect goes into one file on this
Mac, `.env`, which is never committed (it is in `.gitignore`).

Menu labels on Meta's and Discord's sites change often. Each step names the
destination, so if a button is worded differently, look for the destination.

## 1. Instagram account (5 minutes)

1. In the Instagram app, create a new account with the handle `lahsrocketry`.
   Use the email you want to own this for now.
2. Switch it to a professional account: Settings, then "Account type and
   tools", then "Switch to professional account", and pick **Business**.
   Category can be "Education" or "Community". Business is required; Creator
   also works with the API but Business is the safer choice for insights.
3. Write a placeholder bio for now: "LAHS Rocket Club. Student-run. Launches,
   opportunities, and how rockets work, for South Bay high schoolers."
   The bio can be polished later; the API path needs the account to exist.

## 2. Meta developer app (30 minutes, the fiddly one)

Facts from Meta's docs, checked on 2026-09-19: the path called "Instagram API
with Instagram Login" needs no Facebook Page, supports Business accounts,
includes content publishing, and needs no App Review when the app is only for
an account you own. Tokens from the dashboard last 60 days and our publisher
refreshes them.

1. Go to https://developers.facebook.com and log in. You may need to register
   as a developer (accept terms, verify by phone or email).
2. Create an app: "My Apps", then "Create App". When asked for the use case,
   choose the **Instagram** one (the Instagram API with Instagram Login). Name
   it `lahsrocketry newsroom`. If it asks for a business portfolio, you can
   skip or create a minimal one.
3. In the app dashboard, open the Instagram product page. Find the section
   for **API setup with Instagram login**. There are three numbered steps on
   that page:
   - **Generate access tokens**: click "Add account", log in as
     `@lahsrocketry`, and authorize. Then click "Generate token". Accept every
     permission it offers; we need at least `instagram_business_basic`,
     `instagram_business_content_publish`, and
     `instagram_business_manage_insights`. Copy the token. It is long.
   - The page also shows the **Instagram user ID** (a long number) next to the
     account. Copy it.
   - Skip the webhook and business-login steps. We do not need them.
4. In "App settings", then "Basic", copy the **App ID** and the **App secret**
   (click "Show"). We keep these for token refresh and for a future re-login.
5. Leave the app in **Development** mode. Meta's docs say that is enough for
   posting to your own account.

## 3. Discord approval channel (10 minutes)

1. Create a Discord server (or use the club's) and a private text channel
   named `#approvals`. Only officers and the advisor should see it.
2. Turn on Developer Mode in Discord: User Settings, then "Advanced", then
   "Developer Mode". Right-click the `#approvals` channel and choose
   "Copy Channel ID". Save it.
3. Go to https://discord.com/developers/applications and click
   "New Application". Name it `lahsrocketry newsroom`.
4. Open the **Bot** page. Click "Reset Token", copy the **bot token**. Under
   "Privileged Gateway Intents" nothing needs to be enabled; our bot never
   listens live, it only posts and reads reactions over the web API.
5. Open "OAuth2", then "URL Generator". Tick the scope `bot`. Under bot
   permissions tick: View Channels, Send Messages, Attach Files, Read Message
   History, Add Reactions. Copy the generated URL, open it, and add the bot to
   your server.
6. In `#approvals`, make sure the bot can see the channel (channel
   permissions, add the bot's role).

## 4. Put the secrets on this Mac (2 minutes)

Create a file named `.env` in this folder with exactly these lines, values
filled in. Never paste these anywhere else.

```
IG_USER_ID=
IG_ACCESS_TOKEN=
META_APP_ID=
META_APP_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_APPROVAL_CHANNEL_ID=
```

Then run the checkup, which tests every key without posting anything:

```
pnpm tool doctor
```

It reports, line by line, whether the Instagram token works, what account it
belongs to, whether the Discord bot can see the channel, and whether the local
model server is reachable. Fix anything red and run it again.

## What I do on my side

Create the GitHub repository and the Pages branch that hosts approved images,
and wire all of the above into the publisher. You never need to touch GitHub.
