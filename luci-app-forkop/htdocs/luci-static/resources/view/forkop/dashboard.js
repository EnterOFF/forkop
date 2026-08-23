"use strict";
"require baseclass";
"require form";
"require ui";
"require uci";
"require fs";
"require view.forkop.main as main";

function createDashboardContent(section) {
  const o = section.option(form.DummyValue, "_mount_node");
  o.rawhtml = true;
  o.cfgvalue = () =>
    main.mountTab("dashboard", main.DashboardTab.render, main.DashboardTab.initController);
}

const EntryPoint = {
  createDashboardContent,
};

return baseclass.extend(EntryPoint);
