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
  const featured = reviews.filter(review =>
    review && [4, 5].includes(review.stars) && typeof review.text === "string" && review.text.trim()
  ).slice(0, 6);
  list.replaceChildren();

  for (const review of featured) {
    const figure = document.createElement("figure");
    const score = document.createElement("span");
    const quote = document.createElement("blockquote");
    const name = document.createElement("figcaption");
    score.className = "review-score";
    score.setAttribute("role","img");
    score.setAttribute("aria-label",review.stars+" out of 5 stars");
    for(let i=0;i<5;i++) {
      const star=document.createElement("i");
      if(i<review.stars) star.className="filled";
      score.append(star);
    }
    quote.textContent = review.text.trim();
    const author = document.createElement("span");
    author.textContent = review.name || "Discord member";
    const portrait = document.createElement("span");
    portrait.className="review-portrait";
    portrait.setAttribute("aria-hidden","true");
    portrait.textContent = Array.from(author.textContent.trim())[0]?.toUpperCase() || "M";
    if (/^https:\/\/cdn\.discordapp\.com\/(?:embed\/)?avatars\//.test(review.avatar || "")) {
      const avatar = document.createElement("img");
      avatar.alt = ""; avatar.width = 36; avatar.height = 36;
      avatar.addEventListener("error", () => avatar.remove(), {once:true});
      avatar.src = review.avatar;
      portrait.append(avatar);
    }
    name.append(portrait,author);
    figure.append(score, quote, name);
    if (review.image?.startsWith("https://cdn.discordapp.com/attachments/1574753304016068759/")) {
      const image = document.createElement("img");
      image.className = "review-photo"; image.src = review.image; image.loading = "lazy"; image.alt = "Image shared with this review";
      image.addEventListener("error", () => image.remove(), {once:true});
      quote.after(image);
    }
    list.append(figure);
  }
  list.hidden = !featured.length;
  document.getElementById("feedback").hidden=!featured.length;
  refreshReviewMotion();
}

const reviewRail=document.getElementById("featured-reviews");
const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
let touching=false, hovered=false, inView=false, frame=0, direction=1;
function refreshReviewMotion() {
  cancelAnimationFrame(frame);
  const overflow=reviewRail.scrollWidth-reviewRail.clientWidth;
  if(overflow<2 || reducedMotion.matches || touching || hovered || !inView || document.hidden || reviewRail.matches(":focus-within")) return;
  let position=reviewRail.scrollLeft, last=0, restUntil=0;
  function move(now) {
    const elapsed=last?Math.min(now-last,60):0;
    last=now;
    if(now>=restUntil) {
      position+=direction*elapsed*.029;
      if(position>=overflow || position<0) {
        position=Math.max(0,Math.min(position,overflow));
        direction=position===0?1:-1;
        restUntil=now+900;
      }
      reviewRail.scrollLeft=position;
    }
    frame=requestAnimationFrame(move);
  }
  frame=requestAnimationFrame(move);
}
reviewRail.addEventListener("pointerenter",e=>{if(e.pointerType==="mouse"){hovered=true;refreshReviewMotion();}});
reviewRail.addEventListener("pointerleave",()=>{hovered=false;refreshReviewMotion();});
reviewRail.addEventListener("touchstart",()=>{touching=true;refreshReviewMotion();},{passive:true});
for(const event of ["touchend","touchcancel"]) reviewRail.addEventListener(event,e=>{touching=e.touches.length>0;refreshReviewMotion();},{passive:true});
for(const event of ["focusin","focusout"]) reviewRail.addEventListener(event,()=>requestAnimationFrame(refreshReviewMotion));
reducedMotion.addEventListener("change",refreshReviewMotion);
document.addEventListener("visibilitychange",refreshReviewMotion);
new ResizeObserver(refreshReviewMotion).observe(reviewRail);
new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;refreshReviewMotion();}).observe(reviewRail);

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
