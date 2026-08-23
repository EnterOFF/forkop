/**
 * The obfuscation values the Amnezia client writes for a fresh AmneziaWG 3.1
 * server, limited to the parameters a peer never has to know about. They are
 * copied from the client rather than invented here: `awgInstaller.cpp` picks a
 * junk packet count between 4 and 6 and leaves the sizes at 10 and 50, and
 * `protocolConstants.h` holds the timings and the signature packet.
 *
 * Everything else that installer generates -- the packet paddings, the magic
 * headers and the header protection key -- has to match the server, so it is
 * not generated on a client and is left untouched here.
 */

/**
 * Amnezia's default I1: a byte-correct DNS answer for icloud.com, with the two
 * random bytes in front standing in for the transaction id. A signature packet
 * is meant to look like a real protocol, so this is a hand-built packet rather
 * than noise, and it is used verbatim -- a random payload would only add one
 * more unclassifiable datagram in front of the handshake.
 */
const AMNEZIA_SIGNATURE =
  '<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>';

/** Junk packet count, drawn from the same range the Amnezia installer uses. */
const JUNK_PACKET_COUNT = { from: 4, to: 6 };

/**
 * Nothing generated here is a secret -- the values end up in the configuration
 * the user is looking at -- so an ordinary random source is enough.
 */
function randomBetween(from: number, to: number): number {
  return from + Math.floor(Math.random() * (to - from + 1));
}

/**
 * Returns the one-sided AmneziaWG parameters as the tunnel dialog stores them:
 * every field it can fill, so pressing the button twice replaces the whole set
 * instead of mixing a new junk count into old timings. The signature packets
 * Amnezia leaves unset come back empty for the same reason.
 */
export function generateAmneziaParameters(): Record<string, string> {
  return {
    jc: `${randomBetween(JUNK_PACKET_COUNT.from, JUNK_PACKET_COUNT.to)}`,
    jmin: '10',
    jmax: '50',
    i1: AMNEZIA_SIGNATURE,
    i2: '',
    i3: '',
    i4: '',
    i5: '',
    content_padding_addition: '10-100',
    rekey_after_time: '100-120',
    rekey_timeout: '3-7',
    reject_after_time: '150-180',
    keepalive_timeout: '5-15',
    max_handshake_attempts: '15-20',
  };
}
