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

function showReviews(reviews) {
  const list = document.getElementById("featured-reviews");
  const caption = document.getElementById("review-caption");
  const featured = reviews.filter(review =>
    review && [4, 5].includes(review.stars) && typeof review.text === "string" && review.text.trim()
  ).slice(0, 6);
  list.replaceChildren();

  for (const review of featured) {
    const figure = document.createElement("figure");
    const score = document.createElement("span");
    const quote = document.createElement("blockquote");
    const name = document.createElement("figcaption");
    score.textContent = review.stars + " / 5";
    quote.textContent = review.text.trim();
    const author = document.createElement("span");
    author.textContent = review.name || "Discord member";
    const avatar = document.createElement("img");
    const fallback = "./images/community-avatar.png";
    avatar.alt = ""; avatar.width = 36; avatar.height = 36;
    avatar.src = review.avatar?.startsWith("https://cdn.discordapp.com/avatars/") ? review.avatar : fallback;
    avatar.addEventListener("error", () => { avatar.src = fallback; }, {once:true});
    name.append(avatar,author);
    figure.append(score, quote, name);
    if (review.image?.startsWith("https://cdn.discordapp.com/attachments/1574753304016068759/")) {
      const image = document.createElement("img");
      image.className = "review-photo"; image.src = review.image; image.loading = "lazy"; image.alt = "Image shared with this review";
      image.addEventListener("error", () => image.remove(), {once:true});
      quote.after(image);
    }
    list.append(figure);
  }
  caption.textContent = featured.length ? "Selected 4- and 5-star reviews from our Discord community." : "No featured Discord reviews yet.";
  list.hidden = !featured.length;
}

async function loadFeaturedReviews() {
  const response = await fetch("/api/reviews");
  if (!response.ok) return;
  const data = await response.json();
  if (Array.isArray(data.reviews)) showReviews(data.reviews);
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

// Published feedback supplied by MzHost for offline previews and Discord outages.
showReviews([
  {name:"MSK",stars:5,text:"very good website"},
  {name:"KenzDC",stars:5,text:"ngl thats the best hostin i ever seen in my fkn life"},
  {name:"MSK",stars:5,text:"W support"}
]);
if (location.protocol !== "file:") {
  loadFeaturedReviews().catch(() => {});
  window.addEventListener("pageshow", () => updateAccountLinks().catch(() => {}));
}
