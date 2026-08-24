// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ClashAPI {
  interface ProxyHistoryEntry {
    time: string;
    delay: number;
  }

  export interface ProxyBase {
    type: string;
    name: string;
    udp: boolean;
    history: ProxyHistoryEntry[];
    now?: string;
    all?: string[];
    url?: string;
    interval?: string;
    idle_timeout?: string;
    groups?: Array<{
      outbounds?: string[];
    }>;
    fixed?: string;
  }

  export interface Proxies {
    proxies: Record<string, ProxyBase>;
  }

  export interface ProxyProvider {
    type: string;
    vehicleType: string;
    name: string;
    proxies: ProxyBase[];
    updatedAt?: string;
    subscriptionInfo?: {
      Upload?: number;
      Download?: number;
      Total?: number;
      Expire?: number;
      upload?: number;
      download?: number;
      total?: number;
      expire?: number;
    };
    subscriptionMetadata?: {
      title?: string;
      webPageUrl?: string;
      supportUrl?: string;
      announce?: string;
      announceUrl?: string;
      refillDate?: number;
      fileName?: string;
    };
  }

  export interface ProxyProviders {
    providers: Record<string, ProxyProvider>;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Forkop {
  // Subset of the Forkop CLI this app drives. `forkop` without arguments
  // prints the authoritative command list, so it is not duplicated here.
  export enum AvailableMethods {
    CHECK_DNS_AVAILABLE = 'check_dns_available',
    CHECK_FAKEIP = 'check_fakeip',
    CHECK_NFT_RULES = 'check_nft_rules',
    CHECK_PROVIDER_RUNTIME = 'check_provider_runtime',
    CHECK_INBOUNDS_CONFIG = 'check_inbounds_config',
    GET_STATUS = 'get_status',
    CHECK_SING_BOX = 'check_sing_box',
    CHECK_INBOUNDS = 'check_inbounds',
    GET_SING_BOX_STATUS = 'get_sing_box_status',
    GET_PROVIDER_STATUS = 'get_provider_status',
    CLASH_HTTP = 'clash_http',
    CLASH_SUMMARY = 'clash_summary',
    ENABLE = 'enable',
    DISABLE = 'disable',
    GLOBAL_CHECK = 'global_check',
    SHOW_CONFIG = 'show_config',
    SHOW_SING_BOX_CONFIG = 'show_sing_box_config',
    CHECK_LOGS = 'check_logs',
    CHECK_SING_BOX_LOGS = 'check_sing_box_logs',
    GET_SYSTEM_INFO = 'get_system_info',
    GET_UI_CAPABILITIES = 'get_ui_capabilities',
    GET_UI_STATE = 'get_ui_state',
    SERVICE_ACTION_ASYNC = 'service_action_async',
    SERVICE_ACTION_STATUS = 'service_action_status',
    UI_ACTION_ACK = 'ui_action_ack',
    COMPONENT_ACTION_ASYNC = 'component_action_async',
    COMPONENT_ACTION_STATUS = 'component_action_status',
    COMPONENT_UPDATE_CHECK_CACHE = 'component_update_check_cache',
  }

  export interface Outbound {
    code: string;
    displayName: string;
    latency: number;
    type: string;
    selected: boolean;
    link?: string;
    canCopyLink?: boolean;
    country?: string;
    subscriptionTag?: string;
    // Only a section that stands for a single outbound sets this: its card exists
    // because the section does, so it says whether the runtime carries the
    // outbound behind it. Every other card comes from the Clash API to begin with.
    runtimeAvailable?: boolean;
    urlTestInfo?: UrlTestInfo;
    fallbackInfo?: FallbackInfo;
  }

  export interface UrlTestMember {
    code: string;
    displayName: string;
    latency: number;
    type: string;
    selected: boolean;
    link?: string;
    canCopyLink?: boolean;
    country?: string;
    subscriptionTag?: string;
  }

  export interface UrlTestInfo {
    code: string;
    displayName: string;
    selectedCode?: string;
    selectedName?: string;
    url?: string;
    expectedStatus?: string;
    interval?: string;
    tolerance?: string | number;
    idleTimeout?: string;
    interruptExistConnections?: boolean;
    outbounds: UrlTestMember[];
  }

  export interface FallbackMember extends UrlTestMember {
    levelIndex: number;
    levelName: string;
    levelId?: string;
    pinned: boolean;
  }

  export interface FallbackInfo {
    code: string;
    displayName: string;
    selectedCode?: string;
    selectedName?: string;
    healthCheckUrl?: string;
    healthCheckInterval?: string;
    healthCheckTimeout?: string;
    attemptTimeout?: string;
    expectedStatus?: string;
    idleTimeout?: string;
    interruptExistConnections?: boolean;
    outbounds: FallbackMember[];
  }

  export interface OutboundGroup {
    withTagSelect: boolean;
    code: string;
    sectionName: string;
    displayName: string;
    action?: ConfigSection['action'];
    latencyTestCode?: string;
    latencyTestTimeout?: string;
    proxyConfigType?: ProxyConfigType;
    subscriptionSourceCount?: number;
    subscriptionProviderTags?: string[];
    subscriptionMetadata?: SubscriptionMetadata[];
    outbounds: Outbound[];
  }

  interface SubscriptionTraffic {
    upload?: number;
    download?: number;
    used?: number;
    total?: number;
    remaining?: number;
    isUnlimited?: boolean;
  }

  export interface SubscriptionMetadata {
    version?: number;
    title?: string;
    subscriptionTag?: string;
    traffic?: SubscriptionTraffic;
    expire?: number;
    refillDate?: number;
    webPageUrl?: string;
    supportUrl?: string;
    announce?: string;
    announceUrl?: string;
    fileName?: string;
    sourceIndex?: number;
    sourceSection?: string;
  }

  type RuleAction =
    | 'connection'
    | 'proxy'
    | 'outbound'
    | 'vpn'
    | 'bypass'
    | 'block'
    | 'zapret'
    | 'zapret2'
    | 'byedpi';
  type ProxyConfigType =
    | 'urltest'
    | 'selector'
    | 'url'
    | 'outbound'
    | 'interface'
    | 'subscription';

  export interface ConfigSection {
    '.name': string;
    '.type':
      | 'settings'
      | 'rule'
      | 'node'
      | 'ruleset'
      | 'section'
      | 'server'
      | 'subscription_url'
      | 'section_interface'
      | 'urltest'
      | 'fallback_group'
      | 'fallback_level'
      | 'tunnel'
      | 'tunnel_peer';
    label?: string;
    enabled?: string;
    action?: RuleAction;
    node?: string;
    rule_set?: string[];
    rule_set_with_subnets?: string[];
    ports?: string[];
    update_interval?: string;
    proxy_string?: string;
    nfqws_opt?: string;
    nfqws2_opt?: string;
    byedpi_cmd_opts?: string;
    cmd_opts?: string;
    selector_proxy_links?: string[];
    subscription_urls?: string[];
    interfaces?: string[];
    tunnels?: string[];
    outbound_jsons?: string[];
    subscription_url_settings?: string;
    urltests?: string[];
    urltest_settings?: string;
    fallback_groups?: string[];
    fallback_group_settings?: string;
    subscription_update_enabled?: '0' | '1';
    subscription_update_interval?: string;
    urltest_enabled?: '0' | '1';
    urltest_server_filter_mode?: 'all' | 'exclude' | 'include';
    urltest_filter_mode?: 'disabled' | 'exclude' | 'include' | 'mixed';
    urltest_exclude_countries?: string[];
    urltest_exclude_outbounds?: string[];
    urltest_exclude_regex?: string | string[];
    urltest_include_countries?: string[];
    urltest_include_outbounds?: string[];
    urltest_include_regex?: string | string[];
    outbound_json?: string;
    interface?: string;
    section?: string;
    id?: string;
    url?: string;
    name?: string;
    display_name?: string;
    check_interval?: string;
    tolerance?: string;
    testing_url?: string;
    idle_timeout?: string;
    interrupt_exist_connections?: '0' | '1';
    hide_dashboard_members?: '0' | '1';
    server_filter_mode?: 'all' | 'exclude' | 'include' | 'direct';
    filter_mode?: 'disabled' | 'exclude' | 'include' | 'mixed';
    include_countries?: string[];
    include_outbounds?: string[];
    include_regex?: string | string[];
    exclude_countries?: string[];
    exclude_outbounds?: string[];
    exclude_regex?: string | string[];
    group?: string;
    order?: string;
    direct?: '0' | '1';
    health_check_url?: string;
    health_check_interval?: string;
    health_check_timeout?: string;
    attempt_timeout?: string;
    expected_status?: string;
    country?: string[];
    server_name?: string[];
    regex?: string[];
    outbound_detour_enabled?: '0' | '1';
    outbound_detour_section?: string;
    download_via_proxy_enabled?: '0' | '1';
    download_via_proxy_section?: string;
    user_agent?: string;
    header?: string[];
    show_dashboard_metadata?: '0' | '1';
    show_subscription_name?: '0' | '1';
    tag?: string;
    yacd_secret_key?: string;
    latency_test_url?: string;
  }

  export interface MethodSuccessResponse<T> {
    success: true;
    data: T;
  }

  export interface MethodFailureResponse {
    success: false;
    error: string;
  }

  export type MethodResponse<T> =
    | MethodSuccessResponse<T>
    | MethodFailureResponse;

  export interface DnsCheckResult {
    dns_server: string;
    dns_status: 0 | 1;
    dns_on_router: 0 | 1;
    bootstrap_dns_server: string;
    bootstrap_dns_status: 0 | 1;
    dhcp_config_status: 0 | 1;
    dont_touch_dhcp: 0 | 1;
  }

  export interface NftRulesCheckResult {
    table_exist: 0 | 1;
    rules_mangle_exist: 0 | 1;
    rules_mangle_counters: 0 | 1;
    rules_mangle_output_exist: 0 | 1;
    rules_mangle_output_counters: 0 | 1;
    rules_proxy_exist: 0 | 1;
    rules_proxy_counters: 0 | 1;
    rules_other_mark_exist: 0 | 1;
  }

  export interface SingBoxCheckResult {
    sing_box_installed: 0 | 1;
    sing_box_version_ok: 0 | 1;
    sing_box_service_exist: 0 | 1;
    sing_box_autostart_disabled: 0 | 1;
    sing_box_process_running: 0 | 1;
    sing_box_ports_listening: 0 | 1;
  }

  export interface InboundCheckItem {
    section: string;
    label: string;
    protocol: string;
    routing_mode: string;
    tag: string;
    listen: string;
    listen_port: number;
    public_host: string;
    public_host_ips: string;
    expected_type: string;
    required_proto: string;
    runtime_exists: 0 | 1;
    runtime_type: string;
    runtime_listen: string;
    runtime_port: number;
    runtime_ok: 0 | 1;
    listening: -1 | 0 | 1;
    firewall_required: 0 | 1;
    firewall_open: -1 | 0 | 1;
    port_conflict: 0 | 1;
    port_conflict_owners: string;
    routes_configured: 0 | 1;
    public_host_resolved: -1 | 0 | 1;
    public_host_public: -1 | 0 | 1;
    public_host_matches_wan: -1 | 0 | 1;
  }

  export interface InboundsCheckResult {
    enabled_count: number;
    config_path: string;
    wan_ip: string;
    wan_public: 0 | 1;
    items: InboundCheckItem[];
  }

  export interface InboundsConfigCheckResult {
    enabled_count: number;
  }

  export interface FakeIPCheckResult {
    fakeip: boolean;
    IP: string;
  }

  export interface GetStatus {
    running: number;
    enabled: number;
    status: string;
    dns_configured?: number;
  }

  export interface GetSingBoxStatus {
    running: number;
    enabled: number;
    status: string;
  }

  export interface GetSystemInfo {
    forkop_version: string;
    forkop_latest_version: string;
    luci_app_version: string;
    sing_box_version: string;
    sing_box_compressed: 0 | 1;
    zapret_version: string;
    zapret_installed: 0 | 1;
    zapret2_version: string;
    zapret2_installed: 0 | 1;
    byedpi_version: string;
    byedpi_installed: 0 | 1;
    openwrt_version: string;
    device_model: string;
    generated_at?: number;
  }

  export interface GetUiCapabilities {
    zapret_installed: 0 | 1;
    zapret2_installed: 0 | 1;
    byedpi_installed: 0 | 1;
    server_inbounds_enabled_count: number;
  }

  export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload';

  export interface UiActionStartResult {
    success: boolean;
    job_id: string;
    message: string;
  }

  export interface UiActionState {
    success: boolean;
    running?: boolean;
    kind?: string;
    message?: string;
    pid?: string | null;
    started_at?: number;
    updated_at?: number | null;
    exit_code?: number | null;
    job_id?: string;
  }

  export interface ServiceActionState extends UiActionState {
    kind: 'service';
    action: ServiceAction;
    source?: string;
  }

  export interface UiState {
    service: {
      forkop: GetStatus;
      sing_box: GetSingBoxStatus;
    };
    capabilities: GetUiCapabilities;
    actions: {
      service: ServiceActionState[];
      component: ComponentActionResult[];
    };
  }

  export type DpiProvider = 'zapret' | 'zapret2' | 'byedpi';

  export type ComponentName = 'forkop' | 'sing_box' | DpiProvider;

  export type ComponentAction = 'check_update' | 'install' | 'remove';

  export interface ComponentActionResult {
    success: boolean;
    running?: boolean;
    kind?: 'component';
    job_id?: string;
    component: ComponentName;
    action: ComponentAction;
    message: string;
    current_version: string;
    latest_version: string;
    release_url?: string;
    changed: boolean;
    status?: 'latest' | 'outdated' | 'dev' | '';
    pid?: string | null;
    started_at?: number;
    updated_at?: number | null;
    exit_code?: number | null;
  }

  export interface ComponentUpdateCheckCache {
    enabled: boolean;
    results: ComponentActionResult[];
  }

  export type ComponentActionStartResult = UiActionStartResult;

  // providers/nfqueue/runtime.uc answers zapret and zapret2 from one payload.
  export interface GetNfqueueProviderStatus {
    installed: 0 | 1;
    package_installed: 0 | 1;
    provider_available: 0 | 1;
    provider_path: string;
    files_available: 0 | 1;
    ipset_available: 0 | 1;
    version: string;
    configured: 0 | 1;
    enabled_rule_count: number;
    expected_process_count: number;
    running_process_count: number;
    supervisor_process_count: number;
    standalone_service_enabled: 0 | 1;
    standalone_service_running: 0 | 1;
    standalone_config_present: 0 | 1;
    standalone_conflict: 0 | 1;
    luci_app_installed: 0 | 1;
    queue_base: number;
    queue_range_end: number;
    queue_overlap: 0 | 1;
    queue_rules_present: 0 | 1;
    ready: 0 | 1;
    conflict: 0 | 1;
    outbounds_configured: 0 | 1;
    routes_configured: 0 | 1;
    status_message: string;
  }

  // Only zapret can still carry a runtime directory an older revision created.
  export interface GetZapretStatus extends GetNfqueueProviderStatus {
    legacy_runtime_present: 0 | 1;
  }

  export interface ZapretCheckResult {
    zapret_installed: 0 | 1;
    zapret_package_installed: 0 | 1;
    zapret_provider_path: string;
  }

  export type GetZapret2Status = GetNfqueueProviderStatus;

  export interface Zapret2CheckResult {
    zapret2_installed: 0 | 1;
    zapret2_package_installed: 0 | 1;
    zapret2_provider_path: string;
  }

  export interface GetByedpiStatus {
    installed: 0 | 1;
    package_installed: 0 | 1;
    provider_available: 0 | 1;
    provider_path: string;
    version: string;
    configured: 0 | 1;
    enabled_rule_count: number;
    expected_process_count: number;
    running_process_count: number;
    supervisor_process_count: number;
    restart_count: number;
    runtime_unstable: 0 | 1;
    standalone_service_enabled: 0 | 1;
    standalone_service_running: 0 | 1;
    listen_address: string;
    port_base: number;
    outbounds_configured: 0 | 1;
    routes_configured: 0 | 1;
    ready: 0 | 1;
    conflict: 0 | 1;
    status_message: string;
  }

  export interface ByedpiCheckResult {
    byedpi_installed: 0 | 1;
    byedpi_package_installed: 0 | 1;
    byedpi_provider_path: string;
  }

  export interface GetClashApiProxyLatency {
    delay: number;
    message?: string;
  }

  export interface GetClashApiProxyLink {
    url: string;
  }

  export type GetClashApiGroupLatency = Record<string, number>;

  export interface ClashHttpResponse {
    status: number;
    body: string;
  }

  export interface ClashConnectionsSummary {
    downloadTotal: number;
    uploadTotal: number;
    memory: number;
    connections: number;
  }
}
