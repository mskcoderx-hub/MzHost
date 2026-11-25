# Discord status updater

Run this companion on the always-on machine that hosts MzBot, using Node.js 22 or newer. It sends an authenticated request to the MzHost website every two minutes. The website checks service health and updates one bot message in channel `1574573212975767684`. The companion prints a line when the result changes.

1. On Vercel, configure `DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN`, `APP_ORIGIN` and a random `CRON_SECRET`. Set `APP_ORIGIN` to the HTTPS website origin. Give the bot **View Channel**, **Read Message History** and **Send Messages** in the status channel and read access in the ratings channel.
2. Copy `worker/status-sync.cjs` to the bot host. In that service’s private environment, set the same `APP_ORIGIN` and `CRON_SECRET`.
3. Start it as a separate process alongside MzBot. Configure the host’s process manager to restart it after reboots.

```sh
node status-sync.cjs
```

If you use a private environment file on the bot host, run `node --env-file=.env status-sync.cjs`. A successful first sync prints “Discord status panel updated” or “Discord status panel is current.” If the MzHost website itself is unreachable, the companion records the failed check locally and retries. The Discord panel then reflects the last successful sync.
