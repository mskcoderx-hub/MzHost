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
