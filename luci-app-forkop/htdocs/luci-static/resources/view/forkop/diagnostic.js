"use strict";
"require baseclass";
"require form";
"require ui";
"require uci";
"require fs";
"require view.forkop.main as main";

function createDiagnosticContent(section) {
  const o = section.option(form.DummyValue, "_mount_node");
  o.rawhtml = true;
  o.cfgvalue = () =>
    main.mountTab("diagnostic", main.DiagnosticTab.render, main.DiagnosticTab.initController);
}

const EntryPoint = {
  createDiagnosticContent,
};

return baseclass.extend(EntryPoint);
