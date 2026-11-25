# Test hosting on the VPS

## Run the two Docker checks first

From PowerShell on the PC containing MzHost, run:

```powershell
cd E:\MskHost
powershell -NoProfile -ExecutionPolicy Bypass -File .\worker\copy-worker.ps1
ssh -p 2228 connect@hk.meowlix.in
```

Complete the gateway login. At the Linux prompt paste the clipboard contents and press Enter. If the SSH shell is already open, run the clipboard command in a second PowerShell window and paste into the existing shell. The helper installs the worker under `~/mzhost-worker`, then runs two small projects. The first run may download the official Python and Node Alpine images. A successful run prints `MzHost Python OK` and `MzHost Node OK`. On failure keep the Docker error for diagnosis. The checks publish zero ports and clean up their labeled container.

## Connect hosting

1. Set a private `VPS_WORKER_KEY` (at least 32 random characters) in Vercel Production. The VPS prompts for the same key. Every verified account selects its own hosting plan at `/billing`.
2. Set up MongoDB and the provider credentials in [deployment.md](deployment.md).
3. Deploy the repository to Vercel and install the current worker with the clipboard helper above.

4. Once Vercel is ready, start the worker **in the VPS shell**:

```sh
cd ~/mzhost-worker
python3 vps.py --origin https://mzhost.vercel.app
```

5. Enter the worker key at the hidden prompt and leave the terminal open. Sign in to MzHost, choose Free in Billing, open a Python server and add `main.py` in Files. Set it as startup. Use this project to test output over time:

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

## Worker capacity and storage

One worker process supplies one slot. To run a second customer concurrently, start `python3 ~/mzhost-worker/vps.py --slot 1` in a second VPS terminal. Keep each slot ID unique on this deployment. Each account can use one slot at a time. When all slots are occupied, another customer sees a capacity message. Additional slots consume CPU, RAM and disk on the same VPS.

Plans enforce CPU and memory in Docker. Files uploaded in the dashboard are a read-only project snapshot. Programs write persistent files under `/data` (also available as `MZHOST_DATA`). A plan-sized ext4 image reserves space per account with an isolated directory for each project. Deleting a workspace entry retains its disk data. Back up the VPS data separately. Moving to a smaller disk plan after using a larger disk needs a storage migration. The MongoDB workspace upload limit is 3 MB.

The storage check requires Linux loop mounts and e2fsprogs on the VPS. A successful original Docker check did not test those features. Run the updated installer before enabling sales. If the provider blocks loop mounts in LXC, use a quota-capable worker host. Keep the shared mail service isolated.

The worker currently disables container networking. Public bot connections, dependency installation and internet-facing services still require an isolated egress design. A foreground worker exits when its terminal closes. Configure process supervision for ongoing hosting.
