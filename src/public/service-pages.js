"use strict";

(() => {
  const page = document.body.dataset.service;
  const byId = id => document.getElementById(id);
  const note = value => { byId("message").textContent = value; };
  const currency = new Intl.NumberFormat(undefined, {style:"currency", currency:"USD"});
  const date = value => {
    if (!value) return "Unavailable";
    const stamp = new Date(value);
    return Number.isNaN(stamp.getTime()) ? "Unavailable" : stamp.toLocaleString();
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  async function request(data) {
    const options = {cache:"no-store", credentials:"same-origin"};
    if (data) Object.assign(options, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
    });
    const response = await fetch("/api/" + page, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || "The service is unavailable. Please try again.");
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function showOrders(orders) {
    const holder = byId("orders");
    holder.replaceChildren();
    if (!orders?.length) { holder.append(element("p","No orders yet.","muted")); return; }
    const wrapper = element("div", undefined, "table-wrap");
    const table = element("table", undefined, "order-table");
    table.setAttribute("aria-labelledby", "orders-title");
    const tr = table.createTHead().insertRow();
    for (const title of ["Date","Plan","Amount","Status"]) {
      const header = element("th",title);
      header.scope = "col";
      tr.append(header);
    }
    const body = table.createTBody();
    for (const order of orders) {
      const row = body.insertRow();
      const amount = order.amount != null && Number.isFinite(Number(order.amount)) ? currency.format(order.amount) : "Unavailable";
      for (const value of [date(order.created),order.plan,amount,order.status]) row.insertCell().textContent = value;
    }
    wrapper.append(table);
    holder.append(wrapper);
  }

  async function billingPage() {
    const dialog = byId("ad-dialog");
    byId("preview-boost").addEventListener("click", () => dialog.showModal());
    const initial = new URLSearchParams(location.search).get("plan");
    const login = () => {
      const next = new URL("/billing",location.origin);
      if (["Free","Starter","Standard","Plus"].includes(initial)) next.searchParams.set("plan",initial);
      location.replace("/account?next=" + encodeURIComponent(next.pathname + next.search) + "#login");
    };
    let submitting = false;
    async function load() {
      const result = await request();
      byId("billing-data").hidden = false;
      byId("current-plan").textContent = result.plan || "Choose a plan";
      byId("plan-valid").textContent = result.expires ? "Active until " + date(result.expires) :
        result.plan === "Free" ? "Free hosting · No renewal" : result.email;
      byId("boost").hidden = result.plan !== "Free";
      byId("plans").replaceChildren();
      const plans = Object.entries(result.plans || {});
      for (const [name,plan] of plans) {
        const card = element("article",undefined,"plan-choice");
        card.classList.toggle("selected-plan",name === initial || (!initial && name === result.plan));
        card.append(element("h3",name),element("p",currency.format(plan.price), "plan-price"));
        const list = element("ul");
        const memory = plan.memory >= 1024 && plan.memory % 1024 === 0 ? plan.memory / 1024 + " GB" : plan.memory + " MB";
        for (const detail of [memory+" RAM",plan.disk+" GB disk",Math.round(plan.cpu*100)+"% CPU"]) list.append(element("li",detail));
        const current = name === result.plan;
        const button = element("button", current ? (name==="Free"?"Current plan":"Renew for 30 days") : name === "Free" ? "Choose Free" : "Pay " + currency.format(plan.price), name === initial ? "bright" : "");
        button.type = "button";
        button.disabled = (current && name==="Free") || (result.plan && result.plan!=="Free" && !current) || (name !== "Free" && !result.paymentsReady);
        button.addEventListener("click",async () => {
          if (submitting) return;
          submitting = true;
          button.disabled = true;
          note(name === "Free" ? "Activating Free hosting…" : "Opening checkout…");
          try {
            const checkout = await request({plan:name});
            if (checkout.url) {
              const url = new URL(checkout.url);
              if (url.protocol !== "https:" || !/(^|\.)nowpayments\.io$/i.test(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) throw Error("The payment provider returned an invalid checkout address.");
              location.assign(url.href);
              return;
            }
            if (!checkout.ok) throw Error("The plan could not be activated.");
            await load();
            note(name+" plan activated.");
          } catch (error) {
            if (error.status === 401) { login();return; }
            note(error.message);
            button.disabled=false;
          } finally { submitting=false; }
        });
        card.append(list,button);
        byId("plans").append(card);
      }
      byId("checkout-note").textContent = result.paymentsReady ? (result.sandbox?"Sandbox checkout records test payments. Live hosting credit requires a real payment.":"NOWPayments confirms your crypto payment before your paid plan activates.") : "Paid checkout is currently unavailable.";
      showOrders(result.orders);
      note("");
    }
    try { await load(); } catch(error) { if(error.status===401) login(); else note(error.message); }
  }

  async function statusPage() {
    const keys=["website","database","worker"];
    const refresh=byId("refresh");
    async function load() {
      if(refresh.disabled) return;
      refresh.disabled=true;
      try {
        const data=await request();
        for(const key of keys) {
          const state=["online","offline"].includes(data[key])?data[key]:"unknown";
          const node=byId(key);
          node.dataset.state=state;
          node.textContent=state.charAt(0).toUpperCase()+state.slice(1);
        }
        byId("summary").textContent=keys.every(key=>data[key]==="online")?"All systems operational":
          keys.some(key=>data[key]==="offline")?"Service disruption":"Status partially available";
        byId("updated").textContent=data.updatedAt?"Last checked "+date(data.updatedAt):"";
        note("");
      } catch {
        byId("summary").textContent="Status unavailable";
        for(const key of keys) { byId(key).textContent="Unknown";delete byId(key).dataset.state; }
        byId("updated").textContent="";
        note("The status service could not be reached. Refresh to check again.");
      } finally {refresh.disabled=false;}
    }
    refresh.addEventListener("click",load);
    await load();
    setInterval(()=>{if(!document.hidden) load();},60000);
  }

  async function adminPage() {
    const form=byId("admin-login"),refresh=byId("refresh"),sync=byId("sync-status"),signOut=byId("sign-out");
    let busy=false;
    function loginView() {
      form.hidden=false;
      byId("admin-data").hidden=true;
      signOut.hidden=true;
      byId("orders").replaceChildren();
      for(const key of ["accounts","activePlans","workers"]) byId(key).textContent="";
    }
    async function load() {
      const report=await request();
      form.hidden=true;signOut.hidden=false;byId("admin-data").hidden=false;
      for(const key of ["accounts","activePlans","workers"]) byId(key).textContent=Number.isFinite(report[key])?String(report[key]):"Unavailable";
      showOrders(report.orders);
      note("");
    }
    function bind(button, handler) {
      return async event => {
        event.preventDefault();
        if(busy) return;
        busy=true;button.disabled=true;
        try {await handler();}
        catch(error) {if(error.status===401) loginView();note(error.message);}
        finally {busy=false;button.disabled=false;}
      };
    }
    form.addEventListener("submit",bind(form.querySelector("button"),async()=>{
      const data=new FormData(form);
      try { await request({username:data.get("username"),password:data.get("password")}); }
      finally {form.elements.password.value="";}
      await load();
    }));
    signOut.addEventListener("click",bind(signOut,async()=>{await request({action:"logout"});loginView();note("Logged out.");}));
    refresh.addEventListener("click",bind(refresh,load));
    sync.addEventListener("click",bind(sync,async()=>{await request({action:"sync-status"});note("Discord status updated.");}));
    try {await load();} catch(error) {
      if(error.status===401){loginView();note("");}else note(error.message);
    }
  }
  const pages={admin:adminPage,billing:billingPage,status:statusPage};
  if(pages[page]) pages[page]().catch(error=>note(error.message));
})();
