"use strict";
"require view";
"require view.forkop.main as main";

// The Forkop page. Everything it is made of - the tabs, the dialogs, the checks
// and the styles - is built in fe-app-forkop and shipped as main.js beside this
// file; this is the entry LuCI dispatches to, and all it does is hand the page
// over.
return view.extend(main.ForkopView);
