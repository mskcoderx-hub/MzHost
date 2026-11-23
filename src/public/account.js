const el = id => document.getElementById(id);
const offline = location.protocol === "file:";
let email = "";
let busy = false;
let checking = !offline;

function render() {
  const registering = location.hash === "#register";
  const title = email ? "Your account" : registering ? "Create account" : "Log in";
  document.title = title + " | MzHost";
  el("account-title").firstChild.nodeValue = title;
  el("signed-in").hidden = !email;
  el("signed-out").hidden = Boolean(email);
  el("identity").textContent = email;
  el("email").type = registering ? "email" : "text";
  el("identity-label").textContent = registering ? "Email address" : "Email or username";
  el("switch-label").textContent = registering ? "Already have an account?" : "New to MzHost?";
  el("switch-link").href = registering ? "#login" : "#register";
  el("switch-link").textContent = registering ? "Log in" : "Create an account";
  el("confirm-group").hidden = !registering;
  el("confirmation").required = registering;
  el("password").autocomplete = registering ? "new-password" : "current-password";
  el("password").minLength = registering ? 12 : 1;
  el("submit").textContent = title;
  el("submit").disabled = offline || busy || checking;
  el("offline").hidden = !offline;
  el("server-link").hash = registering ? "register" : "login";
}

async function api(action, data) {
  const options = data ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)} : {};
  const response = await fetch("/api/" + action, options);
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Restart the MzHost preview server to use local accounts.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Please try again.");
  return result;
}

function resetPasswords() {
  el("password").value = "";
  el("confirmation").value = "";
  el("password").type = el("confirmation").type = "password";
  el("reveal").textContent = "Show";
  el("reveal").setAttribute("aria-label", "Show password");
  el("confirmation").setCustomValidity("");
}

window.addEventListener("hashchange", () => {
  resetPasswords();
  el("message").textContent = "";
  render();
});
el("reveal").addEventListener("click", () => {
  const show = el("password").type === "password";
  el("password").type = el("confirmation").type = show ? "text" : "password";
  el("reveal").textContent = show ? "Hide" : "Show";
  el("reveal").setAttribute("aria-label", show ? "Hide password" : "Show password");
});
el("account-form").addEventListener("input", () => el("confirmation").setCustomValidity(""));
el("account-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || offline || checking) return;
  const registering = location.hash === "#register";
  if (registering && el("confirmation").value !== el("password").value) {
    el("confirmation").setCustomValidity("Enter the same password in both fields.");
    el("confirmation").reportValidity();
    return;
  }
  busy = true;
  render();
  el("message").textContent = registering ? "Creating your account…" : "Logging in…";
  try {
    const result = await api(registering ? "register" : "login", {email: el("email").value, password: el("password").value});
    email = result.email;
    resetPasswords();
    el("message").textContent = registering ? "Your account is ready." : "";
    location.assign("./dashboard.html");
  } catch (error) {
    el("message").textContent = error.message;
  } finally {
    busy = false;
    render();
  }
});
el("logout").addEventListener("click", async () => {
  el("logout").disabled = true;
  try {
    await api("logout", {});
    email = "";
    location.hash = "login";
    el("message").textContent = "";
    render();
  } catch (error) {
    el("message").textContent = error.message;
  } finally {
    el("logout").disabled = false;
  }
});
render();
if (!offline) {
  api("session").then(result => { email = result.email || ""; })
    .catch(error => { el("message").textContent = error.message; })
    .finally(() => { checking = false; render(); });
}
