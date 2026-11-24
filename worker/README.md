# Test hosting on the VPS

## Run the two Docker checks first

From PowerShell on the PC containing MzHost, run:

```powershell
cd E:\MskHost
powershell -NoProfile -ExecutionPolicy Bypass -File .\worker\copy-worker.ps1
ssh -p 2228 connect@hk.meowlix.in
```

Complete the gateway login. At the Linux prompt paste the clipboard contents and press Enter. If the SSH shell is already open, run the clipboard command in a second PowerShell window and paste into the existing shell. The helper installs the worker under `~/mzhost-worker`, then runs two small projects. The first run may download the official Python and Node Alpine images. A successful run prints `MzHost Python OK` and `MzHost Node OK`. On failure keep the Docker error for diagnosis. The checks publish zero ports and clean up their labeled container.

## Connect the private dashboard

1. Add `VPS_TEST_EMAIL` to the MzHost Vercel environment. Use your verified MzHost account email.
2. Generate a separate worker secret in PowerShell with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Save that value as `VPS_WORKER_KEY` in the same Vercel environment. The VPS will prompt for the same value. Keep it out of Git.
3. Deploy the new API and dashboard to the Vercel environment that uses your preview MongoDB. For the linked production branch run these commands on the PC:

```powershell
git add -- .env.example api/preview.js vercel.json src/public/dashboard.js src/server/accounts.cjs src/server/mongo-accounts.cjs src/server/runtime-test.cjs test/runtime-test.test.cjs worker
git commit -m "Connect a private Docker runtime worker for hosting tests"
git push
```

4. Once Vercel is ready, start the worker **in the VPS shell**:

```sh
cd ~/mzhost-worker
python3 vps.py --origin https://mzhost.vercel.app
```

5. Enter the worker key at the hidden prompt and leave the terminal open. Sign in to MzHost, open a Python server and add `main.py` in Files. Set it as startup. Use this project to test output over time:

```python
import time
for count in range(60):
    print("MzHost VPS heartbeat", count, flush=True)
    time.sleep(2)
```

6. Open **Console** and wait for **Worker online**. Type `run` or click **Start**. Watch the heartbeat numbers appear, then click **Stop**. You can also type `python main.py` or, in a Node project, `node index.js` to run a specific saved file.

7. To test input and output together, save the following as `test.py`. Type `python test.py` at the **Run a file** prompt. When the **Process input** field appears and the program asks for your name, type a name and press Enter. The reply and exit code appear above the input field. The terminal exchanges complete lines and refreshes on each poll. Ctrl+C in the VPS shell ends the worker.

```python
name = input("Your name? ")
print(f"Hello, {name}!")
```

## Trial limits

The worker polls Vercel over outbound HTTPS. Only the configured account can launch a project and one project can run at a time. Container output and process exit codes appear in the private Console. Other dashboard resource graphs and release history remain simulations. The trial uses standard-library projects, 128 MB RAM, a quarter CPU, read-only project files, writable temporary storage and disabled container networking. Customer secrets, dependency installation, external bot connections and public hosting are outside this trial. Disconnecting the foreground worker ends the test. A future production worker will need persistent supervision, storage, network isolation, resource enforcement and recovery testing.
