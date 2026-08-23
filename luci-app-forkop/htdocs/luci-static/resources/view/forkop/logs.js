"use strict";
"require baseclass";
"require form";
"require view.forkop.main as main";

function createLogsContent(section) {
  const o = section.option(form.DummyValue, "_mount_node");
  o.rawhtml = true;
  o.cfgvalue = () =>
    main.mountTab("logs", main.LogsTab.render, main.LogsTab.initController);
}

const EntryPoint = {
  createLogsContent,
};

return baseclass.extend(EntryPoint);
