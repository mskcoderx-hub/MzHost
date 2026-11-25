"use strict";
const HostingPlans=Object.freeze({
  Free:{memory:150,disk:1,cpu:0.4,price:0},
  Starter:{memory:1024,disk:2,cpu:0.5,price:1.5},
  Standard:{memory:2048,disk:4,cpu:1,price:2.75},
  Plus:{memory:4096,disk:8,cpu:1.5,price:5}
});
if(typeof module!=="undefined") module.exports=HostingPlans;
