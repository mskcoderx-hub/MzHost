"""MzHost private Docker trial. Run on Linux with Python 3 and the Docker CLI."""
import argparse
import base64
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

NAME = "mzhost-private-runtime-test"
LABEL = "com.mzhost.private-runtime=v1"
IMAGES = {"python:3.12-alpine", "python:3.13-alpine", "node:22-alpine", "node:24-alpine"}
project_folder = None


def docker(*args, timeout=30):
    result = subprocess.run(["docker", *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stdout.strip()[-2000:] or "Docker command failed")
    return result.stdout


def owned():
    names = docker("ps", "-a", "--filter", "name=^/" + NAME + "$", "--format", "{{.Names}}").splitlines()
    if NAME not in names:
        return False
    owner = docker("inspect", "-f", '{{index .Config.Labels "com.mzhost.private-runtime"}}', NAME).strip()
    if owner != "v1":
        raise RuntimeError("The test container name is already in use by another service.")
    return True


def remove():
    global project_folder
    if owned():
        docker("rm", "-f", NAME)
    if project_folder is not None:
        project_folder.cleanup()
        project_folder = None


def launch(project):
    global project_folder
    image, entry, files = project["image"], project["entry"], project["files"]
    if image not in IMAGES or not isinstance(files, list) or not 1 <= len(files) <= 80:
        raise ValueError("Unsupported image or file count")
    python = image.startswith("python:")
    if not entry.endswith((".py",) if python else (".js", ".mjs", ".cjs")):
        raise ValueError("Unsupported entry file")
    remove()
    project_folder = tempfile.TemporaryDirectory(prefix="mzhost-project-")
    folder = project_folder.name
    try:
        for item in files:
            parts = item["path"].split("/")
            if any(p in {".", ".."} or not re.fullmatch(r"[\w. -]{1,80}", p, re.ASCII) for p in parts):
                raise ValueError("Invalid project path")
            dest = Path(folder).joinpath(*parts)
            data = base64.b64decode(item["data"], validate=True) if "data" in item else item["text"].encode()
            if len(data) > 262144:
                raise ValueError("File exceeds the trial limit")
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("xb") as handle:
                handle.write(data)
            dest.chmod(0o444)
        if entry not in {item["path"] for item in files}:
            raise ValueError("Missing startup file")
        os.chmod(folder, 0o755)
        for directory, _, _ in os.walk(folder):
            os.chmod(directory, 0o755)
        command = ["python", "-u", "./" + entry] if python else ["node", "--", "./" + entry]
        docker("create", "--name", NAME, "--label", LABEL, "--network", "none", "--read-only",
               "--user", "65534:65534", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--pids-limit", "64", "--memory", "128m", "--memory-swap", "128m", "--cpus", "0.25",
               "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--log-driver", "json-file",
               "--log-opt", "max-size=64k", "--log-opt", "max-file=1", "--workdir", "/opt/project",
               "--mount", "type=bind,src=" + folder + ",dst=/opt/project,readonly", image, *command, timeout=180)
        docker("start", NAME)
    except BaseException:
        remove()
        raise


def inspect_run():
    info = json.loads(docker("inspect", "-f", "{{json .State}}", NAME))
    logs = docker("logs", "--tail", "80", NAME)[-12000:]
    if info["Running"]:
        return "running", logs
    return "exited", (logs + "\nExit code " + str(info["ExitCode"]))[-16000:]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def serve(origin, key):
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Use the HTTPS site origin, such as https://mzhost.vercel.app")
    if len(key) < 32:
        raise ValueError("VPS_WORKER_KEY must contain at least 32 characters")
    client = urllib.request.build_opener(NoRedirect())
    generation, state, logs = None, "idle", ""
    last_contact = time.monotonic()
    remove()
    print("Waiting for a project from the MzHost console. Ctrl+C ends the test.", flush=True)
    try:
        while True:
            if state == "running":
                state, logs = inspect_run()
            body = json.dumps(dict(generation=generation, state=state, logs=logs), ensure_ascii=False).encode()
            req = urllib.request.Request(origin.rstrip("/") + "/api/runtime", data=body,
                                         headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
            try:
                with client.open(req, timeout=15) as response:
                    job = json.loads(response.read(4 * 1024 * 1024))
                last_contact = time.monotonic()
            except (OSError, ValueError) as exc:
                print("Worker request failed:", getattr(exc, "code", type(exc).__name__), flush=True)
                if getattr(exc, "code", None) in (401, 403, 404) or time.monotonic()-last_contact > 90:
                    raise RuntimeError("Check the site deployment, worker key and network connection.") from None
                time.sleep(5)
                continue
            if job["generation"] != generation:
                generation = job["generation"]
                try:
                    if job["desired"] == "run":
                        launch(job["project"])
                        state, logs = inspect_run()
                    else:
                        remove()
                        state, logs = "stopped", logs
                except (ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                    state, logs = "failed", str(exc)[-2000:]
                    remove()
                print("VPS test:", state, flush=True)
            time.sleep(4)
    finally:
        remove()


def smoke():
    for image, entry, source, marker in [
        ("python:3.13-alpine", "main.py", 'print("MzHost Python OK")', "MzHost Python OK"),
        ("node:24-alpine", "index.js", 'console.log("MzHost Node OK")', "MzHost Node OK"),
    ]:
        try:
            launch(dict(image=image, entry=entry, files=[dict(path=entry, text=source)]))
            code = docker("wait", NAME).strip()
            output = docker("logs", NAME).strip()
            if code != "0" or marker not in output:
                raise RuntimeError("Smoke test failed: " + output)
            print(output, flush=True)
        finally:
            remove()


def shutdown(*_):
    raise KeyboardInterrupt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--origin", default="https://mzhost.vercel.app")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, shutdown)
    lock_path = Path.home() / ".mzhost-private-worker.lock"
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another MzHost worker is already running.")
        try:
            if args.smoke:
                smoke()
            else:
                serve(args.origin, os.environ.get("VPS_WORKER_KEY") or getpass.getpass("VPS worker key: "))
        except KeyboardInterrupt:
            print("Worker stopped.")
