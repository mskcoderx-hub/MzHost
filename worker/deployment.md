# MzHost deployment

In Vercel, open the MzHost project's **Settings → Environment Variables**. Use the Production environment for the live site and separate credentials and MongoDB databases for Preview deployments.

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://mzhost.vercel.app` |
| `MONGODB_URI`, `MONGODB_DB` | Atlas connection string and database for this environment. Payment settlement uses MongoDB transactions. |
| `VPS_WORKER_KEY` | Private random worker key, at least 32 characters. Enter the same value on your VPS. |
| `DISCORD_CLIENT_ID` | MzBot's application ID in the Discord Developer Portal. |
| `DISCORD_CLIENT_SECRET` | MzBot's OAuth2 client secret. |
| `DISCORD_BOT_TOKEN` | MzBot's bot token, used server-side for status and ratings. |
| `CRON_SECRET` | Separate random secret shared with the status updater. |
| `NOWPAYMENTS_API_KEY` | API key from the target NOWPayments merchant account. |
| `NOWPAYMENTS_IPN_SECRET` | The merchant's separate instant payment notification secret. |
| `NOWPAYMENTS_SANDBOX` | `true` for sandbox testing, `false` for live payments. Use the corresponding credentials. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Production admin username and unique password of at least 16 characters. Local loopback preview supports `1` / `1`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Existing Resend verification configuration. |

**Discord.** Add the exact redirect URI `https://mzhost.vercel.app/api/discord-callback` under OAuth2 redirects. The login requests identify and verified email. Enable View Channel and Read Message History in ratings channel `1574753304016068759`. Grant those permissions plus Send Messages in status channel `1574573212975767684`. Use **Sync Discord status** in `/admin` to post the first message. Set up the [status updater](status-sync.md) for subsequent checks. The public status page is at `/status`.

**NOWPayments.** Configure the merchant payout wallet and IPN secret. The invoice includes the callback `https://mzhost.vercel.app/api/payments-ipn`. The customer returns to `/billing` to check payment status. A signed, fully paid, finished invoice grants a 30-day term. Duplicate notifications are idempotent. Sandbox settlement records a test order. Check the minimum transaction amount for the currencies you offer before advertising small monthly invoices.

**Deploy and verify.** From Windows PowerShell in the repository:

```powershell
git add -- .env.example api/preview.js vercel.json src/public/*.html src/public/*.css src/public/*.js src/server/*.cjs test/*.cjs worker
git diff --cached --stat
git commit -m "Add verified hosting plans, payments and Discord services"
git push origin main
```

Once Vercel completes deployment, use the [worker installation steps](README.md). Rotate any previously shared VPS gateway password/token, worker key and MongoDB password. Apply the updated credentials at their respective services and in the deployments that use them.

1. Open the site in a fresh browser profile and accept the cookie notice. Sign in with Discord or email. Verify that the homepage offers Dashboard and that Account settings can sign out.
2. Choose Free in Billing, create a project, run a script that writes to `/data`, and verify its data survives a restart. With two verified accounts, check that each sees only its own console output. Start a second worker slot to test concurrent hosting.
3. Use a sandbox invoice and inspect its status in Billing and Admin. Confirm that sandbox callbacks leave live entitlements unchanged. Complete a controlled live purchase only after storage, worker capacity and payment minimums are verified.
4. Check the status page, the Discord panel and selected ratings. Google login and rewarded ads await their provider integrations.
