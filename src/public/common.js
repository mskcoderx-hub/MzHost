"use strict";
(() => {
  const key="mzhost-cookie-notice-v1";
  try {if(localStorage.getItem(key)==="accepted") return;} catch {}
  const panel=document.createElement("aside");
  panel.className="cookie-notice";
  panel.setAttribute("aria-label","Cookie notice");
  const title=document.createElement("strong"),copy=document.createElement("p"),accept=document.createElement("button");
  title.textContent="Cookies on MzHost";
  copy.textContent="We use essential cookies to keep you signed in and protect your account. This browser remembers your choice.";
  accept.type="button";accept.textContent="Accept";
  accept.addEventListener("click",()=>{
    try {localStorage.setItem(key,"accepted");} catch {}
    panel.remove();
  });
  panel.append(title,copy,accept);document.body.append(panel);
})();
