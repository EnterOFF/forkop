"use strict";
"require baseclass";
"require form";
"require view.forkop.main as main";

function createLogsContent(section) {
  const o = section.option(form.DummyValue, "_mount_node");
  o.rawhtml = true;
  o.cfgvalue = () => {
    main.LogsTab.initController();
    return main.LogsTab.render();
  };
}

const EntryPoint = {
  createLogsContent,
};

return baseclass.extend(EntryPoint);
