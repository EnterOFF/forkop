"use strict";
"require baseclass";
"require form";
"require view.forkop.local_devices as localDevices";
"require view.forkop.main as main";

function createMonitoringContent(section) {
  const o = section.option(form.DummyValue, "_mount_node");
  o.rawhtml = true;
  o.cfgvalue = () =>
    main.mountTab("monitoring", main.MonitoringTab.render, () =>
      main.MonitoringTab.initController({
        loadLocalDeviceChoices: localDevices.loadLocalDeviceChoices,
      }),
    );
}

const EntryPoint = {
  createMonitoringContent,
};

return baseclass.extend(EntryPoint);
