// Keep the downloaded HTML preview navigable when it is opened without a server.
if(location.protocol==="file:") {
  for(const a of document.querySelectorAll("a[href]")) {
    const href=a.getAttribute("href");
    if(href==="./") a.href="./index.html";
    else a.setAttribute("href",href.replace(/^\.\/(account|dashboard)(?=$|[?#])/,"./$1.html"));
  }
}
