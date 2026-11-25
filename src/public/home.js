const projects = {
  relay: {
    name: "relay-bot", runtime: "Python", memory: "84", cpu: "2.4", file: "main.py",
    logs: "09:41:00  Starting Python runtime\n09:41:01  Loaded main.py\n09:41:02  Relay connected. Listening for events."
  },
  dispatch: {
    name: "dispatch-bot", runtime: "Node.js", memory: "112", cpu: "1.8", file: "index.js",
    logs: "09:42:00  Starting Node.js runtime\n09:42:01  Loaded index.js\n09:42:02  Dispatch ready. Waiting for jobs."
  }
};

function selectProject(key) {
  const project = projects[key];
  document.getElementById("workspace-title").textContent = project.name;
  document.getElementById("runtime").textContent = project.runtime;
  document.getElementById("memory").textContent = project.memory;
  document.getElementById("cpu").textContent = project.cpu;
  document.getElementById("entrypoint").textContent = project.file;
  document.getElementById("logs").textContent = project.logs;
  document.querySelectorAll("[data-project]").forEach(button => {
    const selected = button.dataset.project === key;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelectorAll("[data-project]").forEach(button => {
  button.addEventListener("click", () => selectProject(button.dataset.project));
});

document.querySelectorAll("[data-open]").forEach(button => {
  button.addEventListener("click", () => {
    selectProject(button.dataset.open);
    document.getElementById("workspace").scrollIntoView();
    document.querySelector(".project.selected").focus({ preventScroll: true });
  });
});

async function loadFeaturedReviews() {
  const response = await fetch("/api/reviews");
  if (!response.ok) throw Error("Reviews unavailable");
  const data = await response.json();
  const list = document.getElementById("featured-reviews");
  const caption = document.getElementById("review-caption");
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  const featured = reviews.filter(review =>
    review && [4, 5].includes(review.stars) && typeof review.text === "string" && review.text.trim()
  ).slice(0, 6);
  if (!featured.length) return;

  for (const review of featured) {
    const figure = document.createElement("figure");
    const score = document.createElement("span");
    const quote = document.createElement("blockquote");
    const name = document.createElement("figcaption");
    score.textContent = review.stars + " / 5";
    quote.textContent = review.text.trim();
    name.textContent = typeof review.name === "string" && review.name.trim() ? review.name : "Discord member";
    figure.append(score, quote, name);
    list.append(figure);
  }
  caption.textContent = "Selected 4- and 5-star reviews from our Discord community.";
  list.hidden = false;
}

async function updateAccountLinks() {
  const response = await fetch("/api/session", {cache: "no-store"});
  if (!response.ok) return;
  const session = await response.json();
  const links = document.querySelector(".account-links");
  const login = links.querySelector(".text-link");
  const primary = links.querySelector(".nav-button");
  login.hidden = Boolean(session.email);
  primary.href = session.email ? "./dashboard" : "./account#register";
  primary.textContent = session.email ? "Dashboard" : "Create account";
}

if (location.protocol !== "file:") {
  loadFeaturedReviews().catch(() => {
    document.getElementById("review-caption").textContent = "Discord reviews are temporarily unavailable.";
  });
  window.addEventListener("pageshow", () => updateAccountLinks().catch(() => {}));
}
