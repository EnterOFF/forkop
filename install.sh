#!/bin/sh
# shellcheck shell=dash
#
# Installs, updates and removes Forkop and its core, sing-box-forkop, on OpenWrt 24.10 and newer.
# The Components tab of Forkop runs it too, so its options (usage() below, which --help prints),
# exit codes and --json lines are a contract: they change only in ways an older tab understands.
#
# --from checks each package against the SHA256SUMS* files in DIR and warns of one none lists.
#
# Exit codes: 0 done or nothing to do, 1 failed before changing anything, 2 bad options,
# 3 consent needed (nothing changed), 4 failed after changes began, 5 installed but Forkop did not
# start.
#
# --json writes one object per line:
#   {"event":"step","step":ID,"text":TEXT}   checks release download migration dry_run backup
#                                            dependencies stop remove install start
#   {"event":"info","text":TEXT}             {"event":"warn","code":CODE,"text":TEXT}
#   {"event":"plan", "forkop":FROM->TO, "core":FROM->TO, "variant":NAME, "config":ACTION}
#                                            ACTION is migrate, current, reset, unknown or none
#   {"event":"consent","code":CODE,"name":NAME,"text":TEXT}   every item --yes would allow, then a
#                                            result with status "consent"; CODE is remove_package,
#                                            replace_package (a third-party build of Forkop),
#                                            remove_file, reset_config or downgrade
#   {"event":"error","code":CODE,"text":TEXT}
#   {"event":"result","status":"ok|consent|error","code":CODE,"exit":N,"changed":BOOL,
#    "forkop":VERSION,"core":VERSION,"variant":NAME,"backup":PATH,"log":PATH}
#                                            backup: the config from before, when a copy was kept
# The result line comes last, except after bad options: those print the usage and no JSON.
# Error codes: not_root not_openwrt unsupported_openwrt unsupported_arch no_package_manager locked
# network release incompatible checksum no_space no_memory migration dry_run declined
# consent_required interrupted backup dependencies transaction service.
# Warning codes: low_memory clock lists newer no_forkop paused tiny custom_outdated migration_check
# migration_note unverified not_started.
# In a terminal, with no --variant, --yes or --dry-run, the installer also asks which build of the
# core to install where sing-box-forkop is not installed, and offers to replace a custom core older
# than the release; elsewhere it keeps what is installed, or installs base.
#
# FORKOP_DOWNLOAD_URL replaces https://github.com, for a mirror with the same release paths;
# https_proxy and http_proxy are honored, NO_COLOR turns colors off.
#
# Every release carries release.json beside its packages, install.sh and SHA256SUMS:
#   {"schema":1,"name":"forkop","version":"2.0.0","tag":"2.0.0","page":URL,
#    "requires":{"sing-box-forkop":"1.14.3-r1"},"min_config_version":"1.0.2"}
# The core's says "name":"sing-box-forkop" and requires the oldest Forkop it works with. An
# "install_command" field says the release installs only with that command, not from the tab.

set -u

FORKOP_REPO=ushan0v/forkop
CORE_REPO=ushan0v/sing-box-forkop
DOWNLOAD_URL=${FORKOP_DOWNLOAD_URL:-https://github.com}
LOG=/tmp/forkop-install.log
LOCK_DIR=/var/lock/forkop-install.lock
OUR_PACKAGES="forkop luci-app-forkop luci-i18n-forkop-ru sing-box-forkop"
# The other packages known to install /usr/bin/sing-box; any other package that owns it counts too.
FOREIGN_CORES="sing-box sing-box-tiny sing-box-extended podkop-engine podkop-engine-full sing-box-lx sing-box-x rust-x steer-box-connector"
# What sing-box-forkop provides: a package that needs it stays when a foreign core goes.
CORE_PROVIDES=sing-box
# What a core outside the package managers leaves: Forkop 1.0.x's binary builds and the installer
# of EikeiDev/OpenWRT-sing-box-extended, whose wrapper runs the core from /usr/libexec.
FOREIGN_CORE_FILES="/usr/bin/sing-box /etc/init.d/sing-box /usr/libexec/sing-box-core /etc/sing-box-version.cache /usr/lib/libcronet.so"
# Forkop 1.0.x's own state about its cores, and the backups its updater left when it failed.
LEGACY_FILES="/etc/forkop/sing-box-variant /etc/forkop/sing-box-version /usr/bin/sing-box.forkop-backup.* /usr/lib/libcronet.so.forkop-backup.* /etc/init.d/sing-box.forkop.*"
# The defaults a package manager leaves beside a config it keeps.
CONFFILE_COPIES="/etc/config/forkop-opkg /etc/config/forkop.apk-new /etc/config/sing-box-opkg /etc/config/sing-box.apk-new /etc/sing-box/config.json-opkg /etc/sing-box/config.json.apk-new"

MODE=install CORE_ONLY=0 VARIANT='' PURGE=0 DRY_RUN=0 FROM='' WANT_FORKOP='' WANT_CORE=''
YES=0 JSON=0 LANG_OPT=''
RU=0 INTERACTIVE=0 C_STEP='' C_OK='' C_WARN='' C_ERR='' C_DIM='' C_OFF=''
WORK='' LOCKED=0 CHANGED=0
PM='' EXT='' ARCH='' RELEASE=''
FLASH_MOUNT=/ FLASH_FS='' FLASH_FREE_KB=0 MEM_FREE_KB=0 MEM_TOTAL_MB=0
FORKOP_OLD='' APP_OLD='' I18N_OLD='' CORE_OLD='' CORE_OLD_VARIANT='' CORE_DESC='' CONFIG_VERSION='' FORK_URL=''
FORKOP_ENABLED=0 FORKOP_RUNNING=0 PAUSED=0
FOREIGN_PKGS='' FOREIGN_WORLD='' FOREIGN_FILES='' LEFTOVERS='' OTHER_CONFIGS=''
F_VERSION='' F_TAG='' F_CORE_MIN='' F_MIN_CONFIG='' F_SUMS=''
C_VERSION='' C_TAG='' C_FORKOP_MIN='' C_SUMS=''
FORKOP_ACTION=none CORE_ACTION=none I18N=0 CORE_VARIANT='' VARIANT_AUTO=0 VARIANT_NOTE=''
NEED_FORKOP=0 NEED_APP=0 NEED_I18N=0
FILE_FORKOP='' FILE_APP='' FILE_I18N='' FILE_CORE=''
CONFIG_PLAN=none CONFIG_FROM='' CONFIG_REASON='' CONFIG_WARNINGS=''
REMOVE_PKGS='' REMOVE_FILES='' DEPS_MISSING='' LISTS_FAILED=0 PREDELETE_CORE=0 CORE_REINSTALL=0
DOWNGRADE='' OPKG_FLAGS=''
RESULT_FORKOP='' RESULT_CORE='' RESULT_VARIANT='' BACKUP=''

# --- output ---------------------------------------------------------------------------------

log() {
	printf '%s\n' "$*" >>"$LOG" 2>/dev/null
}

t() { # t ENGLISH RUSSIAN [ARG]...: the message in the output language, printf-formatted
	local format="$1"
	[ "$RU" = 1 ] && format="$2"
	shift 2
	# shellcheck disable=SC2059
	printf "$format" "$@"
}

json_text() {
	printf '%s' "$1" | tr '\n\t' '  ' | tr -d '\r' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

emit() { # emit EVENT [KEY VALUE]...
	local line="{\"event\":\"$1\""
	shift
	while [ "$#" -ge 2 ]; do
		line="$line,\"$1\":\"$(json_text "$2")\""
		shift 2
	done
	printf '%s}\n' "$line" 2>/dev/null
}

say() { # say PREFIX COLOR TEXT
	printf '%s%s%s %s\n' "$2" "$1" "$C_OFF" "$3" 2>/dev/null
}

step() { # step ID TEXT
	log "== $2"
	if [ "$JSON" = 1 ]; then emit step step "$1" text "$2"; else say '[*]' "$C_STEP" "$2"; fi
}

ok() {
	log "ok: $1"
	if [ "$JSON" = 1 ]; then emit info text "$1"; else say '[+]' "$C_OK" "$1"; fi
}

warn() { # warn CODE TEXT
	log "warn: $2"
	if [ "$JSON" = 1 ]; then emit warn code "$1" text "$2"; else say '[!]' "$C_WARN" "$2"; fi
}

detail() { # an indented line under the one before, text output only
	log "   $1"
	[ "$JSON" = 1 ] || printf '    %s%s%s\n' "$C_DIM" "$1" "$C_OFF" 2>/dev/null
}

fail() { # fail EXIT CODE TEXT [HINT]
	log "error ($2): $3 ${4:-}"
	if [ "$JSON" = 1 ]; then
		[ "$1" = 3 ] || emit error code "$2" text "$3${4:+ $4}"
	else
		if [ "$1" = 3 ] || [ "$2" = declined ]; then say '[!]' "$C_WARN" "$3" >&2; else say '[x]' "$C_ERR" "$3" >&2; fi
		[ -z "${4:-}" ] || printf '    %s\n' "$4" >&2
	fi
	finish "$1" "$2"
}

bool() {
	if [ "$1" = 1 ]; then echo true; else echo false; fi
}

finish() { # finish EXIT [CODE]
	local status=error
	case "$1" in 0) status=ok ;; 3) status=consent ;; esac
	resume_forkop
	if [ "$JSON" = 1 ]; then
		printf '{"event":"result","status":"%s","code":"%s","exit":%s,"changed":%s,"forkop":"%s","core":"%s","variant":"%s","backup":"%s","log":"%s"}\n' \
			"$status" "${2:-}" "$1" "$(bool "$CHANGED")" "$(json_text "$RESULT_FORKOP")" "$(json_text "$RESULT_CORE")" \
			"$(json_text "$RESULT_VARIANT")" "$(json_text "$BACKUP")" "$LOG" 2>/dev/null
	elif [ "$1" != 0 ] && [ "$1" != 2 ] && [ "$1" != 3 ] && [ "${2:-}" != declined ]; then
		[ -z "$BACKUP" ] || printf '    %s\n' "$(t 'The config from before is kept as %s' 'Конфиг до установки сохранён как %s' "$BACKUP")" >&2
		printf '    %s\n' "$(t 'Log: %s' 'Журнал: %s' "$LOG")" >&2
	fi
	cleanup
	exit "$1"
}

cleanup() {
	[ -z "$WORK" ] || rm -rf "$WORK"
	[ "$LOCKED" = 0 ] || rm -rf "$LOCK_DIR"
}

# shellcheck disable=SC2317
on_signal() { # before any change: apply and uninstall ignore these signals while they change things
	trap '' INT TERM HUP
	fail 1 interrupted "$(t 'Interrupted: nothing was changed' 'Прервано: ничего не изменено')"
}

# The text is inline: under sh <(wget -O - …) the script is a pipe, drained by the time this runs.
usage() {
	cat <<'EOF'
Usage: sh install.sh [option]...

  (no option)              install or update Forkop and its core
  --core-only              install or update only the core
  --variant base|full|tiny the core's build; the installed official one, or base, by default
  --uninstall              remove Forkop and its core; --purge removes their settings too
  --dry-run                check, download and try the transaction without changing anything
  --from DIR               install the packages found in DIR instead of downloading them
  --version X.Y.Z          the Forkop release to install, the latest by default
  --core-version X.Y.Z-rN  the core release to install, the latest by default
  -y, --yes                consent to what would otherwise be asked: removing software that
                           stands in Forkop's way, a config Forkop cannot migrate, a downgrade
  --json                   JSON lines on stdout instead of text, messages in English
  --lang ru|en             the language of the messages, LuCI's by default
EOF
}

usage_error() {
	printf 'install.sh: %s\n' "$1" >&2
	usage >&2
	exit 2
}

ask() { # ask QUESTION: 0 when the answer is yes
	local answer=''
	printf '%s [y/N] ' "$1" >/dev/tty
	read -r answer </dev/tty || return 1
	case "$answer" in y | Y | yes | Yes | YES | д | Д | да | Да | ДА) return 0 ;; esac
	return 1
}

may_ask() { # a person at a terminal, who left no answer to --yes and wants no dry run
	[ "$INTERACTIVE" = 1 ] && [ "$YES" = 0 ] && [ "$DRY_RUN" = 0 ]
}

choose_variant() { # CORE_VARIANT from the person; Enter keeps base, which turns tiny where it does not fit
	local answer=''
	{
		printf '\n%s\n' "$(t 'Which build of the core to install:' 'Какую сборку ядра поставить:')"
		printf '  1) base  %s\n' "$(t 'recommended: whatever ordinary subscriptions carry, WireGuard, AmneziaWG, WARP, OpenVPN, TrustTunnel' 'рекомендуется: всё из обычных подписок, WireGuard, AmneziaWG, WARP, OpenVPN, TrustTunnel')"
		printf '  2) full  %s\n' "$(t 'base and Tailscale, OpenConnect, mieru, Snell, SSH, ShadowTLS, Tor, NaiveProxy (not on every architecture); about twice the flash' 'как base и ещё Tailscale, OpenConnect, mieru, Snell, SSH, ShadowTLS, Tor, NaiveProxy (не на всех архитектурах); примерно вдвое больше флеша')"
		printf '  3) tiny  %s\n' "$(t 'for a small flash: no WireGuard, AmneziaWG, WARP, OpenVPN, TrustTunnel, VMess or AnyTLS' 'для маленькой флешки: без WireGuard, AmneziaWG, WARP, OpenVPN, TrustTunnel, VMess и AnyTLS')"
	} >/dev/tty
	while :; do
		printf '%s [1] ' "$(t 'Build' 'Сборка')" >/dev/tty
		read -r answer </dev/tty || answer=''
		case "$answer" in
		'' | 1 | base) return 0 ;;
		2 | full) CORE_VARIANT=full VARIANT_AUTO=0 ;;
		3 | tiny) CORE_VARIANT=tiny VARIANT_AUTO=0 ;;
		*) continue ;;
		esac
		log "build chosen: $CORE_VARIANT"
		return 0
	done
}

# --- helpers --------------------------------------------------------------------------------

is_number() {
	case "$1" in '' | *[!0-9]*) return 1 ;; esac
}

mb() { # kilobytes as megabytes with one decimal
	awk -v k="$1" 'BEGIN { printf "%.1f", k / 1024 }'
}

contains() { # contains WORD LIST
	case " $2 " in *" $1 "*) return 0 ;; esac
	return 1
}

openwrt_value() {
	sed -n "s/^$1='\(.*\)'\$/\1/p" /etc/openwrt_release | head -n 1
}

free_kb() {
	df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

mem_available_kb() {
	awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo
}

file_kb() {
	[ -f "$1" ] || { echo 0; return; }
	wc -c <"$1" | awk '{ printf "%d", ($1 + 1023) / 1024 }'
}

upper_kb() { # what file $1 takes on the flash: nothing when it lives in the read-only image
	if [ "$FLASH_MOUNT" = /overlay ]; then file_kb "/overlay/upper$1"; else file_kb "$1"; fi
}

deadline() { # deadline SECONDS COMMAND...: the command's status, 124 once it ran out of time
	local seconds="$1" pid waited=0
	shift
	"$@" &
	pid=$!
	while kill -0 "$pid" 2>/dev/null; do
		if [ "$waited" -ge "$seconds" ]; then
			kill "$pid" 2>/dev/null
			wait "$pid" 2>/dev/null
			return 124
		fi
		sleep 1
		waited=$((waited + 1))
	done
	wait "$pid"
}

run() { # run COMMAND...: its output into the log
	log "\$ $*"
	"$@" >>"$LOG" 2>&1
}

capture() { # capture FILE COMMAND...: its output into FILE and the log
	local file="$1" status
	shift
	log "\$ $*"
	"$@" >"$file" 2>&1
	status=$?
	cat "$file" >>"$LOG" 2>/dev/null
	return "$status"
}

pm_errors() { # what the package manager complained of in its output file $1, on one line
	if [ "$PM" = apk ]; then
		grep -A 3 '^ERROR' "$1"
	else
		grep -m 3 -e '^ \* ' -e '^Unknown package' "$1"
	fi | tr -s ' \n' ' '
}

vercmp() { # vercmp A B: -1, 0 or 1 in the order of the package manager
	if [ "$PM" = apk ]; then
		case "$(apk version -t "$1" "$2" 2>/dev/null)" in
		'<') echo -1 ;; '>') echo 1 ;; *) echo 0 ;;
		esac
	elif opkg compare-versions "$1" = "$2"; then
		echo 0
	elif opkg compare-versions "$1" '<<' "$2"; then
		echo -1
	else
		echo 1
	fi
}

older() { # older A B: A is a version before B
	[ "$(vercmp "$1" "$2")" = -1 ]
}

# --- packages -------------------------------------------------------------------------------

refresh_db() { # name, version, depends and provides of every installed package
	if [ "$PM" = apk ]; then
		awk '
			/^P:/ { n = substr($0, 3) } /^V:/ { v = substr($0, 3) }
			/^D:/ { d = substr($0, 3) } /^p:/ { p = substr($0, 3) }
			/^$/ { if (n != "") print n "\t" v "\t" d "\t" p; n = v = d = p = "" }
			END { if (n != "") print n "\t" v "\t" d "\t" p }' /lib/apk/db/installed
	else
		awk '
			/^Package: / { n = $2 } /^Version: / { v = $2 } /^Status: / { s = $0 }
			/^Depends: / { d = substr($0, 10) } /^Provides: / { p = substr($0, 11) }
			/^$/ { if (n != "" && s ~ / installed$/) print n "\t" v "\t" d "\t" p; n = v = d = p = s = "" }
			END { if (n != "" && s ~ / installed$/) print n "\t" v "\t" d "\t" p }' /usr/lib/opkg/status
	fi >"$WORK/db" 2>/dev/null
}

pkg_version() { # the installed version of package $1, nothing when it is not installed
	awk -F '\t' -v p="$1" '$1 == p { print $2; exit }' "$WORK/db"
}

pkg_url() { # the project URL installed package $1 names
	if [ "$PM" = apk ]; then
		awk -v p="$1" '/^P:/ { n = substr($0, 3) } /^U:/ && n == p { print substr($0, 3); exit }' /lib/apk/db/installed
	else
		sed -n 's/^URL: *//p' "/usr/lib/opkg/info/$1.control" 2>/dev/null | head -n 1
	fi
}

pkg_depends() { # the dependencies of installed package $1
	awk -F '\t' -v p="$1" '$1 == p { print $3; exit }' "$WORK/db"
}

core_requirement() { # the sing-box-forkop version a Depends field asks for: opkg "(>= V)", apk ">=V"
	printf '%s\n' "$1" | sed -n 's/.*sing-box-forkop *(* *>= *\([^), ]*\).*/\1/p'
}

provided() { # an installed package is or provides $1
	awk -F '\t' -v p="$1" '
		$1 == p { found = 1; exit }
		{ n = split($4, a, /[ ,]+/); for (i = 1; i <= n; i++) { w = a[i]; sub(/[<>=~(].*/, "", w); if (w == p) { found = 1; exit } } }
		END { exit !found }' "$WORK/db"
}

file_owner() { # the installed package that owns file $1
	if [ "$PM" = apk ]; then
		awk -v f="${1#/}" '/^P:/ { n = substr($0, 3) } /^F:/ { d = substr($0, 3) } /^R:/ { if (d "/" substr($0, 3) == f) { print n; exit } }' /lib/apk/db/installed
	else
		grep -l -x -F "$1" /usr/lib/opkg/info/*.list 2>/dev/null | head -n 1 | sed 's|.*/||; s|\.list$||'
	fi
}

in_world() {
	[ "$PM" = apk ] && grep -q -E "^$1([<>=~].*)?\$" /etc/apk/world 2>/dev/null
}

world_drop() { # remove the exact lines given from /etc/apk/world
	[ "$PM" = apk ] && [ -n "$*" ] || return 0
	awk -v drop=" $* " 'index(drop, " " $0 " ") == 0' /etc/apk/world >"$WORK/world" &&
		cat "$WORK/world" >/etc/apk/world
}

dependents() { # the installed packages in $1 and every installed package that needs one of them
	awk -F '\t' -v set=" $1 " -v keep=" $OUR_PACKAGES " -v stays=" $CORE_PROVIDES " '
		function names(s, out,    n, i, a, w) {
			gsub(/\([^)]*\)/, "", s); gsub(/[,|]/, " ", s)
			n = split(s, a, " ")
			for (i = 1; i <= n; i++) { w = a[i]; sub(/[<>=~].*/, "", w); if (w != "" && w !~ /^!/) out[w] = 1 }
		}
		{ name[NR] = $1; deps[NR] = $3; prov[NR] = $4; if (index(set, " " $1 " ")) rm[$1] = 1 }
		END {
			do {
				changed = 0
				split("", gone)
				for (i = 1; i <= NR; i++) if (name[i] in rm) { gone[name[i]] = 1; names(prov[i], gone) }
				n = split(stays, kept, " "); for (j = 1; j <= n; j++) delete gone[kept[j]]
				for (i = 1; i <= NR; i++) {
					if ((name[i] in rm) || index(keep, " " name[i] " ")) continue
					split("", need); names(deps[i], need)
					for (w in need) if (w in gone) { rm[name[i]] = 1; changed = 1; break }
				}
			} while (changed)
			for (i = 1; i <= NR; i++) if (name[i] in rm) printf "%s ", name[i]
		}' "$WORK/db"
}

removal_order() { # the packages in $1 ordered so that nothing is removed before what needs it
	awk -F '\t' -v set=" $1 " '
		function needs(s, w,    n, i, a, x) {
			gsub(/\([^)]*\)/, "", s); gsub(/[,|]/, " ", s)
			n = split(s, a, " ")
			for (i = 1; i <= n; i++) { x = a[i]; sub(/[<>=~].*/, "", x); if (x == w) return 1 }
			return 0
		}
		index(set, " " $1 " ") { k++; name[k] = $1; deps[k] = $3; prov[k] = $4 }
		END {
			left = k
			while (left > 0) {
				progress = 0
				for (i = 1; i <= k; i++) {
					if (done[i]) continue
					blocked = 0
					for (j = 1; j <= k; j++) {
						if (j == i || done[j]) continue
						if (needs(deps[j], name[i])) { blocked = 1; break }
						n = split(prov[i], p, " ")
						for (m = 1; m <= n; m++) { x = p[m]; sub(/[<>=~].*/, "", x); if (needs(deps[j], x)) { blocked = 1; break } }
						if (blocked) break
					}
					if (!blocked) { printf "%s ", name[i]; done[i] = 1; left--; progress = 1 }
				}
				if (!progress) for (i = 1; i <= k; i++) if (!done[i]) { printf "%s ", name[i]; done[i] = 1; left-- }
			}
		}' "$WORK/db"
}

control_of() { # control_of FILE: the package's control fields, read once per run
	local saved="$WORK/control/${1##*/}"
	if [ ! -f "$saved" ]; then
		mkdir -p "$WORK/control"
		read_control "$1" >"$saved.new" && mv "$saved.new" "$saved"
	fi
	cat "$saved" 2>/dev/null
}

read_control() { # Conflicts included for apk, which keeps them among the dependencies
	local file="$1" dir="$WORK/control.$$"
	if [ "$EXT" = apk ]; then
		apk adbdump "$file" 2>/dev/null | awk '
			/^info:/ { info = 1; next }
			/^[^ ]/ { info = 0 }
			!info { next }
			/^  [a-z-]+:/ {
				key = $1; sub(/:$/, "", key); value = $0; sub(/^  [a-z-]+: */, "", value); list = (key == "depends")
				if (key == "name") print "Package: " value
				else if (key == "version") print "Version: " value
				else if (key == "arch") print "Architecture: " value
				else if (key == "installed-size") print "Installed-Size: " value
				next
			}
			list && /^    - / {
				d = substr($0, 7); gsub(/\047/, "", d)
				if (d ~ /^!/) conflicts = conflicts (conflicts == "" ? "" : ", ") substr(d, 2)
				else depends = depends (depends == "" ? "" : ", ") d
			}
			END { print "Depends: " depends; print "Conflicts: " conflicts }'
	else
		rm -rf "$dir" && mkdir -p "$dir" || return 1
		tar -xzf "$file" -C "$dir" ./control.tar.gz 2>/dev/null || tar -xzf "$file" -C "$dir" control.tar.gz 2>/dev/null
		tar -xzOf "$dir/control.tar.gz" ./control 2>/dev/null || tar -xzOf "$dir/control.tar.gz" control 2>/dev/null
		rm -rf "$dir"
	fi
}

field() { # field CONTROL NAME
	printf '%s\n' "$1" | sed -n "s/^$2: *//p" | head -n 1
}

dep_names() { # the package names a Depends or Conflicts field lists
	# shellcheck disable=SC2020
	printf '%s\n' "$1" | sed 's/([^)]*)//g' | tr ',| ' '\n\n\n' | sed 's/[<>=~].*//' | grep -v -e '^$' -e '^!'
}

# --- downloads ------------------------------------------------------------------------------

fetch() { # fetch URL FILE: 0, 2 when the server answered with an HTTP error, 1 when it was not reached
	local status
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --connect-timeout 15 --retry 2 -o "$2" "$1" 2>>"$LOG"
		status=$?
		[ "$status" != 22 ] || return 2
	else
		# uclient-fetch exits 8 when the server answers with an error, 4 when it is not reached
		wget -q -T 30 -O "$2" "$1" 2>>"$LOG"
		status=$?
		[ "$status" != 8 ] || return 2
	fi
	[ "$status" = 0 ]
}

download() { # download URL FILE, three tries: 0, or 2 when the server has no such file, 1 when it was not reached
	local try status
	for try in 1 2 3; do
		rm -f "$2"
		log "download $1"
		fetch "$1" "$2"
		status=$?
		[ "$status" != 0 ] || [ ! -s "$2" ] || return 0
		[ "$status" != 2 ] || { rm -f "$2"; return 2; }
		if [ "$(mem_available_kb)" -lt 4096 ] 2>/dev/null || [ "$(free_kb /tmp)" -lt 1024 ] 2>/dev/null; then
			rm -f "$2"
			fail 1 no_memory "$(t 'RAM is full: the downloads do not fit in /tmp' 'Закончилась оперативная память: загрузки не помещаются в /tmp')" \
				"$(t 'Free some RAM, or download the packages on a computer and use --from' 'Освободите память или скачайте пакеты на компьютере и запустите с --from')"
		fi
		[ "$try" = 3 ] || sleep 2
	done
	rm -f "$2"
	return 1
}

release_url() { # release_url REPO TAG FILE: TAG empty for the latest release
	if [ -n "$2" ]; then
		printf '%s/%s/releases/download/%s/%s' "$DOWNLOAD_URL" "$1" "$2" "$3"
	else
		printf '%s/%s/releases/latest/download/%s' "$DOWNLOAD_URL" "$1" "$3"
	fi
}

checksum_of() { # checksum_of NAME SUMS
	awk -v n="$1" '$2 == n || $2 == "*" n { print $1; exit }' "$2"
}

verify() { # verify FILE SUMS: 0 matches, 1 differs, 2 SUMS has no line for it
	local expected
	expected=$(checksum_of "${1##*/}" "$2")
	[ -n "$expected" ] || return 2
	[ "$(sha256sum "$1" | cut -d ' ' -f 1)" = "$expected" ]
}

network_hint() {
	if [ "$PAUSED" = 1 ]; then
		t 'Forkop was stopped to free RAM, and the download failed without it: download the packages on a computer and use --from' \
			'Forkop был остановлен ради памяти, и без него загрузка не прошла: скачайте пакеты на компьютере и запустите с --from'
	elif pidof sing-box sing-box-core >/dev/null 2>&1; then
		t 'sing-box is running and may be what keeps the router offline: stop Forkop (/etc/init.d/forkop stop) or the service that runs sing-box, and run the installer again' \
			'Работает sing-box, и роутер может быть без сети из-за него: остановите Forkop (/etc/init.d/forkop stop) или службу, которая запускает sing-box, и запустите установщик снова'
	elif ! nslookup github.com >/dev/null 2>&1; then
		t 'The router cannot resolve github.com: check its DNS and internet connection' 'Роутер не может разрешить github.com: проверьте DNS и подключение к интернету'
	else
		t 'Check the internet connection of the router, or use --from with packages downloaded elsewhere' 'Проверьте подключение роутера к интернету или скачайте пакеты на другом устройстве и запустите с --from'
	fi
}

# --- the system -----------------------------------------------------------------------------

setup_output() {
	if [ "$JSON" = 0 ] && [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
		C_STEP=$(printf '\033[1;36m') C_OK=$(printf '\033[1;32m') C_WARN=$(printf '\033[1;33m')
		C_ERR=$(printf '\033[1;31m') C_DIM=$(printf '\033[2m') C_OFF=$(printf '\033[0m')
	fi
	if [ "$JSON" = 0 ] && ( : </dev/tty ) 2>/dev/null; then
		INTERACTIVE=1
	fi
}

detect_package_manager() {
	if command -v apk >/dev/null 2>&1; then
		PM=apk EXT=apk
	elif command -v opkg >/dev/null 2>&1; then
		PM=opkg EXT=ipk
	else
		fail 1 no_package_manager "$(t 'Neither opkg nor apk is installed' 'Нет ни opkg, ни apk')"
	fi
}

pick_language() {
	local lang
	case "$LANG_OPT" in ru) RU=1 ;; en) RU=0 ;; esac
	[ -z "$LANG_OPT" ] && [ "$JSON" = 0 ] || return 0
	lang=$(uci -q get luci.main.lang)
	case "$lang" in
	ru*) RU=1 ;;
	auto | '') [ -n "$(pkg_version luci-i18n-base-ru)$(pkg_version luci-i18n-forkop-ru)" ] && RU=1 ;;
	esac
}

lock() {
	local pid
	mkdir -p "${LOCK_DIR%/*}"
	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			fail 1 locked "$(t 'Another installer is running (process %s)' 'Уже работает другой установщик (процесс %s)' "$pid")"
		fi
		rm -rf "$LOCK_DIR"
		mkdir "$LOCK_DIR" || fail 1 locked "$(t 'Cannot take %s' 'Не удалось занять %s' "$LOCK_DIR")"
	fi
	echo "$$" >"$LOCK_DIR/pid"
	LOCKED=1
}

package_arch() { # what packages are built for: apk --print-arch names its own build, aarch64 for aarch64_cortex-a53
	if [ "$PM" = apk ]; then
		cat /etc/apk/arch 2>/dev/null
	else
		opkg print-architecture 2>/dev/null |
			awk '$1 == "arch" && $2 != "all" && $2 != "noarch" && $3 + 0 > p { p = $3 + 0; a = $2 } END { print a }'
	fi
}

unbuilt_reason() { # why no sing-box-forkop exists for architecture $1
	case "$1" in
	arm_fa526) t 'its ARMv4 processor is older than the ARMv5 Go needs' 'его процессор ARMv4, а Go нужен хотя бы ARMv5' ;;
	armeb_xscale) t 'Go has no port for big-endian ARM' 'для ARM с обратным порядком байт нет Go' ;;
	powerpc_464fp | powerpc_8548) t 'Go has no port for 32-bit PowerPC' 'для 32-битного PowerPC нет Go' ;;
	powerpc64_e5500) t "Go's ppc64 port needs a POWER8 processor, and the e5500 is older" 'Go для ppc64 нужен процессор POWER8, а e5500 старше' ;;
	esac
}

check_system() {
	local major minor reason year servers server waited
	step checks "$(t 'Checking the system' 'Проверка системы')"
	RELEASE=$(openwrt_value DISTRIB_RELEASE)
	major=${RELEASE%%.*}
	minor=${RELEASE#*.}
	minor=${minor%%.*}
	minor=${minor%%-*}
	case "$RELEASE" in
	*SNAPSHOT*) ;;
	*)
		if ! is_number "$major" || ! is_number "$minor" || [ "$major" -lt 24 ] ||
			{ [ "$major" -eq 24 ] && [ "$minor" -lt 10 ]; }; then
			fail 1 unsupported_openwrt "$(t 'Forkop needs OpenWrt 24.10 or newer, and this router runs %s' 'Forkop нужна OpenWrt 24.10 или новее, а на роутере %s' "${RELEASE:-?}")"
		fi
		;;
	esac
	ARCH=$(package_arch)
	[ -n "$ARCH" ] || ARCH=$(openwrt_value DISTRIB_ARCH)
	reason=$(unbuilt_reason "$ARCH")
	if [ -n "$reason" ]; then
		fail 1 unsupported_arch "$(t 'Forkop cannot run on %s: %s, so sing-box-forkop has no build for it' 'Forkop не может работать на %s: %s, поэтому сборки sing-box-forkop для него нет' "$ARCH" "$reason")"
	fi
	grep -q ' /overlay ' /proc/mounts && FLASH_MOUNT=/overlay
	FLASH_FS=$(awk -v m="$FLASH_MOUNT" '$2 == m { t = $3 } END { print t }' /proc/mounts)
	FLASH_FREE_KB=$(free_kb "$FLASH_MOUNT")
	MEM_FREE_KB=$(mem_available_kb)
	MEM_TOTAL_MB=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)
	ok "OpenWrt $RELEASE, $ARCH, $PM"
	ok "$(t 'Flash: %s MB free (%s). RAM: %s MB, %s MB available' 'Флеш: свободно %s МБ (%s). Память: %s МБ, доступно %s МБ' \
		"$(mb "$FLASH_FREE_KB")" "$FLASH_FS" "$MEM_TOTAL_MB" "$(mb "$MEM_FREE_KB")")"
	if [ "$MEM_TOTAL_MB" -lt 120 ] 2>/dev/null; then
		warn low_memory "$(t 'Forkop needs about 128 MB of RAM, and this router has %s MB' 'Forkop нужно около 128 МБ памяти, а у роутера %s МБ' "$MEM_TOTAL_MB")"
	fi

	year=$(date +%Y)
	if [ "$year" -lt 2025 ] 2>/dev/null && [ -z "$FROM" ]; then
		servers=$(uci -q get system.ntp.server)
		set --
		for server in ${servers:-0.openwrt.pool.ntp.org 1.openwrt.pool.ntp.org}; do set -- "$@" -p "$server"; done
		deadline 20 ntpd -n -q "$@" >>"$LOG" 2>&1
		if [ "$(date +%Y)" -ge 2025 ]; then
			ok "$(t 'The clock was wrong and is set now: %s' 'Часы стояли неверно, теперь выставлены: %s' "$(date '+%Y-%m-%d %H:%M')")"
		else
			warn clock "$(t 'The clock reads %s and could not be set: downloads over HTTPS may fail' 'Часы показывают %s и не выставились: загрузка по HTTPS может не пройти' "$(date '+%Y-%m-%d')")"
		fi
	fi

	waited=0
	while pidof opkg apk >/dev/null 2>&1; do
		[ "$waited" = 0 ] && ok "$(t 'Waiting for another opkg or apk to finish' 'Жду, пока закончит другой opkg или apk')"
		[ "$waited" -lt 120 ] || fail 1 locked "$(t 'Another opkg or apk has been running for two minutes' 'Другой opkg или apk работает уже две минуты')" \
			"$(t 'Let it finish and run the installer again' 'Дождитесь его окончания и запустите установщик снова')"
		sleep 2
		waited=$((waited + 2))
	done
}

# --- what is installed ----------------------------------------------------------------------

forkop_status() { # running or enabled, from the installed Forkop
	local status
	[ -x /etc/init.d/forkop ] && /etc/init.d/forkop enabled 2>/dev/null && FORKOP_ENABLED=1
	[ -x /usr/bin/forkop ] || return 0
	status=$(deadline 15 /usr/bin/forkop get_status 2>/dev/null)
	log "forkop get_status: $status"
	case "$(printf '%s' "$status" | jsonfilter -e '@.running' 2>/dev/null)" in 1 | true) FORKOP_RUNNING=1 ;; esac
	# get_status counts a core that started less than two seconds ago, or a capture being set up
	# again, as stopped; procd runs Forkop's core as its sing-box service all the same
	if [ "$FORKOP_RUNNING" = 0 ] && [ "$FORKOP_ENABLED" = 1 ] &&
		ubus call service list '{"name":"sing-box"}' 2>/dev/null | jsonfilter -e '@["sing-box"].instances[*].running' 2>/dev/null | grep -q true; then
		FORKOP_RUNNING=1
	fi
	log "forkop: enabled $FORKOP_ENABLED, running $FORKOP_RUNNING"
}

read_state() {
	local name file owner binary
	refresh_db
	FORKOP_OLD=$(pkg_version forkop)
	# every release of Forkop names this project; a fork built under its package names names its own
	FORK_URL=$(pkg_url forkop)
	[ -n "$FORKOP_OLD" ] && [ "$FORK_URL" != "https://github.com/$FORKOP_REPO" ] || FORK_URL=''
	APP_OLD=$(pkg_version luci-app-forkop)
	I18N_OLD=$(pkg_version luci-i18n-forkop-ru)
	CORE_OLD=$(pkg_version sing-box-forkop)
	[ -z "$CORE_OLD" ] || CORE_OLD_VARIANT=$(cat /usr/share/sing-box-forkop/variant 2>/dev/null)
	[ ! -f /etc/config/forkop ] || CONFIG_VERSION=$(uci -q get forkop.settings.config_version)
	forkop_status

	for name in $FOREIGN_CORES; do
		if [ -n "$(pkg_version "$name")" ]; then
			FOREIGN_PKGS="$FOREIGN_PKGS $name"
		elif in_world "$name"; then
			FOREIGN_WORLD="$FOREIGN_WORLD $name"
		fi
	done
	for file in $FOREIGN_CORE_FILES; do
		[ -e "$file" ] || continue
		# sing-box-forkop installs these itself, and an opkg run that ran out of space cuts its file list
		[ -z "$CORE_OLD" ] || case "$file" in /usr/bin/sing-box | /etc/init.d/sing-box) continue ;; esac
		owner=$(file_owner "$file")
		[ -n "$owner" ] || FOREIGN_FILES="$FOREIGN_FILES $file"
	done
	for file in $LEGACY_FILES; do
		[ ! -e "$file" ] || LEFTOVERS="$LEFTOVERS $file"
	done
	for file in /etc/config/podkop /etc/config/podkop-plus /etc/config/podkop_plus /etc/config/podkop-exp; do
		[ ! -f "$file" ] || OTHER_CONFIGS="$OTHER_CONFIGS $file"
	done

	binary=$(sing_box_version /usr/bin/sing-box)
	owner=$(file_owner /usr/bin/sing-box)
	if [ -n "$owner" ] && ! contains "$owner" "$OUR_PACKAGES $FOREIGN_PKGS"; then
		FOREIGN_PKGS="$FOREIGN_PKGS $owner"
	fi
	if [ -n "$CORE_OLD" ]; then
		CORE_DESC="sing-box-forkop $CORE_OLD ($CORE_OLD_VARIANT)"
	elif [ -n "$owner" ]; then
		CORE_DESC=$(t 'sing-box %s, package %s' 'sing-box %s, пакет %s' "${binary:-?}" "$owner")
	elif [ -e /usr/bin/sing-box ]; then
		CORE_DESC=$(t 'sing-box %s, a file of no package' 'sing-box %s, файл без пакета' "${binary:-?}")
	fi
}

sing_box_version() {
	[ -x "$1" ] || return 0
	deadline 10 "$1" version 2>/dev/null | awk 'NR == 1 { print $NF }'
}

report_state() {
	local forkop core
	if [ -n "$FORKOP_OLD" ]; then
		forkop="Forkop $FORKOP_OLD"
		[ -z "$FORK_URL" ] || forkop="$forkop ($(t 'a third-party build, %s' 'сторонняя сборка, %s' "${FORK_URL#https://}"))"
		[ "$FORKOP_RUNNING" = 1 ] && forkop="$forkop, $(t 'running' 'работает')"
	else
		forkop=$(t 'Forkop is not installed' 'Forkop не установлен')
	fi
	core=${CORE_DESC:-$(t 'no sing-box' 'sing-box нет')}
	ok "$(t 'Now: %s; core: %s' 'Сейчас: %s; ядро: %s' "$forkop" "$core")"
}

# --- the releases ---------------------------------------------------------------------------

read_manifest() { # read_manifest FILE NAME: prints version, tag, requirement, min config, one per line
	local name schema
	name=$(jsonfilter -i "$1" -e '@.name' 2>/dev/null)
	schema=$(jsonfilter -i "$1" -e '@.schema' 2>/dev/null)
	[ "$name" = "$2" ] && [ "$schema" = 1 ] || return 1
	jsonfilter -i "$1" -e '@.version' 2>/dev/null || return 1
	jsonfilter -i "$1" -e '@.tag' 2>/dev/null || echo
	if [ "$2" = forkop ]; then
		jsonfilter -i "$1" -e '@.requires["sing-box-forkop"]' 2>/dev/null || echo
		jsonfilter -i "$1" -e '@.min_config_version' 2>/dev/null || echo
	else
		jsonfilter -i "$1" -e '@.requires.forkop' 2>/dev/null || echo
	fi
}

fetch_or_fail() { # fetch_or_fail URL FILE NAME RELEASE: a file of a release, or the reason it is not there
	download "$1" "$2"
	case $? in
	0) return 0 ;;
	2) fail 1 release "$(t 'Release %s has no %s' 'В релизе %s нет %s' "$4" "$3")" ;;
	esac
	fail 1 network "$(t 'Cannot download %s' 'Не удалось скачать %s' "$3")" "$(network_hint)"
}

fetch_release() { # fetch_release REPO NAME TAG: the manifest and SHA256SUMS into $WORK/NAME.*
	local manifest="$WORK/$2.json"
	download "$(release_url "$1" "$3" release.json)" "$manifest"
	case $? in
	0) ;;
	2)
		[ -z "$3" ] || fail 1 release "$(t 'Release %s of %s was not found' 'Релиз %s у %s не найден' "$3" "$1")"
		fail 1 release "$(t 'The latest release of %s has no release.json: download the latest install.sh' 'В последнем релизе %s нет release.json: скачайте свежий install.sh' "$1")"
		;;
	*) fail 1 network "$(t 'Cannot download the release information of %s' 'Не удалось скачать сведения о релизе %s' "$1")" "$(network_hint)" ;;
	esac
	read_manifest "$manifest" "$([ "$2" = core ] && echo sing-box-forkop || echo forkop)" >"$WORK/$2.fields" ||
		fail 1 release "$(t 'The release information of %s is not what this installer reads: download the latest install.sh' 'Сведения о релизе %s в другом формате: скачайте свежий install.sh' "$1")"
}

resolve_release() {
	step release "$(t 'Finding the releases' 'Поиск релизов')"
	if [ -n "$FROM" ]; then
		resolve_local
	else
		if [ "$CORE_ONLY" = 0 ]; then
			fetch_release "$FORKOP_REPO" forkop "$WANT_FORKOP"
			{
				read -r F_VERSION
				read -r F_TAG
				read -r F_CORE_MIN
				read -r F_MIN_CONFIG
			} <"$WORK/forkop.fields"
			F_TAG=${F_TAG:-$F_VERSION}
			F_SUMS="$WORK/forkop.sums"
			fetch_or_fail "$(release_url "$FORKOP_REPO" "$F_TAG" SHA256SUMS)" "$F_SUMS" SHA256SUMS "Forkop $F_VERSION"
		fi
		fetch_release "$CORE_REPO" core "${WANT_CORE:+v$WANT_CORE}"
		{
			read -r C_VERSION
			read -r C_TAG
			read -r C_FORKOP_MIN
		} <"$WORK/core.fields"
		C_TAG=${C_TAG:-v$C_VERSION}
		C_SUMS="$WORK/core.sums"
		fetch_or_fail "$(release_url "$CORE_REPO" "$C_TAG" SHA256SUMS)" "$C_SUMS" SHA256SUMS "sing-box-forkop $C_VERSION"
	fi
	decide
}

resolve_local() { # --from: the versions of the packages in the directory
	local file
	[ -d "$FROM" ] || fail 1 release "$(t '%s is not a directory' '%s — не папка' "$FROM")"
	if [ "$CORE_ONLY" = 0 ]; then
		# shellcheck disable=SC2086
		set -- "$FROM"/forkop_${WANT_FORKOP:-*}_all."$EXT"
		if [ "$#" != 1 ] || [ ! -f "$1" ]; then
			fail 1 release "$(t '%s needs exactly one forkop_*_all.%s' 'В %s должен быть ровно один forkop_*_all.%s' "$FROM" "$EXT")"
		fi
		F_VERSION=$(field "$(control_of "$1")" Version)
		F_CORE_MIN=$(core_requirement "$(field "$(control_of "$1")" Depends)")
	fi
	# shellcheck disable=SC2231
	for file in "$FROM"/sing-box-forkop_${WANT_CORE:-*}_*_"$ARCH"."$EXT"; do
		[ -f "$file" ] || continue
		[ -z "$C_VERSION" ] || [ "$(field "$(control_of "$file")" Version)" = "$C_VERSION" ] ||
			fail 1 release "$(t '%s holds sing-box-forkop of several versions' 'В %s лежат sing-box-forkop разных версий' "$FROM")"
		C_VERSION=$(field "$(control_of "$file")" Version)
	done
	[ -n "$C_VERSION" ] || [ -n "$CORE_OLD" ] ||
		fail 1 release "$(t '%s has no sing-box-forkop for %s' 'В %s нет sing-box-forkop для %s' "$FROM" "$ARCH")"
	C_VERSION=${C_VERSION:-$CORE_OLD}
}

decide() { # what to install: FORKOP_ACTION, CORE_ACTION, the variant and the Russian translation
	local order target_forkop hint
	if [ "$CORE_ONLY" = 0 ]; then
		if [ -n "$I18N_OLD" ] || [ -n "$(pkg_version luci-i18n-base-ru)" ] || [ "$(uci -q get luci.main.lang)" = ru ]; then
			I18N=1
		fi
		RESULT_FORKOP=$F_VERSION
		if [ -n "$FORK_URL" ]; then
			# a fork goes whatever its version says: Forkop's packages take its place
			NEED_FORKOP=1 NEED_APP=1
			[ "$I18N" = 0 ] || NEED_I18N=1
		elif [ -n "$FORKOP_OLD" ] && [ "$(vercmp "$FORKOP_OLD" "$F_VERSION")" = 1 ] && [ -z "$WANT_FORKOP" ]; then
			warn newer "$(t 'Forkop %s is newer than the latest release %s and stays' 'Forkop %s новее последнего релиза %s и остаётся' "$FORKOP_OLD" "$F_VERSION")"
			RESULT_FORKOP=$FORKOP_OLD
		else
			[ -z "$FORKOP_OLD" ] || [ "$(vercmp "$FORKOP_OLD" "$F_VERSION")" != 1 ] || DOWNGRADE="Forkop $FORKOP_OLD -> $F_VERSION"
			# the page and its translation go with the backend they talk to
			[ "$FORKOP_OLD" = "$F_VERSION" ] || NEED_FORKOP=1
			[ "$NEED_FORKOP" = 0 ] && [ "$APP_OLD" = "$F_VERSION" ] || NEED_APP=1
			[ "$I18N" = 0 ] || { [ "$NEED_APP" = 0 ] && [ "$I18N_OLD" = "$F_VERSION" ]; } || NEED_I18N=1
		fi
		[ "$NEED_FORKOP$NEED_APP$NEED_I18N" = 000 ] || FORKOP_ACTION=install
		target_forkop=$RESULT_FORKOP
	else
		[ -z "$FORK_URL" ] || fail 1 incompatible "$(t 'Forkop %s here is a third-party build, which no core of this release is made for' 'Forkop %s здесь — сторонняя сборка, и ядро этого релиза не для неё' "$FORKOP_OLD")" \
			"$(t 'Run the installer without --core-only: it puts Forkop in its place' 'Запустите установщик без --core-only: он поставит Forkop на её место')"
		[ -n "$FORKOP_OLD" ] || warn no_forkop "$(t 'Forkop is not installed: only its core goes in' 'Forkop не установлен: ставлю только ядро')"
		target_forkop=$FORKOP_OLD RESULT_FORKOP=$FORKOP_OLD
		F_CORE_MIN=$(core_requirement "$(pkg_depends forkop)")
	fi

	if [ -n "$target_forkop" ] && [ -n "$C_FORKOP_MIN" ] && older "$target_forkop" "$C_FORKOP_MIN"; then
		if [ "$CORE_ONLY" = 1 ]; then
			hint=$(t 'Install both: run the installer without --core-only' 'Поставьте оба: запустите установщик без --core-only')
		else
			hint=$(t 'That Forkop is not released yet: run the installer later' 'Такой Forkop ещё не вышел: запустите установщик позже')
		fi
		fail 1 incompatible "$(t 'sing-box-forkop %s needs Forkop %s or newer, and the router would run Forkop %s' 'sing-box-forkop %s нужен Forkop %s или новее, а на роутере будет Forkop %s' "$C_VERSION" "$C_FORKOP_MIN" "$target_forkop")" "$hint"
	fi
	if [ -n "$F_CORE_MIN" ] && [ -n "$C_VERSION" ] && older "$C_VERSION" "$F_CORE_MIN"; then
		if [ -n "$FROM" ]; then
			hint=$(t 'Put sing-box-forkop %s or newer into %s' 'Положите sing-box-forkop %s или новее в %s' "$F_CORE_MIN" "$FROM")
		else
			hint=$(t 'That core is not released yet: run the installer later' 'Такое ядро ещё не вышло: запустите установщик позже')
		fi
		fail 1 incompatible "$(t 'Forkop %s needs sing-box-forkop %s or newer, and the release offers %s' 'Forkop %s нужен sing-box-forkop %s или новее, а в релизе %s' "$target_forkop" "$F_CORE_MIN" "$C_VERSION")" "$hint"
	fi

	if [ -n "$VARIANT" ]; then
		CORE_VARIANT=$VARIANT
	elif [ -n "$CORE_OLD" ]; then
		case "$CORE_OLD_VARIANT" in
		base | full | tiny) CORE_VARIANT=$CORE_OLD_VARIANT ;;
		*) CORE_VARIANT=custom ;;
		esac
	else
		CORE_VARIANT=base VARIANT_AUTO=1
		if [ -n "$FROM" ] && [ -z "$(local_file "sing-box-forkop_${C_VERSION}_base_${ARCH}.$EXT")" ]; then
			[ -z "$(local_file "sing-box-forkop_${C_VERSION}_tiny_${ARCH}.$EXT")" ] || CORE_VARIANT=tiny
			[ -z "$(local_file "sing-box-forkop_${C_VERSION}_full_${ARCH}.$EXT")" ] || [ "$CORE_VARIANT" = tiny ] || CORE_VARIANT=full
		elif [ -z "$FROM" ] && may_ask; then
			choose_variant
		fi
	fi
	if [ "$CORE_VARIANT" = custom ]; then
		if [ -n "$F_CORE_MIN" ] && older "$CORE_OLD" "$F_CORE_MIN"; then
			fail 1 incompatible "$(t 'The custom core %s is older than the %s Forkop needs' 'Своя сборка ядра %s старее нужной Forkop %s' "$CORE_OLD" "$F_CORE_MIN")" \
				"$(t 'Install an official one with --variant base, full or tiny, or build a newer one' 'Поставьте официальную через --variant base, full или tiny или соберите новее')"
		fi
		if [ -z "$FROM" ] && older "$CORE_OLD" "$C_VERSION"; then
			warn custom_outdated "$(t 'The custom core %s is older than the release %s' 'Своя сборка ядра %s старее релиза %s' "$CORE_OLD" "$C_VERSION")"
			if may_ask && ask "$(t 'Replace it with an official build?' 'Заменить её официальной сборкой?')"; then
				CORE_VARIANT=base VARIANT_AUTO=1
				choose_variant
			fi
		fi
	fi
	RESULT_CORE=$C_VERSION RESULT_VARIANT=$CORE_VARIANT
	if [ "$CORE_VARIANT" = custom ]; then
		ok "$(t 'The custom core %s stays as it is' 'Своя сборка ядра %s остаётся как есть' "$CORE_OLD")"
		RESULT_CORE=$CORE_OLD
	elif [ -z "$CORE_OLD" ]; then
		CORE_ACTION=install
	else
		order=$(vercmp "$CORE_OLD" "$C_VERSION")
		if [ "$order" = 1 ] && [ -z "$WANT_CORE" ] && [ "$CORE_VARIANT" = "$CORE_OLD_VARIANT" ]; then
			warn newer "$(t 'sing-box-forkop %s is newer than the latest release %s and stays' 'sing-box-forkop %s новее последнего релиза %s и остаётся' "$CORE_OLD" "$C_VERSION")"
			RESULT_CORE=$CORE_OLD
		elif [ "$order" != 0 ] || [ "$CORE_VARIANT" != "$CORE_OLD_VARIANT" ]; then
			CORE_ACTION=install
			[ "$order" != 1 ] || DOWNGRADE="${DOWNGRADE:+$DOWNGRADE, }sing-box-forkop $CORE_OLD -> $C_VERSION"
			[ "$order" != 0 ] || CORE_REINSTALL=1
		fi
	fi
	[ -z "$DOWNGRADE$FORK_URL" ] || OPKG_FLAGS=--force-downgrade
}

package_url() { # package_url KIND FILE
	if [ "$1" = core ]; then release_url "$CORE_REPO" "$C_TAG" "$2"; else release_url "$FORKOP_REPO" "$F_TAG" "$2"; fi
}

get_package() { # get_package KIND NAME: GOT is the verified file, downloaded or from --from
	local file sums="$F_SUMS"
	[ "$1" = core ] && sums=$C_SUMS
	GOT=''
	if [ -n "$FROM" ]; then
		file=$(local_file "$2")
		[ -n "$file" ] || fail 1 release "$(t '%s is not in %s' '%s нет в %s' "$2" "$FROM")"
		GOT=$file
		for sums in "$FROM"/SHA256SUMS*; do
			[ -f "$sums" ] || continue
			verify "$file" "$sums"
			case $? in
			0) return 0 ;;
			1) fail 1 checksum "$(t '%s does not match %s' '%s не совпадает с %s' "${file##*/}" "${sums##*/}")" ;;
			esac
		done
		warn unverified "$(t '%s is in no SHA256SUMS of %s and is not verified' '%s нет ни в одном SHA256SUMS из %s, он не проверен' "${file##*/}" "$FROM")"
		return 0
	fi
	if [ -z "$(checksum_of "$2" "$sums")" ]; then
		if [ "$1" = core ]; then
			fail 1 release "$(t 'sing-box-forkop %s has no %s build for %s' 'У sing-box-forkop %s нет сборки %s для %s' "$C_VERSION" "$CORE_VARIANT" "$ARCH")"
		fi
		fail 1 release "$(t 'Release %s has no %s' 'В релизе %s нет %s' "Forkop $F_VERSION" "$2")"
	fi
	file="$WORK/$2"
	if [ "$1" = core ]; then
		fetch_or_fail "$(package_url "$1" "$2")" "$file" "$2" "sing-box-forkop $C_VERSION"
	else
		fetch_or_fail "$(package_url "$1" "$2")" "$file" "$2" "Forkop $F_VERSION"
	fi
	if ! verify "$file" "$sums"; then
		if ! download "$(package_url "$1" "$2")" "$file" || ! verify "$file" "$sums"; then
			fail 1 checksum "$(t '%s does not match SHA256SUMS of its release' '%s не совпадает с SHA256SUMS своего релиза' "$2")"
		fi
	fi
	GOT=$file
}

local_file() { # the file in --from for a release name: that name, or for the core one of its variant and architecture
	local variant
	[ -f "$FROM/$1" ] && { printf '%s\n' "$FROM/$1"; return; }
	# a build between core releases names its file X.Y.Z-rN+K and its package X.Y.Z-rN
	case "$1" in sing-box-forkop_*) ;; *) return 0 ;; esac
	variant=${1#sing-box-forkop_*_}
	set -- "$FROM"/sing-box-forkop_*_"${variant%%_*}_${ARCH}.$EXT"
	[ -f "$1" ] && printf '%s\n' "$1"
}

need_ram_kb() { # what the downloads take in /tmp, the core's package by its build, with room for the package manager
	local kb=16384
	[ "$NEED_FORKOP$NEED_APP$NEED_I18N" = 000 ] || kb=$((kb + 1024))
	if [ "$CORE_ACTION" = install ]; then
		case "$CORE_VARIANT" in full) kb=$((kb + 24576)) ;; tiny) kb=$((kb + 10240)) ;; *) kb=$((kb + 12288)) ;; esac
	fi
	echo "$kb"
}

pause_forkop() { # the downloads take Forkop's RAM when they would not fit beside it
	local need free
	[ -z "$FROM" ] && [ "$FORKOP_RUNNING" = 1 ] || return 0
	need=$(need_ram_kb)
	free=$(mem_available_kb)
	[ "$free" -lt "$need" ] 2>/dev/null || return 0
	warn paused "$(t 'Only %s MB of RAM is available, and the downloads need about %s MB: Forkop is stopped while they run' 'Доступно всего %s МБ памяти, а загрузкам нужно около %s МБ: Forkop остановлен на время загрузки' "$(mb "$free")" "$(mb "$need")")"
	PAUSED=1
	deadline 90 /etc/init.d/forkop stop >>"$LOG" 2>&1
	log "paused Forkop: $(mem_available_kb) KB available now"
}

resume_forkop() { # Forkop back when the installation did not follow its pause
	[ "$PAUSED" = 1 ] && [ "$CHANGED" = 0 ] || return 0
	PAUSED=0
	if forkop_up; then
		ok "$(t 'Forkop runs again' 'Forkop снова запущен')"
	else
		warn not_started "$(t 'Forkop did not start again: run /etc/init.d/forkop start' 'Forkop не запустился снова: выполните /etc/init.d/forkop start')"
	fi
}

download_packages() {
	local count=0 kb=0 file
	step download "$(t 'Downloading the packages' 'Загрузка пакетов')"
	pause_forkop
	if [ "$NEED_FORKOP" = 1 ]; then
		get_package forkop "forkop_${F_VERSION}_all.$EXT"
		FILE_FORKOP=$GOT
	fi
	if [ "$NEED_APP" = 1 ]; then
		get_package forkop "luci-app-forkop_${F_VERSION}_all.$EXT"
		FILE_APP=$GOT
	fi
	if [ "$NEED_I18N" = 1 ]; then
		get_package forkop "luci-i18n-forkop-ru_${F_VERSION}_all.$EXT"
		FILE_I18N=$GOT
	fi
	if [ "$CORE_ACTION" = install ]; then
		get_package core "sing-box-forkop_${C_VERSION}_${CORE_VARIANT}_${ARCH}.$EXT"
		FILE_CORE=$GOT
	fi
	for file in $FILE_FORKOP $FILE_APP $FILE_I18N $FILE_CORE; do
		count=$((count + 1))
		kb=$((kb + $(file_kb "$file")))
	done
	if [ -n "$FROM" ]; then
		ok "$(t 'Files from %s: %s' 'Файлов из %s: %s' "$FROM" "$count")"
	else
		ok "$(t 'Files downloaded: %s (%s MB), their SHA256 sums match' 'Загружено файлов: %s (%s МБ), суммы SHA256 совпали' "$count" "$(mb "$kb")")"
	fi
}

# --- the plan -------------------------------------------------------------------------------

compression() { # percent of its size a package takes on the flash
	case "$FLASH_FS" in ubifs | jffs2) echo 60 ;; *) echo 105 ;; esac
}

check_space() { # whether the packages fit the flash; may fall back to tiny or plan freeing the old core
	local percent need=0 free credit=0 file size core_credit=0
	percent=$(compression)
	for file in $FILE_FORKOP $FILE_APP $FILE_I18N $FILE_CORE; do
		size=$(field "$(control_of "$file")" Installed-Size)
		is_number "$size" || size=$(($(file_kb "$file") * 1024 * 3))
		need=$((need + size * percent / 100 / 1024))
	done
	need=$((need + 1024))
	for file in $REMOVE_FILES $LEFTOVERS; do
		credit=$((credit + $(upper_kb "$file") * percent / 100))
	done
	if [ "$CORE_ACTION" = install ] && [ -e /usr/bin/sing-box ] && ! contains /usr/bin/sing-box "$REMOVE_FILES"; then
		core_credit=$(($(upper_kb /usr/bin/sing-box) * percent / 100))
		# apk writes the new file beside the old one; opkg deletes first, and so does apk for a
		# package it removes rather than upgrades
		if [ "$PM" = opkg ] || [ -z "$CORE_OLD" ]; then
			credit=$((credit + core_credit))
			core_credit=0
		fi
	fi
	free=$(free_kb "$FLASH_MOUNT")
	log "space: need $need KB, free $free KB, freed before $credit KB, old core $core_credit KB, $FLASH_FS $percent%"
	[ "$need" -le $((free + credit)) ] && return 0
	if [ "$core_credit" -gt 0 ] && [ "$need" -le $((free + credit + core_credit)) ]; then
		PREDELETE_CORE=1
		return 0
	fi
	if [ "$VARIANT_AUTO" = 1 ] && [ "$CORE_VARIANT" != tiny ]; then
		VARIANT_NOTE=$(t 'base needs %s MB of flash and %s MB are free: tiny goes in instead (no WireGuard, AmneziaWG, WARP, OpenVPN, TrustTunnel, VMess or AnyTLS)' \
			'для base нужно %s МБ флеша, а свободно %s МБ: ставлю tiny (без WireGuard, AmneziaWG, WARP, OpenVPN, TrustTunnel, VMess и AnyTLS)' "$(mb "$need")" "$(mb $((free + credit)))")
		[ -n "$FROM" ] || rm -f "$FILE_CORE"
		CORE_VARIANT=tiny RESULT_VARIANT=tiny
		get_package core "sing-box-forkop_${C_VERSION}_tiny_${ARCH}.$EXT"
		FILE_CORE=$GOT
		check_space
		return
	fi
	fail 1 no_space "$(t 'Not enough flash: the packages need %s MB, and %s MB are free' 'Не хватает флеша: пакетам нужно %s МБ, а свободно %s МБ' "$(mb "$need")" "$(mb $((free + credit + core_credit)))")" \
		"$(t 'Free some flash and run the installer again' 'Освободите место и запустите установщик снова')"
}

check_config() { # what the new package does with /etc/config/forkop, from its own migration code
	local root="$WORK/new" verdict='' status=1
	[ "$NEED_FORKOP" = 1 ] && [ -f /etc/config/forkop ] || return 0
	# a fork's config follows its own schema under the labels of Forkop's releases
	if [ -n "$FORK_URL" ]; then
		CONFIG_PLAN=reset CONFIG_FROM=foreign CONFIG_REASON=foreign
		return 0
	fi
	step migration "$(t 'Checking the config migration' 'Проверка переноса конфига')"
	if mkdir -p "$root" "$WORK/check" && cp /etc/config/forkop "$WORK/check/forkop"; then
		if [ "$EXT" = apk ]; then
			apk extract --allow-untrusted --no-chown --destination "$root" "$FILE_FORKOP" >>"$LOG" 2>&1
		else
			tar -xzOf "$FILE_FORKOP" ./data.tar.gz 2>/dev/null | tar -xzf - -C "$root" >>"$LOG" 2>&1
		fi
		verdict=$(ucode -L "$root/usr/lib/forkop" "$root/usr/lib/forkop/config/migration.uc" check "$WORK/check/forkop" 2>>"$LOG")
		status=$?
	fi
	log "migration check: $status $verdict"
	CONFIG_PLAN=$(printf '%s' "$verdict" | jsonfilter -e '@.result' 2>/dev/null)
	CONFIG_FROM=$(printf '%s' "$verdict" | jsonfilter -e '@.from' 2>/dev/null)
	CONFIG_REASON=$(printf '%s' "$verdict" | jsonfilter -e '@.reason' 2>/dev/null)
	CONFIG_WARNINGS=$(printf '%s' "$verdict" | jsonfilter -e '@.warnings[*]' 2>/dev/null)
	case "$status:$CONFIG_PLAN" in
	0:migrate | 0:current | 0:reset | 1:fail) ;;
	*)
		CONFIG_PLAN=unknown CONFIG_REASON=unchecked CONFIG_WARNINGS=''
		warn migration_check "$(t 'Forkop %s could not check this config in advance; the log has why' 'Forkop %s не смог заранее проверить этот конфиг, причина — в журнале' "$F_VERSION")"
		;;
	esac
	[ -n "$CONFIG_FROM" ] || CONFIG_FROM=${CONFIG_VERSION:-unknown}
	if [ "$CONFIG_PLAN" = fail ]; then
		fail 1 migration "$(t 'Forkop %s cannot migrate this config: %s. Nothing was changed' 'Forkop %s не сможет перенести этот конфиг: %s. Ничего не изменено' "$F_VERSION" "$CONFIG_REASON")" \
			"$(t 'Send the log to the Forkop chat; to start from a clean config, move /etc/config/forkop away and run the installer again' 'Пришлите журнал в чат Forkop; чтобы начать с чистого конфига, уберите /etc/config/forkop и запустите установщик снова')"
	fi
}

plan_removals() {
	local conflicts='' name file control
	if [ -n "$FILE_FORKOP" ]; then
		for name in $(dep_names "$(field "$(control_of "$FILE_FORKOP")" Conflicts)"); do
			[ -z "$(pkg_version "$name")" ] || conflicts="$conflicts $name"
		done
	fi
	for file in $FILE_CORE $FILE_FORKOP $FILE_APP $FILE_I18N; do
		control=$(control_of "$file")
		for name in $(dep_names "$(field "$control" Depends)"); do
			contains "$name" "$OUR_PACKAGES $DEPS_MISSING" || provided "$name" || DEPS_MISSING="$DEPS_MISSING $name"
		done
	done
	DEPS_MISSING=${DEPS_MISSING# }
	[ "$CORE_ACTION" = install ] || [ -n "$FOREIGN_PKGS$FOREIGN_FILES" ] || [ -n "$conflicts" ] || return 0
	REMOVE_PKGS=$(dependents "$conflicts $FOREIGN_PKGS")
	REMOVE_FILES=${FOREIGN_FILES# }
	# a core whose package stays owns these files and goes on running
	[ "$CORE_ACTION" = install ] || [ -z "$CORE_OLD" ] || REMOVE_FILES=''
}

dry_run() { # every package manager command apply runs, simulated
	local out="$WORK/dry-run" name
	step dry_run "$(t 'Trying the transaction' 'Пробная транзакция')"
	update_lists
	if [ -n "$DEPS_MISSING" ]; then
		# shellcheck disable=SC2086
		if [ "$PM" = apk ]; then
			capture "$out.deps" apk add --simulate $DEPS_MISSING
		else
			capture "$out.deps" opkg --noaction install $DEPS_MISSING
		fi || fail 1 dry_run "$(t 'The package manager refuses to install %s:' 'Пакетный менеджер отказывается ставить %s:' "$DEPS_MISSING") $(pm_errors "$out.deps")" \
			"$([ "$LISTS_FAILED" = 0 ] || network_hint)"
	fi
	set --
	for name in "$FILE_CORE" "$FILE_FORKOP" "$FILE_APP" "$FILE_I18N"; do [ -z "$name" ] || set -- "$@" "$name"; done
	if [ "$PM" = apk ]; then
		for name in $(apk_constraints); do set -- "$@" "$name"; done
		capture "$out" apk add --simulate --allow-untrusted "$@" ||
			fail 1 dry_run "$(t 'The package manager refuses the transaction:' 'Пакетный менеджер отказывает в транзакции:') $(pm_errors "$out")" \
				"$([ "$LISTS_FAILED" = 0 ] || network_hint)"
	else
		if [ -n "$REMOVE_PKGS" ]; then
			# shellcheck disable=SC2046
			capture "$out.remove" opkg --noaction --force-depends remove $(removal_order "$REMOVE_PKGS") ||
				fail 1 dry_run "$(t 'opkg refuses to remove %s:' 'opkg отказывается удалить %s:' "$REMOVE_PKGS") $(pm_errors "$out.remove")"
		fi
		# opkg reports a conflict for a file of a package it would replace when it only pretends
		# to, and returns 0 when it skips a file whose dependencies fail: the output decides
		# shellcheck disable=SC2086
		capture "$out" opkg --noaction --force-depends --force-overwrite --force-space $OPKG_FLAGS install "$@"
		if grep -q -e 'cannot find dependency' -e 'Cannot satisfy' -e 'incompatible with the arch' "$out"; then
			fail 1 dry_run "$(t 'opkg cannot satisfy the dependencies:' 'opkg не может удовлетворить зависимости:') $(grep -m 3 -e 'cannot find dependency' -e 'Cannot satisfy' -e incompatible "$out" | tr '\n' ' ')" \
				"$([ "$LISTS_FAILED" = 0 ] || network_hint)"
		fi
		for name in $(packages_in_transaction); do
			grep -q -e "^Installing $name (" -e "^Upgrading $name on " -e "^Downgrading $name on " -e "^Removing package $name from" "$out" ||
				fail 1 dry_run "$(t 'opkg would not install %s:' 'opkg не стал бы ставить %s:' "$name") $(pm_errors "$out")"
		done
	fi
	ok "$(t 'The package manager accepts the transaction' 'Пакетный менеджер принимает транзакцию')"
}

apk_constraints() { # what the world gets for apk to drop the packages that go
	local name
	for name in $REMOVE_PKGS $FOREIGN_WORLD; do
		# sing-box-forkop provides sing-box, so a conflict with that name would be one with itself;
		# left unversioned, the name goes to it instead of the package of that name
		if [ "$name" = sing-box ]; then echo sing-box; else echo "!$name"; fi
	done
}

packages_in_transaction() {
	[ -z "$FILE_CORE" ] || [ "$CORE_REINSTALL" = 1 ] || echo sing-box-forkop
	[ -z "$FILE_FORKOP" ] || echo forkop
	[ -z "$FILE_APP" ] || echo luci-app-forkop
	[ -z "$FILE_I18N" ] || echo luci-i18n-forkop-ru
}

update_lists() { # feed indexes, when a dependency has to come from them
	[ -n "$DEPS_MISSING" ] || return 0
	if [ -n "$FROM" ]; then
		fail 1 dry_run "$(t 'Missing dependencies that only the feeds have: %s' 'Не хватает зависимостей, которые есть только в фидах: %s' "$DEPS_MISSING")" \
			"$(t 'Install them first, or run the installer without --from' 'Поставьте их сначала или запустите установщик без --from')"
	fi
	if ! run "$PM" update; then
		LISTS_FAILED=1
		warn lists "$(t 'Some package lists did not update' 'Часть списков пакетов не обновилась')"
	fi
}

print_plan() {
	local line name core_from=''
	[ -z "$CORE_OLD" ] || core_from="sing-box-forkop $CORE_OLD ($CORE_OLD_VARIANT)"
	[ -n "$core_from" ] || core_from=$CORE_DESC
	if [ "$JSON" = 1 ]; then
		emit plan forkop "${FORKOP_OLD:-none} -> $RESULT_FORKOP" core "${core_from:-none} -> sing-box-forkop $RESULT_CORE" \
			variant "$RESULT_VARIANT" config "$CONFIG_PLAN"
	else
		printf '\n%s\n' "$(t 'Plan:' 'План:')"
	fi
	if [ "$CORE_ACTION" = install ]; then
		line="sing-box-forkop $C_VERSION, $(t 'build' 'сборка') $CORE_VARIANT"
		[ -z "$core_from" ] || line="$core_from → $line"
		plan_line "$(t 'core' 'ядро')" "$line"
		[ -z "$VARIANT_NOTE" ] || warn tiny "$VARIANT_NOTE"
	fi
	if [ "$NEED_FORKOP" = 1 ]; then
		line="$F_VERSION"
		[ -z "$FORKOP_OLD" ] || line="$FORKOP_OLD → $F_VERSION"
		[ -z "$FORK_URL" ] || line="$(t 'third-party build %s, %s → Forkop %s' 'сторонняя сборка %s, %s → Forkop %s' "$FORKOP_OLD" "${FORK_URL#https://}" "$F_VERSION")"
		[ "$NEED_I18N" = 0 ] || line="$line, $(t 'with the Russian translation' 'с русским переводом')"
		plan_line Forkop "$line"
	elif [ "$NEED_APP" = 1 ]; then
		plan_line Forkop "$(t 'its LuCI page %s' 'его страница LuCI %s' "$F_VERSION")"
	elif [ "$NEED_I18N" = 1 ]; then
		plan_line Forkop "$(t 'the Russian translation of its page' 'русский перевод его страницы')"
	fi
	case "$CONFIG_PLAN" in
	migrate) plan_line "$(t 'config' 'конфиг')" "$(t 'migrates from %s' 'перенесётся из %s' "$CONFIG_FROM")" ;;
	reset) plan_line "$(t 'config' 'конфиг')" "$(t 'starts clean: %s; the old one is kept as /etc/config/forkop.%s-<date>' 'будет чистым: %s; старый сохранится как /etc/config/forkop.%s-<дата>' "$(config_reason)" "$(file_label "$CONFIG_FROM")")" ;;
	unknown) plan_line "$(t 'config' 'конфиг')" "$(t 'migrates if Forkop %s can, otherwise starts clean and the old one is kept as /etc/config/forkop.%s-<date>' 'перенесётся, если Forkop %s сможет, иначе будет чистым, а старый сохранится как /etc/config/forkop.%s-<дата>' "$F_VERSION" "$(file_label "$CONFIG_FROM")")" ;;
	esac
	printf '%s\n' "$CONFIG_WARNINGS" | while IFS= read -r line; do
		[ -z "$line" ] || warn migration_note "$(t 'Migration: %s' 'Перенос: %s' "$line")"
	done
	[ -z "$DOWNGRADE" ] || plan_line "$(t 'downgrade' 'откат')" "$DOWNGRADE"
	for name in $REMOVE_PKGS; do
		plan_line "$(t 'remove' 'удалю')" "$(t 'package %s' 'пакет %s' "$name") ($(removal_reason "$name"))"
	done
	for name in $REMOVE_FILES; do
		plan_line "$(t 'remove' 'удалю')" "$name ($(t 'sing-box of no package' 'sing-box без пакета'))"
	done
	[ -z "$LEFTOVERS" ] || plan_line "$(t 'clean' 'уберу')" "$(t 'what Forkop 1.0.x left about its core:' 'остатки ядра от Forkop 1.0.x:')$LEFTOVERS"
	[ "$JSON" = 1 ] || echo
}

plan_line() { # plan_line LABEL TEXT, LABEL padded by characters: printf pads bytes, and Cyrillic takes two
	local width
	log "plan: $1 $2"
	[ "$JSON" = 0 ] || return 0
	width=$(printf '%s' "$1" | tr -d '\200-\277' | wc -c)
	printf '  %s%*s %s\n' "$1" $((width < 9 ? 9 - width : 0)) '' "$2"
}

config_reason() {
	case "$CONFIG_REASON" in
	missing) t 'it has no version' 'в нём нет версии' ;;
	invalid | unknown) t 'its version is unknown' 'его версия неизвестна' ;;
	below_min)
		if [ -n "$F_MIN_CONFIG" ]; then
			t 'it is from a Forkop older than %s' 'он от версии Forkop ниже %s' "$F_MIN_CONFIG"
		else
			t 'it is from a Forkop too old to migrate from' 'он от слишком старого Forkop'
		fi
		;;
	newer) t 'it is from a newer Forkop' 'он от более нового Forkop' ;;
	unchecked) t 'it could not be checked in advance' 'его не удалось проверить заранее' ;;
	foreign) t 'it is from a third-party build of Forkop' 'он от сторонней сборки Forkop' ;;
	*) printf '%s' "$CONFIG_REASON" ;;
	esac
}

removal_reason() {
	if contains "$1" "$FOREIGN_CORES $FOREIGN_PKGS"; then
		t 'another sing-box' 'чужой sing-box'
	elif [ -n "$FILE_FORKOP" ] && contains "$1" "$(dep_names "$(field "$(control_of "$FILE_FORKOP")" Conflicts)" | tr '\n' ' ')"; then
		t 'does not work together with Forkop' 'не работает вместе с Forkop'
	else
		t 'needs what goes away' 'зависит от удаляемого'
	fi
}

consent() {
	local name
	[ -n "$REMOVE_PKGS$REMOVE_FILES$DOWNGRADE$FORK_URL" ] || [ "$CONFIG_PLAN" = reset ] || [ "$CONFIG_PLAN" = unknown ] || return 0
	[ "$YES" = 0 ] || { ok "$(t 'Agreed with --yes' 'Согласие дано флагом --yes')"; return 0; }
	if [ "$INTERACTIVE" = 1 ] && [ "$DRY_RUN" = 0 ]; then
		ask "$(t 'Continue with the plan above?' 'Продолжить по плану выше?')" && return 0
		fail 1 declined "$(t 'Nothing was changed' 'Ничего не изменено')"
	fi
	if [ "$JSON" = 1 ]; then
		[ -z "$FORK_URL" ] || emit consent code replace_package name forkop text "a third-party build of Forkop $FORKOP_OLD, $FORK_URL"
		for name in $REMOVE_PKGS; do emit consent code remove_package name "$name" text "$(removal_reason "$name")"; done
		for name in $REMOVE_FILES; do emit consent code remove_file name "$name" text "sing-box of no package"; done
		case "$CONFIG_PLAN" in reset | unknown) emit consent code reset_config name /etc/config/forkop text "$(config_reason)" ;; esac
		[ -z "$DOWNGRADE" ] || emit consent code downgrade name "$DOWNGRADE" text "$DOWNGRADE"
	fi
	if [ "$DRY_RUN" = 1 ]; then
		fail 3 consent_required "$(t 'Dry run: nothing was changed. The installer asks before it removes, resets or downgrades what is listed above, and --yes agrees in advance' 'Пробный запуск: ничего не изменено. Прежде чем удалить, сбросить или откатить перечисленное выше, установщик спросит согласия; --yes даёт его заранее')"
	fi
	fail 3 consent_required "$(t 'The plan removes, resets or downgrades what is listed above: run the installer again with --yes to agree' 'План удаляет, сбрасывает или откатывает перечисленное выше: чтобы согласиться, запустите установщик снова с --yes')"
}

# --- changes --------------------------------------------------------------------------------

config_copies() { # the copies of /etc/config/forkop there are now, one per line
	ls -d /etc/config/forkop.* 2>/dev/null
}

file_label() { # a config version as the package writes it into the name of a copy
	printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

backup_config() { # a copy that guards the transaction; the package keeps its own where it should
	local copy
	config_copies >"$WORK/copies"
	[ -f /etc/config/forkop ] && [ "$NEED_FORKOP" = 1 ] || return 0
	copy="/etc/config/forkop.$(file_label "${CONFIG_FROM:-unknown}")-$(date +%Y%m%d-%H%M%S)"
	if [ -n "$FORK_URL" ]; then
		# Forkop's package would read a fork's config as one of its own releases: it starts from its defaults
		step backup "$(t 'Setting the config of the third-party build aside' 'Конфиг сторонней сборки откладывается')"
		mv /etc/config/forkop "$copy" 2>>"$LOG" || fail 1 backup "$(t 'Cannot move /etc/config/forkop' 'Не удалось переместить /etc/config/forkop')"
		BACKUP=$copy
		log "set aside: $BACKUP"
		return 0
	fi
	step backup "$(t 'Copying the config for the installation' 'Копия конфига на время установки')"
	cp -p /etc/config/forkop "$copy" 2>>"$LOG" || fail 1 backup "$(t 'Cannot copy /etc/config/forkop' 'Не удалось скопировать /etc/config/forkop')"
	BACKUP=$copy
	log "backup: $BACKUP"
}

install_dependencies() {
	[ -n "$DEPS_MISSING" ] || return 0
	step dependencies "$(t 'Installing dependencies from the OpenWrt feeds: %s' 'Установка зависимостей из фидов OpenWrt: %s' "$DEPS_MISSING")"
	# shellcheck disable=SC2086
	run "$PM" "$([ "$PM" = apk ] && echo add || echo install)" $DEPS_MISSING ||
		fail 4 dependencies "$(t 'Cannot install %s from the feeds; Forkop and its core were not touched' 'Не удалось поставить %s из фидов; Forkop и ядро не тронуты' "$DEPS_MISSING")" "$(network_hint)"
	refresh_db
}

stop_cores() {
	local pids try
	for try in 1 2 3 4 5 6 7 8 9 10; do
		pids=$(pidof sing-box sing-box-core 2>/dev/null)
		[ -n "$pids" ] || return 0
		# shellcheck disable=SC2086
		kill $pids 2>/dev/null
		sleep 1
	done
	# shellcheck disable=SC2046
	kill -9 $(pidof sing-box sing-box-core 2>/dev/null) 2>/dev/null
}

stop_services() {
	[ -x /etc/init.d/forkop ] || [ -x /etc/init.d/sing-box ] || pidof sing-box sing-box-core >/dev/null 2>&1 || return 0
	step stop "$(t 'Stopping Forkop and sing-box' 'Остановка Forkop и sing-box')"
	[ ! -x /etc/init.d/forkop ] || deadline 90 /etc/init.d/forkop stop >>"$LOG" 2>&1
	[ ! -x /etc/init.d/sing-box ] || deadline 30 /etc/init.d/sing-box stop >>"$LOG" 2>&1
	stop_cores
}

remove_files() {
	local file
	[ -n "$REMOVE_FILES$LEFTOVERS" ] || return 0
	for file in $REMOVE_FILES $LEFTOVERS; do
		rm -f "$file" && log "removed $file"
	done
}

predelete_core() { # apk upgrades by writing beside the old file: make room first, a compressed copy in RAM
	[ "$PREDELETE_CORE" = 1 ] || return 0
	# /tmp is RAM, and its df counts what tmpfs may grow to: MemAvailable is what is free
	if [ $(($(file_kb /usr/bin/sing-box) / 2 + 16384)) -lt "$(mem_available_kb)" ] &&
		gzip -1 -c /usr/bin/sing-box >"$WORK/sing-box.old.gz" 2>/dev/null; then
		log "a compressed copy of the old core is in RAM until the transaction ends"
	else
		rm -f "$WORK/sing-box.old.gz"
		log "no copy of the old core: RAM is short"
	fi
	rm -f /usr/bin/sing-box
	log "removed the old core to make room for the new one"
}

restore_core() {
	[ "$PREDELETE_CORE" = 1 ] && [ ! -e /usr/bin/sing-box ] && [ -f "$WORK/sing-box.old.gz" ] || return 0
	gzip -dc "$WORK/sing-box.old.gz" >/usr/bin/sing-box && chmod 0755 /usr/bin/sing-box && log "restored the old core"
}

transaction() {
	local out="$WORK/transaction" name status=0 order
	step install "$(t 'Installing' 'Установка')"
	set --
	for name in "$FILE_CORE" "$FILE_FORKOP" "$FILE_APP" "$FILE_I18N"; do [ -z "$name" ] || set -- "$@" "$name"; done
	if [ "$PM" = apk ]; then
		for name in $(apk_constraints); do set -- "$@" "$name"; done
		capture "$out" apk add --allow-untrusted "$@" || status=$?
		# shellcheck disable=SC2046
		world_drop $(apk_constraints)
	else
		if [ -n "$REMOVE_PKGS" ]; then
			order=$(removal_order "$REMOVE_PKGS")
			# what still needs a foreign core's sing-box gets it from sing-box-forkop within this run
			# shellcheck disable=SC2086
			capture "$out.remove" opkg --force-depends remove $order || status=$?
		fi
		if [ "$status" = 0 ] && [ "$CORE_REINSTALL" = 1 ] && [ -n "$FILE_CORE" ]; then
			capture "$out.core" opkg install --force-reinstall --force-overwrite --force-space "$FILE_CORE" || status=$?
			shift
		fi
		# shellcheck disable=SC2086
		[ "$status" != 0 ] || [ "$#" = 0 ] || capture "$out" opkg install --force-overwrite --force-space $OPKG_FLAGS "$@" || status=$?
	fi
	refresh_db
	check_installed "$status"
}

opkg_unpacked() { # opkg left package $1 unpacked: its postinst failed
	[ "$PM" = opkg ] && awk -v p="$1" '/^Package: / { n = $2 } /^Status: / && n == p && / unpacked$/ { found = 1 } END { exit !found }' /usr/lib/opkg/status
}

check_installed() { # what the transaction left, against what it was to install
	local problems='' name version reason
	[ -z "$FILE_CORE" ] || [ "$(pkg_version sing-box-forkop)" = "$(field "$(control_of "$FILE_CORE")" Version)" ] || problems="$problems sing-box-forkop"
	[ -z "$FILE_CORE" ] || [ "$(cat /usr/share/sing-box-forkop/variant 2>/dev/null)" = "$CORE_VARIANT" ] || problems="$problems sing-box-forkop"
	[ -z "$FILE_FORKOP" ] || [ "$(pkg_version forkop)" = "$F_VERSION" ] || problems="$problems forkop"
	[ -z "$FILE_APP" ] || [ "$(pkg_version luci-app-forkop)" = "$F_VERSION" ] || problems="$problems luci-app-forkop"
	[ -z "$FILE_I18N" ] || [ "$(pkg_version luci-i18n-forkop-ru)" = "$F_VERSION" ] || problems="$problems luci-i18n-forkop-ru"
	for name in $REMOVE_PKGS; do
		[ -z "$(pkg_version "$name")" ] || problems="$problems $name"
	done
	if [ -z "$problems" ] && [ "$1" = 0 ]; then
		ok "$(t 'Installed' 'Установлено')"
		return 0
	fi
	restore_core
	version=$(pkg_version forkop)
	if [ -n "$FILE_FORKOP" ] && { opkg_unpacked forkop || { [ "$version" = "$F_VERSION" ] && [ "$1" != 0 ]; }; }; then
		reason=$(logread -e forkop 2>/dev/null | grep '\[error\]' | tail -n 1 | sed 's/.*\[error\] *//')
		fail 4 transaction "$(t 'Forkop %s is installed, but setting it up failed: %s. Its old config is left as it was' 'Forkop %s установлен, но его настройка не удалась: %s. Старый конфиг оставлен как был' "$F_VERSION" "${reason:-$(t 'see logread -e forkop' 'см. logread -e forkop')}")" \
			"$(t 'Send logread -e forkop to the Forkop chat; to start from a clean config, move /etc/config/forkop away and run the installer again' 'Пришлите вывод logread -e forkop в чат Forkop; чтобы начать с чистого конфига, уберите /etc/config/forkop и запустите установщик снова')$(start_again)"
	fi
	fail 4 transaction "$(t 'The package manager did not finish:%s is not as planned' 'Пакетный менеджер не закончил: не так, как в плане:%s' "$problems")" \
		"$(t 'The log has its output; run the installer again once the reason is fixed' 'Его вывод — в журнале; исправьте причину и запустите установщик снова')$(start_again)"
}

start_again() { # after a failed transaction a Forkop that ran before runs again on what is installed now
	[ "$FORKOP_RUNNING" = 1 ] && [ -x /etc/init.d/forkop ] || return 0
	if deadline 150 /etc/init.d/forkop start >>"$LOG" 2>&1; then
		t '. Forkop runs again, on what is installed now' '. Forkop снова запущен, на том, что сейчас установлено'
	else
		t '. Forkop did not start again: logread -e forkop' '. Forkop снова не запустился: logread -e forkop'
	fi
}

clean_up_after() {
	local file
	for file in $CONFFILE_COPIES; do
		[ ! -e "$file" ] || rm -f "$file"
	done
	if [ -n "$BACKUP" ] && [ -z "$FORK_URL" ]; then
		rm -f "$BACKUP" && log "removed $BACKUP: the transaction went through"
	fi
	# what the package set aside: it keeps a config it replaces, and one it migrated past the label
	BACKUP=$(config_copies | awk -v before="$WORK/copies" 'BEGIN { while ((getline line < before) > 0) seen[line] = 1 } !($0 in seen)' | tail -n 1)
	# shellcheck disable=SC2086
	[ "$PM" != apk ] || [ -z "$DEPS_MISSING" ] || world_drop $DEPS_MISSING
}

forkop_up() { # start Forkop and wait for it to run: 0 once it does
	local waited=0
	deadline 150 /etc/init.d/forkop start >>"$LOG" 2>&1
	while :; do
		case "$(deadline 15 /usr/bin/forkop get_status 2>/dev/null | jsonfilter -e '@.running' 2>/dev/null)" in 1 | true) return 0 ;; esac
		[ "$waited" -lt 30 ] || return 1
		sleep 3
		waited=$((waited + 3))
	done
}

start_forkop() {
	local pid exe version
	[ -x /etc/init.d/forkop ] || return 0
	[ "$FORKOP_ENABLED" = 0 ] || run /etc/init.d/forkop enable
	if [ "$FORKOP_RUNNING" = 0 ]; then
		[ -n "$FORKOP_OLD" ] || detail "$(t 'Forkop is not started: set it up in LuCI, Services, Forkop' 'Forkop не запущен: настройте его в LuCI, Службы → Forkop')"
		return 0
	fi
	# the defaults have nothing to run: a reset config waits for its owner
	if cmp -s /etc/config/forkop /usr/share/forkop/default-config; then
		warn not_started "$(t 'Forkop is not started: its config starts clean; set it up in LuCI, Services, Forkop' 'Forkop не запущен: его конфиг начат заново, настройте его в LuCI, Службы → Forkop')"
		return 0
	fi
	step start "$(t 'Starting Forkop' 'Запуск Forkop')"
	if ! forkop_up; then
		fail 5 service "$(t 'Forkop is installed but did not start:' 'Forkop установлен, но не запустился:') $(logread -e forkop 2>/dev/null | grep -i error | tail -n 1 | sed 's/.*\]: //')" \
			"$(t 'The reason is in: logread -e forkop' 'Причина в журнале: logread -e forkop')"
	fi
	pid=$(pidof sing-box | awk '{ print $1 }')
	exe=$(readlink "/proc/$pid/exe" 2>/dev/null)
	version=$(sing_box_version /usr/bin/sing-box)
	if [ -z "$pid" ] || [ "$exe" != /usr/bin/sing-box ]; then
		fail 5 service "$(t 'Forkop runs, but sing-box does not' 'Forkop работает, а sing-box нет')" "$(t 'The reason is in: logread -e forkop' 'Причина в журнале: logread -e forkop')"
	fi
	ok "$(t 'Forkop runs on sing-box-forkop %s (%s)' 'Forkop работает на sing-box-forkop %s (%s)' "$version" "$(cat /usr/share/sing-box-forkop/variant 2>/dev/null)")"
}

apply() {
	trap '' INT TERM HUP PIPE
	backup_config
	CHANGED=1
	install_dependencies
	stop_services
	remove_files
	predelete_core
	transaction
	clean_up_after
	start_forkop
	summary
}

summary() {
	local file
	[ "$JSON" = 1 ] && finish 0
	echo
	if [ "$FORKOP_ACTION" = install ] || [ "$CORE_ACTION" = install ]; then
		say '[+]' "$C_OK" "$(t 'Done: Forkop %s, sing-box-forkop %s (%s)' 'Готово: Forkop %s, sing-box-forkop %s (%s)' "${RESULT_FORKOP:-$(t 'not installed' 'не установлен')}" "$RESULT_CORE" "$RESULT_VARIANT")"
	fi
	[ -z "$BACKUP" ] || detail "$(t 'The config from before is kept as %s' 'Конфиг до установки сохранён как %s' "$BACKUP")"
	for file in $OTHER_CONFIGS; do
		detail "$(t 'The settings of %s stay in %s' 'Настройки %s остались в %s' "${file##*/}" "$file")"
	done
	[ -z "$(pkg_version luci-app-forkop)" ] || detail "$(t 'LuCI: Services, Forkop' 'LuCI: Службы → Forkop')"
	finish 0
}

# --- removal --------------------------------------------------------------------------------

uninstall() {
	local packages='' name file out="$WORK/remove"
	step checks "$(t 'Checking what is installed' 'Проверка установленного')"
	refresh_db
	for name in luci-i18n-forkop-ru luci-app-forkop forkop sing-box-forkop; do
		[ -z "$(pkg_version "$name")" ] || packages="$packages $name"
	done
	packages=${packages# }
	[ -n "$packages" ] || {
		ok "$(t 'Forkop is not installed' 'Forkop не установлен')"
		finish 0
	}
	ok "$(t 'To remove: %s' 'Удалю: %s' "$packages")"
	if [ "$PURGE" = 0 ] && [ "$INTERACTIVE" = 1 ] && [ "$DRY_RUN" = 0 ]; then
		ask "$(t 'Delete the settings of Forkop too?' 'Удалить и настройки Forkop?')" && PURGE=1
	fi
	[ "$PURGE" = 0 ] || ok "$(t 'The settings go too: /etc/config/forkop, /etc/forkop, /etc/config/sing-box, /etc/sing-box' 'Настройки тоже: /etc/config/forkop, /etc/forkop, /etc/config/sing-box, /etc/sing-box')"
	[ "$DRY_RUN" = 0 ] || finish 0
	trap '' INT TERM HUP PIPE
	CHANGED=1
	step stop "$(t 'Stopping Forkop' 'Остановка Forkop')"
	[ ! -x /etc/init.d/forkop ] || deadline 90 /etc/init.d/forkop stop >>"$LOG" 2>&1
	[ ! -x /etc/init.d/sing-box ] || deadline 30 /etc/init.d/sing-box stop >>"$LOG" 2>&1
	step remove "$(t 'Removing the packages' 'Удаление пакетов')"
	if [ "$PM" = apk ]; then
		# shellcheck disable=SC2086
		capture "$out" apk del $packages
	else
		# shellcheck disable=SC2086
		capture "$out" opkg remove $packages
	fi
	refresh_db
	for name in $packages; do
		[ -z "$(pkg_version "$name")" ] ||
			fail 4 transaction "$(t '%s was not removed:' '%s не удалён:' "$name") $(grep -m 2 -e ERROR -e '\*' "$out" | tr '\n' ' ')"
	done
	if [ "$PURGE" = 1 ]; then
		for file in /etc/config/forkop /etc/config/forkop.* /etc/config/forkop-opkg /etc/forkop /etc/config/sing-box /etc/config/sing-box-opkg /etc/sing-box; do
			[ ! -e "$file" ] || rm -rf "$file"
		done
	fi
	ok "$(t 'Forkop is removed' 'Forkop удалён')"
	[ "$PURGE" = 1 ] || [ ! -f /etc/config/forkop ] || detail "$(t 'Its settings stay in /etc/config/forkop' 'Его настройки остались в /etc/config/forkop')"
	finish 0
}

# --- main -----------------------------------------------------------------------------------

parse_args() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
		--core-only) CORE_ONLY=1 ;;
		--variant | --from | --version | --core-version | --lang)
			[ "$#" -ge 2 ] || usage_error "$1 needs a value"
			case "$1" in
			--variant) VARIANT=$2 ;;
			--from) FROM=$2 ;;
			--version) WANT_FORKOP=$2 ;;
			--core-version) WANT_CORE=${2#v} ;;
			--lang) LANG_OPT=$2 ;;
			esac
			shift
			;;
		--variant=*) VARIANT=${1#*=} ;;
		--from=*) FROM=${1#*=} ;;
		--version=*) WANT_FORKOP=${1#*=} ;;
		--core-version=*) WANT_CORE=${1#*=}; WANT_CORE=${WANT_CORE#v} ;;
		--lang=*) LANG_OPT=${1#*=} ;;
		--uninstall) MODE=uninstall ;;
		--purge) PURGE=1 ;;
		--dry-run) DRY_RUN=1 ;;
		-y | --yes) YES=1 ;;
		--json) JSON=1 ;;
		-h | --help) usage; exit 0 ;;
		*) usage_error "unknown option: $1" ;;
		esac
		shift
	done
	case "$VARIANT" in '' | base | full | tiny) ;; *) usage_error "--variant takes base, full or tiny" ;; esac
	case "$LANG_OPT" in '' | ru | en) ;; *) usage_error "--lang takes ru or en" ;; esac
	case "$WANT_FORKOP" in '' | [0-9]*.[0-9]*.[0-9]*) ;; *) usage_error "--version takes X.Y.Z" ;; esac
	case "$WANT_CORE" in '' | [0-9]*.[0-9]*.[0-9]*-r[0-9]*) ;; *) usage_error "--core-version takes X.Y.Z-rN" ;; esac
	[ "$PURGE" = 0 ] || [ "$MODE" = uninstall ] || usage_error "--purge goes with --uninstall"
	if [ "$MODE" = uninstall ] && [ -n "$VARIANT$FROM$WANT_FORKOP$WANT_CORE" ]; then
		usage_error "--uninstall takes no --variant, --from, --version or --core-version"
	fi
	[ "$CORE_ONLY" = 0 ] || [ -z "$WANT_FORKOP" ] || usage_error "--core-only takes no --version"
	if [ -n "$FROM" ]; then
		case "$FROM" in /*) ;; *) FROM="$(pwd)/$FROM" ;; esac
		FROM=${FROM%/}
	fi
}

main() {
	parse_args "$@"
	( : >"$LOG" ) 2>/dev/null || LOG=/dev/null
	log "install.sh $* ($(date))"
	setup_output
	trap on_signal INT TERM HUP
	[ "$(id -u)" = 0 ] || fail 1 not_root "Run the installer as root"
	[ -r /etc/openwrt_release ] || fail 1 not_openwrt "This installer is for OpenWrt"
	detect_package_manager
	WORK=$(mktemp -d /tmp/forkop-install.XXXXXX) || fail 1 no_memory "Cannot create a directory in /tmp"
	refresh_db
	pick_language
	lock
	[ "$JSON" = 1 ] || printf '%sForkop%s · %s\n\n' "$C_STEP" "$C_OFF" "$(t 'installer' 'установщик')"
	if [ "$MODE" = uninstall ]; then
		uninstall
	fi
	check_system
	read_state
	report_state
	resolve_release
	if [ "$FORKOP_ACTION" = none ] && [ "$CORE_ACTION" = none ]; then
		# --core-only looks at no Forkop release, and a custom core at no core release
		if [ "$CORE_VARIANT" = custom ] && [ "$CORE_ONLY" = 1 ]; then
			ok "$(t 'Nothing to install' 'Ставить нечего')"
		elif [ "$CORE_VARIANT" = custom ]; then
			ok "$(t 'Forkop %s is up to date' 'Forkop %s — последняя версия' "$RESULT_FORKOP")"
		elif [ "$CORE_ONLY" = 1 ]; then
			ok "$(t 'sing-box-forkop %s is up to date' 'sing-box-forkop %s — последняя версия' "$RESULT_CORE")"
		else
			ok "$(t 'Forkop %s and sing-box-forkop %s are up to date' 'Forkop %s и sing-box-forkop %s — последние версии' "$RESULT_FORKOP" "$RESULT_CORE")"
		fi
		finish 0
	fi
	download_packages
	plan_removals
	check_space
	check_config
	dry_run
	print_plan
	consent
	if [ "$DRY_RUN" = 1 ]; then
		ok "$(t 'Dry run: nothing was changed' 'Пробный запуск: ничего не изменено')"
		finish 0
	fi
	apply
}

main "$@"
