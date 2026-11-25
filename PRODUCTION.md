# MzHost production setup

The URLs below use `mzhost.vercel.app`. If the production domain changes, update the provider settings and `APP_ORIGIN` together.

## Admin sign-in

Open the MzHost checkout in PowerShell, sign in to the Vercel CLI and run `vercel link` for the MzHost project. Run `.\scripts\configure-admin.ps1`, choose your admin username and enter a password of at least 16 characters. The script stores a single password-hashed credential in the Vercel Production environment. Redeploy MzHost and sign in at `/admin`.

The existing `ADMIN_USERNAME` and `ADMIN_PASSWORD` settings also work. A configured `ADMIN_CREDENTIALS` record takes precedence. Production admin sessions require the project’s MongoDB connection.

## Discord

1. Open the Discord application matching `DISCORD_CLIENT_ID`.
2. In **OAuth2 → Redirects**, add `https://mzhost.vercel.app/api/discord-callback` and save.
3. In Vercel Production set `APP_ORIGIN=https://mzhost.vercel.app`, `DISCORD_CLIENT_ID`, and `DISCORD_CLIENT_SECRET`. An optional `DISCORD_REDIRECT_URI` specifies the exact registered callback when using a different production host.
4. Redeploy and test **Continue with Discord** using an account with a verified email.

## GitHub login and push updates

1. Create a GitHub App. Use `https://mzhost.vercel.app` as its homepage and `https://mzhost.vercel.app/api/github-callback` as its callback URL. Allow installation on **Any account** if customers will connect their own repositories.
2. Enable the webhook at `https://mzhost.vercel.app/api/github-hook` with a strong random webhook secret. Subscribe to **Push**.
3. Grant **Contents** and **Metadata** read access under repository permissions and **Email addresses** read access under account permissions. Generate a client secret.
4. Set `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_WEBHOOK_SECRET` in Vercel Production. Use the same webhook secret in both places. Redeploy. Rotating the client secret requires users to reconnect GitHub.
5. In a server’s **Deployments** page, connect GitHub, select **Manage repository access** to install the app on the desired repositories, then select **Choose repository**. Pick the repository, enter the branch and enable push updates if desired.

An import replaces the server’s project files and folders. Existing environment settings and backups stay with the server. The workspace supports 80 regular files, 256 KB per file and 3 MB per saved workspace, including backups. Symlinks and submodules are rejected. A successful push updates the files even while the server is stopped. An active compatible worker restarts the project when it has a valid startup file. **Sync now** retries an import, and **Disconnect** stops further push updates for that server.
