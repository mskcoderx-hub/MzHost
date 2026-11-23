"use strict";
const byId=id=>document.getElementById(id);
let token=location.hash.slice(1);
if(token) history.replaceState(null,"",location.pathname);
const form=byId("verify-form");
if(/^[a-f0-9]{64}$/.test(token)) form.hidden=false;
else byId("intro").textContent="Open the link in your verification email, or request a fresh one.";
form.addEventListener("submit",async event=>{
  event.preventDefault();
  const password=byId("new-password").value;
  if(password!==byId("repeat-password").value) {byId("message").textContent="Enter the same password in both fields.";return;}
  const button=byId("confirm");
  if(button.disabled) return;
  button.disabled=true;
  try {
    const response=await fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password})});
    const result=await response.json();
    if(!response.ok) throw Error(result.message || "Verification is unavailable. Try again.");
    token="";form.reset();form.hidden=true;
    byId("heading").firstChild.nodeValue="Email verified";
    byId("intro").textContent="Your password is saved. Log in to open your workspace.";
    byId("message").textContent="";
    const next=byId("next");next.href="./account#login";next.textContent="Log in";next.className="button primary submit";next.focus();
  } catch(error) {byId("message").textContent=error.message;}
  finally {button.disabled=false;}
});
