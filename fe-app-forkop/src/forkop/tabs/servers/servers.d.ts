// The shapes the Servers tab passes around.
//
// A server is one sing-box inbound; the accounts that may use it are its
// clients, stored as child sections. Both travel through the dialog, the share
// links and the connection details as plain objects, and this is what they are.

declare global {
  // One account of a server, read out of its uci section.
  type ServerClient = {
    id: string;
    name: string;
    uuid: string;
    password: string;
    flow: string;
  };

  // What a share link needs beyond the server's own configuration: the
  // fingerprint of a self-signed certificate, so the client can pin it.
  interface ShareLinkContext {
    tlsCertificateSha256?: string;
    // What the router issued, which a profile takes its certificates and keys from.
    issued?: Record<string, Record<string, unknown>>;
  }

  // One share link, as the connection dialog lists it.
  interface ShareLink {
    scheme: string;
    url: string;
  }

  // One entry of the protocol table: what the inbound is called, what it can
  // carry, and which fields the dialog shows for it.
  interface ServerProtocol {
    id: string;
    label: string;
    // Which sing-box object it becomes: an inbound listens on a port, an
    // endpoint does not.
    kind?: string;
    securities: string[];
    credentials?: string[];
    // The sing-box type it becomes, when that is not its id.
    coreType?: string;
    // The scheme of the share link, when the protocol has one.
    link?: string;
    // The option that switches authentication off, for a protocol that can run
    // without it.
    optionalAuth?: string;
    login?: boolean;
    // An endpoint that listens on a port of its own, whose clients are issued a
    // certificate rather than asked for a credential, and who get a profile file.
    listener?: boolean;
    clients?: boolean;
    profile?: boolean;
    // A subnet whose addresses the server hands its clients.
    tunnel?: boolean;
    // A listener the core binds on every address of the router.
    anyAddress?: boolean;
    transport?: boolean;
    multiplex?: boolean;
    // protocolsWith() asks for a flag by name.
    [key: string]: unknown;
  }
}

export {};
