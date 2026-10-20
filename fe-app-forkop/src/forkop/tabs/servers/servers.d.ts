// The shapes the Servers tab passes around.

declare global {
  type ServerClient = {
    id: string;
    name: string;
    uuid: string;
    password: string;
    flow: string;
  };

  interface ShareLinkContext {
    tlsCertificateSha256?: string;
    // What the router issued, which a profile takes its certificates and keys from.
    issued?: Record<string, Record<string, unknown>>;
  }

  interface ShareLink {
    scheme: string;
    url: string;
  }

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
