#!/bin/sh
set -eu
core="$1"
work="$2"
core_pid=''
http_pid=''
cleanup() {
    [ -z "$core_pid" ] || kill "$core_pid" 2>/dev/null || true
    [ -z "$http_pid" ] || kill "$http_pid" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
"$core" check -c "$work/native.json" >"$work/check.log" 2>&1 || { cat "$work/check.log"; exit 1; }
if command -v uhttpd >/dev/null 2>&1; then
    uhttpd -f -p 127.0.0.1:29089 -h "$work" >"$work/http.log" 2>&1 &
else
    node -e 'require("http").createServer((q,r)=>r.end("forkop-native-runtime-ok\n")).listen(29089,"127.0.0.1")' >"$work/http.log" 2>&1 &
fi
http_pid=$!
"$core" run -c "$work/native.json" >"$work/runtime.log" 2>&1 &
core_pid=$!
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if "$core" api --url http://127.0.0.1:29090 --secret runtime-api-secret status >"$work/api.log" 2>&1; then
        ready=1
        break
    fi
    kill -0 "$core_pid" || { cat "$work/runtime.log"; exit 1; }
    sleep 1
done
[ "$ready" = 1 ] || { cat "$work/api.log"; exit 1; }
if "$core" api --url http://127.0.0.1:29090 --secret wrong status >"$work/api-denied.log" 2>&1; then
    echo 'API accepted an incorrect secret' >&2
    exit 1
fi
port=29080
for protocol in snell4 snell6 gecko openvpn openvpn-tls amnezia wireguard; do
    response="$(curl -fsS --max-time 20 --socks5-hostname "127.0.0.1:$port" http://198.51.100.10:29089/)" || { tail -30 "$work/runtime.log"; exit 1; }
    [ "$response" = forkop-native-runtime-ok ] || exit 1
    printf '%s TCP round trip passed\n' "$protocol"
    port=$((port + 1))
done
if command -v node >/dev/null 2>&1; then
    node - <<'NODE'
const dgram = require('dgram');
const assert = require('assert/strict');
(async () => {
  for (const [i, protocol] of ['snell4', 'snell6', 'gecko', 'openvpn', 'openvpn-tls', 'amnezia', 'wireguard'].entries()) {
    await new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const timer = setTimeout(() => { socket.close(); reject(Error(`${protocol} UDP timeout`)); }, 10000);
      socket.once('message', data => {
        clearTimeout(timer); socket.close();
        try { assert.equal(data.readUInt16BE(0), 0x1234); assert.equal(data[3] & 15, 0); assert.deepEqual([...data.subarray(-4)], [192,0,2,20]); resolve(); }
        catch (e) { reject(e); }
      });
      socket.send(Buffer.from('1234010000010000000000000772756e74696d6504746573740000010001', 'hex'), 29091 + i, '127.0.0.1');
    });
    console.log(`${protocol} UDP round trip passed`);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
NODE
elif command -v dig >/dev/null 2>&1; then
    port=29091
    for protocol in snell4 snell6 gecko openvpn openvpn-tls amnezia wireguard; do
        response="$(dig +short +time=10 +tries=1 @127.0.0.1 -p "$port" runtime.test A)"
        [ "$response" = 192.0.2.20 ] || { tail -30 "$work/runtime.log"; exit 1; }
        printf '%s UDP round trip passed\n' "$protocol"
        port=$((port + 1))
    done
else
    echo 'UDP runtime checks require node or dig' >&2
    exit 1
fi
printf 'Native API authentication passed\n'
