"use strict";
"require baseclass";
"require view.forkop.annotations as annotate";

// What Forkop knows about the three DPI engines it drives: which options each
// one takes, which of them Forkop refuses because it owns that decision itself,
// and how to turn a strategy string into per-token annotations while it is
// typed.
//
// providers/nfqueue/validator.uc and providers/byedpi/validator.uc hold the
// same knowledge and have the final word when the value is saved. The editor
// needs it synchronously to annotate as the user types, so the tables are
// repeated here and tests/dpi_option_tables.sh keeps the two copies equal.

const ZAPRET_LEGACY_DEFAULT_NFQWS_OPT =
  "--filter-tcp=80 <HOSTLIST> --dpi-desync=fake,fakedsplit --dpi-desync-autottl=2 --dpi-desync-fooling=badsum --new --filter-tcp=443 --hostlist=/opt/zapret/ipset/zapret-hosts-google.txt --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badsum --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --new --filter-udp=443 --hostlist=/opt/zapret/ipset/zapret-hosts-google.txt --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic=/opt/zapret/files/fake/quic_initial_www_google_com.bin --new --filter-udp=443 <HOSTLIST_NOAUTO> --dpi-desync=fake --dpi-desync-repeats=11 --new --filter-tcp=443 <HOSTLIST> --dpi-desync=multidisorder --dpi-desync-split-pos=1,sniext+1,host+1,midsld-2,midsld,midsld+2,endhost-1";

const ZAPRET_DEFAULT_NFQWS_OPT =
  "--filter-tcp=80 --dpi-desync=fake,fakedsplit --dpi-desync-autottl=2 --dpi-desync-fooling=badsum --new --filter-tcp=443 --dpi-desync=fake,multidisorder --dpi-desync-split-pos=1,midsld --dpi-desync-repeats=11 --dpi-desync-fooling=badsum --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com --new --filter-udp=443 --dpi-desync=fake --dpi-desync-repeats=11 --dpi-desync-fake-quic=/opt/zapret/files/fake/quic_initial_www_google_com.bin";

const ZAPRET2_DEFAULT_NFQWS2_OPT =
  "--filter-tcp=80 --filter-l7=http --payload=http_req --lua-desync=fake:blob=fake_default_http:tcp_md5 --lua-desync=multisplit:pos=method+2 --new --filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000 --lua-desync=multidisorder:pos=1,midsld --new --filter-udp=443 --filter-l7=quic --payload=quic_initial --lua-desync=fake:blob=fake_default_quic:repeats=6";

const BYEDPI_DEFAULT_CMD_OPTS = "-o 2 --auto=t,r,a,s -d 2";

const BYEDPI_LONG_VALUE_OPTIONS = new Set([
  "--max-conn",
  "--conn-ip",
  "--buf-size",
  "--debug",
  "--def-ttl",
  "--auto",
  "--auto-mode",
  "--cache-ttl",
  "--cache-dump",
  "--timeout",
  "--proto",
  "--hosts",
  "--ipset",
  "--pf",
  "--round",
  "--split",
  "--disorder",
  "--oob",
  "--disoob",
  "--fake",
  "--fake-sni",
  "--ttl",
  "--fake-offset",
  "--fake-data",
  "--fake-tls-mod",
  "--oob-data",
  "--mod-http",
  "--tlsrec",
  "--tlsminor",
  "--udp-fake",
]);

const BYEDPI_LONG_FLAG_OPTIONS = new Set([
  "--md5sig",
  "--tfo",
  "--drop-sack",
  "--no-domain",
  "--no-udp",
]);

const BYEDPI_SHORT_VALUE_OPTIONS = new Set([
  "-c",
  "-I",
  "-b",
  "-x",
  "-g",
  "-A",
  "-L",
  "-u",
  "-y",
  "-T",
  "-K",
  "-H",
  "-j",
  "-V",
  "-R",
  "-s",
  "-d",
  "-o",
  "-q",
  "-f",
  "-n",
  "-t",
  "-O",
  "-l",
  "-Q",
  "-e",
  "-M",
  "-r",
  "-m",
  "-a",
]);

const BYEDPI_SHORT_FLAG_OPTIONS = new Set(["-N", "-U", "-F", "-S", "-Y"]);

const NFQWS_OPTIONAL_ARG_OPTIONS = new Set([
  "--comment",
  "--ctrack-disable",
  "--debug",
  "--dpi-desync-any-protocol",
  "--dpi-desync-autottl",
  "--dpi-desync-autottl6",
  "--dpi-desync-skip-nosni",
  "--dpi-desync-tcp-flags-set",
  "--dpi-desync-tcp-flags-unset",
  "--dup-autottl",
  "--dup-autottl6",
  "--dup-replace",
  "--dup-tcp-flags-set",
  "--dup-tcp-flags-unset",
  "--ipcache-hostname",
  "--orig-autottl",
  "--orig-autottl6",
  "--orig-tcp-flags-set",
  "--orig-tcp-flags-unset",
  "--synack-split",
]);

const NFQWS_NO_ARG_OPTIONS = new Set([
  "--bind-fix4",
  "--bind-fix6",
  "--daemon",
  "--domcase",
  "--dry-run",
  "--hostcase",
  "--hostnospace",
  "--methodeol",
  "--new",
  "--skip",
  "--version",
]);

const NFQWS_REQUIRED_ARG_OPTIONS = new Set([
  "--ctrack-timeouts",
  "--dpi-desync",
  "--dpi-desync-badack-increment",
  "--dpi-desync-badseq-increment",
  "--dpi-desync-cutoff",
  "--dpi-desync-fake-dht",
  "--dpi-desync-fake-discord",
  "--dpi-desync-fake-http",
  "--dpi-desync-fake-quic",
  "--dpi-desync-fake-stun",
  "--dpi-desync-fake-syndata",
  "--dpi-desync-fake-tcp-mod",
  "--dpi-desync-fake-tls",
  "--dpi-desync-fake-tls-mod",
  "--dpi-desync-fake-unknown",
  "--dpi-desync-fake-unknown-udp",
  "--dpi-desync-fake-wireguard",
  "--dpi-desync-fakedsplit-mod",
  "--dpi-desync-fakedsplit-pattern",
  "--dpi-desync-fooling",
  "--dpi-desync-fwmark",
  "--dpi-desync-hostfakesplit-midhost",
  "--dpi-desync-hostfakesplit-mod",
  "--dpi-desync-ipfrag-pos-tcp",
  "--dpi-desync-ipfrag-pos-udp",
  "--dpi-desync-repeats",
  "--dpi-desync-split-http-req",
  "--dpi-desync-split-pos",
  "--dpi-desync-split-seqovl",
  "--dpi-desync-split-seqovl-pattern",
  "--dpi-desync-split-tls",
  "--dpi-desync-start",
  "--dpi-desync-ts-increment",
  "--dpi-desync-ttl",
  "--dpi-desync-ttl6",
  "--dpi-desync-udplen-increment",
  "--dpi-desync-udplen-pattern",
  "--dup",
  "--dup-badack-increment",
  "--dup-badseq-increment",
  "--dup-cutoff",
  "--dup-fooling",
  "--dup-ip-id",
  "--dup-start",
  "--dup-ts-increment",
  "--dup-ttl",
  "--dup-ttl6",
  "--filter-l3",
  "--filter-l7",
  "--filter-tcp",
  "--filter-udp",
  "--hostlist",
  "--hostlist-auto",
  "--hostlist-auto-debug",
  "--hostlist-auto-fail-threshold",
  "--hostlist-auto-fail-time",
  "--hostlist-auto-retrans-threshold",
  "--hostlist-domains",
  "--hostlist-exclude",
  "--hostlist-exclude-domains",
  "--hostspell",
  "--ip-id",
  "--ipcache-lifetime",
  "--ipset",
  "--ipset-exclude",
  "--ipset-exclude-ip",
  "--ipset-ip",
  "--orig-mod-cutoff",
  "--orig-mod-start",
  "--orig-ttl",
  "--orig-ttl6",
  "--pidfile",
  "--qnum",
  "--uid",
  "--user",
  "--wsize",
  "--wssize",
  "--wssize-cutoff",
  "--wssize-forced-cutoff",
]);

const NFQWS2_OPTIONAL_ARG_OPTIONS = new Set([
  "--chdir",
  "--comment",
  "--ctrack-disable",
  "--debug",
  "--hostlist-auto-retrans-reset",
  "--intercept",
  "--ipcache-hostname",
  "--new",
  "--payload-disable",
  "--reasm-disable",
  "--server",
  "--template",
  "--writeable",
]);

const NFQWS2_NO_ARG_OPTIONS = new Set([
  "--bind-fix4",
  "--bind-fix6",
  "--daemon",
  "--dry-run",
  "--skip",
  "--version",
]);

const NFQWS2_REQUIRED_ARG_OPTIONS = new Set([
  "--blob",
  "--cookie",
  "--ctrack-timeouts",
  "--filter-icmp",
  "--filter-ipp",
  "--filter-l3",
  "--filter-l7",
  "--filter-ssid",
  "--filter-tcp",
  "--filter-udp",
  "--fwmark",
  "--fuzz",
  "--hostlist",
  "--hostlist-auto",
  "--hostlist-auto-debug",
  "--hostlist-auto-fail-threshold",
  "--hostlist-auto-fail-time",
  "--hostlist-auto-incoming-maxseq",
  "--hostlist-auto-retrans-maxseq",
  "--hostlist-auto-retrans-threshold",
  "--hostlist-auto-udp-in",
  "--hostlist-auto-udp-out",
  "--hostlist-domains",
  "--hostlist-exclude",
  "--hostlist-exclude-domains",
  "--import",
  "--in-range",
  "--ipcache-lifetime",
  "--ipset",
  "--ipset-exclude",
  "--ipset-exclude-ip",
  "--ipset-ip",
  "--lua-gc",
  "--lua-init",
  "--lua-desync",
  "--name",
  "--out-range",
  "--payload",
  "--pidfile",
  "--qnum",
  "--uid",
  "--user",
]);

function getNfqwsOptionArgumentMode(option) {
  if (NFQWS_REQUIRED_ARG_OPTIONS.has(option)) {
    return "required";
  }

  if (NFQWS_OPTIONAL_ARG_OPTIONS.has(option)) {
    return "optional";
  }

  if (NFQWS_NO_ARG_OPTIONS.has(option)) {
    return "none";
  }

  return "unknown";
}

function getNfqws2OptionArgumentMode(option) {
  if (NFQWS2_REQUIRED_ARG_OPTIONS.has(option)) {
    return "required";
  }

  if (NFQWS2_OPTIONAL_ARG_OPTIONS.has(option)) {
    return "optional";
  }

  if (NFQWS2_NO_ARG_OPTIONS.has(option)) {
    return "none";
  }

  return "unknown";
}

function normalizeNfqwsStrategyWhitespace(value) {
  return value ? `${value}`.replace(/\s+/g, " ").trim() : "";
}

function parseNfqwsRuntimeTokens(value) {
  const text = value ? `${value}` : "";
  const tokens = [];
  const matcher = /\S+/g;
  let match;

  while ((match = matcher.exec(text)) !== null) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

// ciadpi options can take a value that contains spaces, for example the inline
// host list of -H:"a.example b.example". Quotes group one argument and are
// removed before the argument reaches ciadpi, so validation sees the same argv
// that providers/byedpi/validator.uc builds on the router.
function parseByedpiStrategyTokens(value) {
  const text = value ? `${value}` : "";
  const tokens = [];
  let current = "";
  let start = -1;
  let quote = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote) {
      if (character === quote) {
        quote = "";
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      if (start < 0) {
        start = index;
      }
      continue;
    }

    if (/\s/.test(character)) {
      if (start >= 0) {
        tokens.push({ value: current, start, end: index });
      }
      current = "";
      start = -1;
      continue;
    }

    if (start < 0) {
      start = index;
    }
    current += character;
  }

  if (quote) {
    return { tokens: [], unterminatedQuote: quote };
  }

  if (start >= 0) {
    tokens.push({ value: current, start, end: text.length });
  }

  return { tokens, unterminatedQuote: "" };
}

function normalizeNfqwsStrategyValue(value) {
  const normalized = normalizeNfqwsStrategyWhitespace(value);
  if (!normalized.length) {
    return "";
  }

  return normalized === ZAPRET_LEGACY_DEFAULT_NFQWS_OPT
    ? ZAPRET_DEFAULT_NFQWS_OPT
    : normalized;
}

function getNfqwsForbiddenTokenInfo(token, index) {
  const configFileMessage = _(
    "External nfqws config files bypass Forkop queue management and explicit validation.",
  );
  const hostSelectionMessage = _(
    "Resource selection by hostname inside nfqws is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const ipSelectionMessage = _(
    "Resource selection by IP or CIDR inside nfqws is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const placeholderMessage = _(
    "Zapret hostlist templates are not supported here because Forkop does not expand them for per-rule NFQWS strategies.",
  );
  const queueMessage = _(
    "The NFQUEUE number is assigned by Forkop for each rule and must not be overridden here.",
  );
  const fwmarkMessage = _(
    "The desync fwmark is managed by Forkop for loop prevention and must not be overridden here.",
  );
  const daemonMessage = _(
    "Forkop manages the nfqws process lifecycle itself, so daemon mode is not allowed here.",
  );
  const dryRunMessage = _(
    "This field must start a working nfqws strategy; --dry-run exits immediately and is not allowed here.",
  );
  const versionMessage = _(
    "This field must start a working nfqws strategy; --version exits immediately and is not allowed here.",
  );

  if (index === 0 && (token.startsWith("@") || token.startsWith("$"))) {
    return {
      reason: configFileMessage,
      captureNextValue: false,
    };
  }

  if (token === "<HOSTLIST>" || token === "<HOSTLIST_NOAUTO>") {
    return {
      reason: placeholderMessage,
      captureNextValue: false,
    };
  }

  if (
    token === "--hostlist" ||
    token.startsWith("--hostlist=") ||
    token === "--hostlist-domains" ||
    token.startsWith("--hostlist-domains=") ||
    token === "--hostlist-exclude" ||
    token.startsWith("--hostlist-exclude=") ||
    token === "--hostlist-exclude-domains" ||
    token.startsWith("--hostlist-exclude-domains=") ||
    token === "--hostlist-auto" ||
    token.startsWith("--hostlist-auto=") ||
    token === "--hostlist-auto-fail-threshold" ||
    token.startsWith("--hostlist-auto-fail-threshold=") ||
    token === "--hostlist-auto-fail-time" ||
    token.startsWith("--hostlist-auto-fail-time=") ||
    token === "--hostlist-auto-retrans-threshold" ||
    token.startsWith("--hostlist-auto-retrans-threshold=") ||
    token === "--hostlist-auto-debug" ||
    token.startsWith("--hostlist-auto-debug=")
  ) {
    return {
      reason: hostSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--ipset" ||
    token.startsWith("--ipset=") ||
    token === "--ipset-ip" ||
    token.startsWith("--ipset-ip=") ||
    token === "--ipset-exclude" ||
    token.startsWith("--ipset-exclude=") ||
    token === "--ipset-exclude-ip" ||
    token.startsWith("--ipset-exclude-ip=")
  ) {
    return {
      reason: ipSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--qnum" || token.startsWith("--qnum=")) {
    return {
      reason: queueMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--dpi-desync-fwmark" ||
    token.startsWith("--dpi-desync-fwmark=")
  ) {
    return {
      reason: fwmarkMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--daemon") {
    return {
      reason: daemonMessage,
      captureNextValue: false,
    };
  }

  if (token === "--dry-run") {
    return {
      reason: dryRunMessage,
      captureNextValue: false,
    };
  }

  if (token === "--version") {
    return {
      reason: versionMessage,
      captureNextValue: false,
    };
  }

  return null;
}

function buildNfqwsLocalAnalysis(value) {
  const text = value ? `${value}` : "";
  if (!text.trim().length) {
    return {
      valid: false,
      message: _("NFQWS strategy cannot be empty"),
      annotations: [],
    };
  }

  if (text.trim() === ZAPRET_LEGACY_DEFAULT_NFQWS_OPT) {
    return { valid: true, message: "", annotations: [] };
  }

  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();
  const errors = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];
    const bareToken = token.value.includes("=")
      ? token.value.slice(0, token.value.indexOf("="))
      : token.value;
    const nextToken = tokens[index + 1] || null;

    const forbidden = getNfqwsForbiddenTokenInfo(token.value, index);
    if (forbidden) {
      annotate.addAnnotationIssue(annotationMap, token, forbidden.reason);

      let displayToken = token.value;

      if (
        forbidden.captureNextValue &&
        nextToken &&
        !nextToken.value.startsWith("--")
      ) {
        annotate.addAnnotationIssue(annotationMap, nextToken, forbidden.reason);
        displayToken = `${displayToken} ${nextToken.value}`;
        index += 2;
      } else {
        index += 1;
      }

      errors.push(`${displayToken}: ${forbidden.reason}`);
      continue;
    }

    if (!token.value.startsWith("--")) {
      const reason = _(
        "Unexpected standalone token. Use explicit flags such as --name or --name=value.",
      );
      annotate.addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    const mode = getNfqwsOptionArgumentMode(bareToken);
    if (mode === "unknown") {
      const reason = _("Unknown NFQWS flag.");
      annotate.addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    if (mode === "none") {
      if (token.value.includes("=")) {
        const reason = _("This flag does not accept a value.");
        annotate.addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
      }

      index += 1;
      continue;
    }

    if (mode === "optional") {
      if (
        nextToken &&
        !token.value.includes("=") &&
        !nextToken.value.startsWith("--")
      ) {
        const reason = _(
          "Optional values must be attached with '=' here; a separate token would be ignored by nfqws.",
        );
        annotate.addAnnotationIssue(annotationMap, token, reason);
        annotate.addAnnotationIssue(annotationMap, nextToken, reason);
        errors.push(`${token.value} ${nextToken.value}: ${reason}`);
        index += 2;
      } else {
        index += 1;
      }

      continue;
    }

    if (!token.value.includes("=")) {
      if (!nextToken || nextToken.value.startsWith("--")) {
        const reason = _("This option requires a value.");
        annotate.addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
        index += 1;
        continue;
      }

      index += 2;
      continue;
    }

    index += 1;
  }

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [annotate.getValidationHeaderText(), ...errors].join("\n"),
    annotations: annotate.finalizeAnnotations(annotationMap),
  };
}

function addNfqwsRemoteValidationNeedleAnnotations(
  annotationMap,
  tokens,
  remoteValidation,
  needle,
) {
  if (!needle.length) {
    return;
  }

  let matched = false;

  tokens.forEach((token) => {
    const tokenValue = token.value || "";
    const optionMatch =
      needle.startsWith("--") &&
      (tokenValue === needle || tokenValue.startsWith(`${needle}=`));
    const valueMatch =
      tokenValue === needle ||
      tokenValue.endsWith(`=${needle}`) ||
      (!needle.startsWith("--") && tokenValue.includes(`=${needle},`)) ||
      (!needle.startsWith("--") && tokenValue.endsWith(`=${needle}`));

    if (optionMatch || valueMatch) {
      annotate.addAnnotationIssue(annotationMap, token, remoteValidation.message);
      matched = true;
    }
  });

  if (matched) {
    return;
  }

  if (needle.startsWith("--")) {
    tokens
      .filter((token) => token.value && token.value.startsWith(needle))
      .forEach((token) =>
        annotate.addAnnotationIssue(annotationMap, token, remoteValidation.message),
      );
  }
}

function addNfqwsRemoteValidationAnnotations(
  annotationMap,
  tokens,
  remoteValidation,
) {
  const needles =
    remoteValidation &&
    Array.isArray(remoteValidation.needles) &&
    remoteValidation.needles.length
      ? remoteValidation.needles.map((needle) => `${needle}`)
      : remoteValidation && remoteValidation.needle
        ? [`${remoteValidation.needle}`]
        : [];

  needles.forEach((needle) =>
    addNfqwsRemoteValidationNeedleAnnotations(
      annotationMap,
      tokens,
      remoteValidation,
      needle,
    ),
  );
}

function normalizeNfqws2StrategyValue(value) {
  const normalized = normalizeNfqwsStrategyWhitespace(value);
  return normalized.length ? normalized : ZAPRET2_DEFAULT_NFQWS2_OPT;
}

function getNfqws2ForbiddenTokenInfo(token, index, nextToken) {
  const configFileMessage = _(
    "External nfqws2 config files bypass Forkop queue management and explicit validation.",
  );
  const hostSelectionMessage = _(
    "Resource selection by hostname inside nfqws2 is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const ipSelectionMessage = _(
    "Resource selection by IP or CIDR inside nfqws2 is not supported here; sing-box selects resources before NFQUEUE.",
  );
  const placeholderMessage = _(
    "Zapret2 hostlist templates are not supported here because Forkop does not expand them for per-rule NFQWS2 strategies.",
  );
  const queueMessage = _(
    "The NFQUEUE number is assigned by Forkop for each rule and must not be overridden here.",
  );
  const fwmarkMessage = _(
    "The desync fwmark is managed by Forkop for loop prevention and must not be overridden here.",
  );
  const fuzzMessage = _(
    "Fuzzing is not supported here because Forkop needs deterministic runtime validation.",
  );
  const interceptMessage = _(
    "Disabling interception is incompatible with action=zapret2 because Forkop sends matched traffic through NFQUEUE.",
  );
  const daemonMessage = _(
    "Forkop manages the nfqws2 process lifecycle itself, so daemon mode is not allowed here.",
  );
  const dryRunMessage = _(
    "This field must start a working nfqws2 strategy; --dry-run exits immediately and is not allowed here.",
  );
  const versionMessage = _(
    "This field must start a working nfqws2 strategy; --version exits immediately and is not allowed here.",
  );

  if (index === 0 && (token.startsWith("@") || token.startsWith("$"))) {
    return {
      reason: configFileMessage,
      captureNextValue: false,
    };
  }

  if (token === "<HOSTLIST>" || token === "<HOSTLIST_NOAUTO>") {
    return {
      reason: placeholderMessage,
      captureNextValue: false,
    };
  }

  if (
    token === "--hostlist" ||
    token.startsWith("--hostlist=") ||
    token === "--hostlist-domains" ||
    token.startsWith("--hostlist-domains=") ||
    token === "--hostlist-exclude" ||
    token.startsWith("--hostlist-exclude=") ||
    token === "--hostlist-exclude-domains" ||
    token.startsWith("--hostlist-exclude-domains=") ||
    token === "--hostlist-auto" ||
    token.startsWith("--hostlist-auto=") ||
    token === "--hostlist-auto-fail-threshold" ||
    token.startsWith("--hostlist-auto-fail-threshold=") ||
    token === "--hostlist-auto-fail-time" ||
    token.startsWith("--hostlist-auto-fail-time=") ||
    token === "--hostlist-auto-retrans-threshold" ||
    token.startsWith("--hostlist-auto-retrans-threshold=") ||
    token === "--hostlist-auto-debug" ||
    token.startsWith("--hostlist-auto-debug=") ||
    token === "--hostlist-auto-retrans-reset" ||
    token.startsWith("--hostlist-auto-retrans-reset=") ||
    token === "--hostlist-auto-retrans-maxseq" ||
    token.startsWith("--hostlist-auto-retrans-maxseq=") ||
    token === "--hostlist-auto-incoming-maxseq" ||
    token.startsWith("--hostlist-auto-incoming-maxseq=") ||
    token === "--hostlist-auto-udp-in" ||
    token.startsWith("--hostlist-auto-udp-in=") ||
    token === "--hostlist-auto-udp-out" ||
    token.startsWith("--hostlist-auto-udp-out=")
  ) {
    return {
      reason: hostSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--ipset" ||
    token.startsWith("--ipset=") ||
    token === "--ipset-ip" ||
    token.startsWith("--ipset-ip=") ||
    token === "--ipset-exclude" ||
    token.startsWith("--ipset-exclude=") ||
    token === "--ipset-exclude-ip" ||
    token.startsWith("--ipset-exclude-ip=")
  ) {
    return {
      reason: ipSelectionMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--qnum" || token.startsWith("--qnum=")) {
    return {
      reason: queueMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--fwmark" ||
    token.startsWith("--fwmark=") ||
    token === "--dpi-desync-fwmark" ||
    token.startsWith("--dpi-desync-fwmark=")
  ) {
    return {
      reason: fwmarkMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (token === "--fuzz" || token.startsWith("--fuzz=")) {
    return {
      reason: fuzzMessage,
      captureNextValue: !token.includes("="),
    };
  }

  if (
    token === "--intercept=0" ||
    token === "--intercept=false" ||
    token === "--intercept=no" ||
    (token === "--intercept" && nextToken && nextToken.value === "0")
  ) {
    return {
      reason: interceptMessage,
      captureNextValue: token === "--intercept",
    };
  }

  if (token === "--daemon") {
    return {
      reason: daemonMessage,
      captureNextValue: false,
    };
  }

  if (token === "--dry-run") {
    return {
      reason: dryRunMessage,
      captureNextValue: false,
    };
  }

  if (token === "--version") {
    return {
      reason: versionMessage,
      captureNextValue: false,
    };
  }

  return null;
}

function buildNfqws2LocalAnalysis(value) {
  const text = value ? `${value}` : "";
  if (!text.trim().length) {
    return {
      valid: false,
      message: _("NFQWS2 strategy cannot be empty"),
      annotations: [],
    };
  }

  const tokens = parseNfqwsRuntimeTokens(text);
  const annotationMap = new Map();
  const errors = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];
    const bareToken = token.value.includes("=")
      ? token.value.slice(0, token.value.indexOf("="))
      : token.value;
    const nextToken = tokens[index + 1] || null;

    const forbidden = getNfqws2ForbiddenTokenInfo(
      token.value,
      index,
      nextToken,
    );
    if (forbidden) {
      annotate.addAnnotationIssue(annotationMap, token, forbidden.reason);

      let displayToken = token.value;

      if (
        forbidden.captureNextValue &&
        nextToken &&
        !nextToken.value.startsWith("--")
      ) {
        annotate.addAnnotationIssue(annotationMap, nextToken, forbidden.reason);
        displayToken = `${displayToken} ${nextToken.value}`;
        index += 2;
      } else {
        index += 1;
      }

      errors.push(`${displayToken}: ${forbidden.reason}`);
      continue;
    }

    if (!token.value.startsWith("--")) {
      const reason = _(
        "Unexpected standalone token. Use explicit flags such as --name or --name=value.",
      );
      annotate.addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    const mode = getNfqws2OptionArgumentMode(bareToken);
    if (mode === "unknown") {
      const reason = _("Unknown NFQWS2 flag.");
      annotate.addAnnotationIssue(annotationMap, token, reason);
      errors.push(`${token.value}: ${reason}`);
      index += 1;
      continue;
    }

    if (mode === "none") {
      if (token.value.includes("=")) {
        const reason = _("This flag does not accept a value.");
        annotate.addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
      }

      index += 1;
      continue;
    }

    if (mode === "optional") {
      if (
        nextToken &&
        !token.value.includes("=") &&
        !nextToken.value.startsWith("--")
      ) {
        const reason = _(
          "Optional values must be attached with '=' here; a separate token would be ignored by nfqws2.",
        );
        annotate.addAnnotationIssue(annotationMap, token, reason);
        annotate.addAnnotationIssue(annotationMap, nextToken, reason);
        errors.push(`${token.value} ${nextToken.value}: ${reason}`);
        index += 2;
      } else {
        index += 1;
      }

      continue;
    }

    if (!token.value.includes("=")) {
      if (!nextToken || nextToken.value.startsWith("--")) {
        const reason = _("This option requires a value.");
        annotate.addAnnotationIssue(annotationMap, token, reason);
        errors.push(`${token.value}: ${reason}`);
        index += 1;
        continue;
      }

      index += 2;
      continue;
    }

    index += 1;
  }

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [annotate.getValidationHeaderText(), ...errors].join("\n"),
    annotations: annotate.finalizeAnnotations(annotationMap),
  };
}

function normalizeByedpiStrategyWhitespace(value) {
  return value ? `${value}`.replace(/\s+/g, " ").trim() : "";
}

function normalizeByedpiStrategyValue(value) {
  const normalized = normalizeByedpiStrategyWhitespace(value);
  return normalized.length ? normalized : BYEDPI_DEFAULT_CMD_OPTS;
}

function getByedpiShortOptionName(token) {
  return token.length > 2 ? token.slice(0, 2) : token;
}

function byedpiTokenLooksLikeOption(token) {
  return /^--.+/.test(token) || /^-[A-Za-z].*/.test(token);
}

function getByedpiControlledTokenInfo(token) {
  const listenMessage = _(
    "ByeDPI listen address and port are assigned by Forkop and must not be set in the strategy.",
  );
  const transparentMessage = _(
    "Transparent proxy mode is incompatible with action=byedpi because Forkop connects to ciadpi through SOCKS.",
  );
  const daemonMessage = _(
    "Forkop manages the ciadpi process lifecycle itself, so daemon mode is not allowed here.",
  );
  const pidfileMessage = _(
    "Forkop manages ciadpi pid files itself, so pidfile options are not allowed here.",
  );
  const exitMessage = _(
    "This field must start a working ciadpi strategy; help/version options exit immediately and are not allowed here.",
  );

  if (
    token === "--ip" ||
    token.startsWith("--ip=") ||
    token === "-i" ||
    /^-i.+/.test(token) ||
    token === "--port" ||
    token.startsWith("--port=") ||
    token === "-p" ||
    /^-p.+/.test(token)
  ) {
    return {
      reason: listenMessage,
      captureNextValue:
        token === "--ip" ||
        token === "-i" ||
        token === "--port" ||
        token === "-p",
    };
  }

  if (token === "--transparent" || token === "-E" || /^-E.+/.test(token)) {
    return {
      reason: transparentMessage,
      captureNextValue: false,
    };
  }

  if (token === "--daemon" || token === "-D" || /^-D.+/.test(token)) {
    return {
      reason: daemonMessage,
      captureNextValue: false,
    };
  }

  if (
    token === "--pidfile" ||
    token.startsWith("--pidfile=") ||
    token === "-w" ||
    /^-w.+/.test(token)
  ) {
    return {
      reason: pidfileMessage,
      captureNextValue: token === "--pidfile" || token === "-w",
    };
  }

  if (
    token === "--help" ||
    token === "-h" ||
    /^-h.+/.test(token) ||
    token === "--version" ||
    token === "-v" ||
    /^-v.+/.test(token)
  ) {
    return {
      reason: exitMessage,
      captureNextValue: false,
    };
  }

  return null;
}

function validateByedpiStrategyToken(token, nextToken) {
  const controlled = getByedpiControlledTokenInfo(token);
  if (controlled) {
    return {
      valid: false,
      reason: controlled.reason,
      captureNextValue: controlled.captureNextValue,
    };
  }

  if (/^--[^=]+=/.test(token)) {
    const base = token.split("=", 1)[0];
    const value = token.slice(base.length + 1);

    if (BYEDPI_LONG_VALUE_OPTIONS.has(base)) {
      return value.length
        ? { valid: true, consumeNext: false }
        : {
            valid: false,
            reason: _("ByeDPI option requires a value: %s").format(base),
            captureNextValue: false,
          };
    }

    if (BYEDPI_LONG_FLAG_OPTIONS.has(base)) {
      return {
        valid: false,
        reason: _("ByeDPI option does not accept a value: %s").format(base),
        captureNextValue: false,
      };
    }

    return {
      valid: false,
      reason: _("Unknown ByeDPI option: %s").format(base),
      captureNextValue: false,
    };
  }

  if (/^--.+/.test(token)) {
    if (BYEDPI_LONG_VALUE_OPTIONS.has(token)) {
      return nextToken && !byedpiTokenLooksLikeOption(nextToken)
        ? { valid: true, consumeNext: true }
        : {
            valid: false,
            reason: _("ByeDPI option requires a value: %s").format(token),
            captureNextValue: false,
          };
    }

    if (BYEDPI_LONG_FLAG_OPTIONS.has(token)) {
      return { valid: true, consumeNext: false };
    }

    return {
      valid: false,
      reason: _("Unknown ByeDPI option: %s").format(token),
      captureNextValue: false,
    };
  }

  if (/^-./.test(token)) {
    if (token === "-") {
      return {
        valid: false,
        reason: _("Unexpected ByeDPI strategy argument: %s").format(token),
        captureNextValue: false,
      };
    }

    const short = getByedpiShortOptionName(token);
    const compactValue = token.slice(short.length);

    if (BYEDPI_SHORT_VALUE_OPTIONS.has(short)) {
      if (token === short) {
        return nextToken && !byedpiTokenLooksLikeOption(nextToken)
          ? { valid: true, consumeNext: true }
          : {
              valid: false,
              reason: _("ByeDPI option requires a value: %s").format(short),
              captureNextValue: false,
            };
      }

      return compactValue.length
        ? { valid: true, consumeNext: false }
        : {
            valid: false,
            reason: _("ByeDPI option requires a value: %s").format(short),
            captureNextValue: false,
          };
    }

    if (BYEDPI_SHORT_FLAG_OPTIONS.has(short)) {
      return token === short
        ? { valid: true, consumeNext: false }
        : {
            valid: false,
            reason: _(
              "ByeDPI option does not accept a compact value: %s",
            ).format(short),
            captureNextValue: false,
          };
    }

    return {
      valid: false,
      reason: _("Unknown ByeDPI option: %s").format(short),
      captureNextValue: false,
    };
  }

  return {
    valid: false,
    reason: _("Unexpected ByeDPI strategy argument: %s").format(token),
    captureNextValue: false,
  };
}

function buildByedpiLocalAnalysis(value) {
  const text = value ? `${value}` : "";
  if (!text.trim().length) {
    return {
      valid: false,
      message: _("ByeDPI strategy cannot be empty"),
      annotations: [],
    };
  }

  const parsed = parseByedpiStrategyTokens(text);
  if (parsed.unterminatedQuote) {
    return {
      valid: false,
      message: _("ByeDPI strategy has an unterminated %s quote").format(
        parsed.unterminatedQuote,
      ),
      annotations: [],
    };
  }

  const tokens = parsed.tokens;
  const annotationMap = new Map();
  const errors = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];
    const nextToken = tokens[index + 1] || null;
    const tokenValidation = validateByedpiStrategyToken(
      token.value,
      nextToken ? nextToken.value : null,
    );

    if (tokenValidation.valid) {
      index += tokenValidation.consumeNext ? 2 : 1;
      continue;
    }

    annotate.addAnnotationIssue(annotationMap, token, tokenValidation.reason);
    let displayToken = token.value;

    if (
      tokenValidation.captureNextValue &&
      nextToken &&
      !nextToken.value.startsWith("-")
    ) {
      annotate.addAnnotationIssue(annotationMap, nextToken, tokenValidation.reason);
      displayToken = `${displayToken} ${nextToken.value}`;
      index += 2;
    } else {
      index += 1;
    }

    errors.push(`${displayToken}: ${tokenValidation.reason}`);
  }

  if (!errors.length) {
    return { valid: true, message: "", annotations: [] };
  }

  return {
    valid: false,
    message: [annotate.getValidationHeaderText(), ...errors].join("\n"),
    annotations: annotate.finalizeAnnotations(annotationMap),
  };
}

return baseclass.extend({
  ZAPRET_LEGACY_DEFAULT_NFQWS_OPT,
  ZAPRET_DEFAULT_NFQWS_OPT,
  ZAPRET2_DEFAULT_NFQWS2_OPT,
  BYEDPI_DEFAULT_CMD_OPTS,
  getNfqwsOptionArgumentMode,
  getNfqws2OptionArgumentMode,
  parseNfqwsRuntimeTokens,
  parseByedpiStrategyTokens,
  normalizeNfqwsStrategyValue,
  normalizeNfqws2StrategyValue,
  normalizeByedpiStrategyValue,
  getNfqwsForbiddenTokenInfo,
  getNfqws2ForbiddenTokenInfo,
  getByedpiControlledTokenInfo,
  validateByedpiStrategyToken,
  buildNfqwsLocalAnalysis,
  buildNfqws2LocalAnalysis,
  buildByedpiLocalAnalysis,
  addNfqwsRemoteValidationAnnotations,
});
