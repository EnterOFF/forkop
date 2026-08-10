import {
  renderLoaderCircleIcon24,
  renderCopyIcon24,
  renderInfoIcon24,
  renderListFilterIcon24,
  renderRotateCcwIcon24,
} from '../../../../icons';
import { isCopyableProxyLink, svgEl } from '../../../../helpers';
import { prettyBytes } from '../../../../helpers/prettyBytes';
import { Forkop } from '../../../types';
import { renderFlagEmojis } from './renderFlagEmojis';

interface IRenderSectionsProps {
  loading: boolean;
  failed: boolean;
  section: Forkop.OutboundGroup;
  onTestLatency: (tag: string | string[]) => void;
  onTestOutboundLatency: (
    latencyType: Forkop.LatencyActionState['latency_type'],
    tag: string | string[],
  ) => void;
  onChooseOutbound: (
    sectionName: string,
    selector: string,
    tag: string,
  ) => void;
  onCopyOutbound: (
    section: Forkop.OutboundGroup,
    outbound: Forkop.Outbound,
  ) => void;
  onShowUrlTestInfo: (outbound: Forkop.Outbound) => void;
  onShowFallbackInfo: (outbound: Forkop.Outbound) => void;
  onUpdateSubscription: (section: Forkop.OutboundGroup) => void;
  onSortByLatencyChange?: (sectionName: string, enabled: boolean) => void;
  latencyFetching: boolean;
  latencyCancelling?: boolean;
  latencyFetchingTarget?: string;
  latencyProgress?: Forkop.LatencyActionProgress;
  subscriptionUpdating: boolean;
  selectorSwitchingTag?: string;
  sortByLatency?: boolean;
}

function renderFailedState() {
  return E(
    'div',
    {
      class: 'fkp_dashboard-page__outbound-section centered',
      style: 'height: 127px',
    },
    E('span', {}, [E('span', {}, _('Dashboard currently unavailable'))]),
  );
}

function renderLoadingState() {
  return E('div', {
    id: 'dashboard-sections-grid-skeleton',
    class: 'fkp_dashboard-page__outbound-section skeleton',
    style: 'height: 127px',
  });
}

function isValidHttpUrl(url?: string) {
  return Boolean(url && /^https?:\/\/\S+$/i.test(url));
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return prettyBytes(value);
}

function formatDate(seconds?: number) {
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return undefined;
  }

  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getLatencySortValue(outbound: Forkop.Outbound) {
  return Number.isFinite(outbound.latency) && outbound.latency > 0
    ? outbound.latency
    : Number.POSITIVE_INFINITY;
}

function renderMetadataAction(label: string, url?: string) {
  if (!isValidHttpUrl(url)) {
    return undefined;
  }

  return E(
    'a',
    {
      class: 'fkp_dashboard-page__subscription-meta__action',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: label,
      'aria-label': label,
    },
    `${label} ↗`,
  );
}

function renderSubscriptionMetadata(
  metadata: Forkop.SubscriptionMetadata | undefined,
) {
  if (!metadata || Object.keys(metadata).length <= 1) {
    return undefined;
  }

  const title = metadata.title || metadata.fileName;
  const traffic = metadata.traffic;
  const used = formatBytes(traffic?.used) || '0 B';
  const total = traffic?.isUnlimited
    ? '∞'
    : formatBytes(traffic?.total) || '0 B';
  const expire = formatDate(metadata.expire);
  const refillDate = formatDate(metadata.refillDate);

  const rows = [
    traffic
      ? {
          label: _('Traffic'),
          value: `${used} / ${total}`,
        }
      : undefined,
    expire ? { label: _('Expires'), value: expire } : undefined,
    refillDate ? { label: _('Refill'), value: refillDate } : undefined,
  ].filter(Boolean) as { label: string; value: string }[];

  const actions = [
    renderMetadataAction('Profile', metadata.webPageUrl),
    renderMetadataAction('Support', metadata.supportUrl),
    renderMetadataAction('More details', metadata.announceUrl),
  ].filter(Boolean) as HTMLElement[];

  return E('div', { class: 'fkp_dashboard-page__subscription-meta' }, [
    E('div', { class: 'fkp_dashboard-page__subscription-meta__main' }, [
      E(
        'div',
        { class: 'fkp_dashboard-page__subscription-meta__heading' },
        _('Subscription info:'),
      ),
      title
        ? E(
            'div',
            { class: 'fkp_dashboard-page__subscription-meta__title' },
            title,
          )
        : '',
      rows.length
        ? E(
            'div',
            { class: 'fkp_dashboard-page__subscription-meta__facts' },
            rows.map((row) =>
              E(
                'div',
                { class: 'fkp_dashboard-page__subscription-meta__fact' },
                [
                  E(
                    'span',
                    {
                      class: 'fkp_dashboard-page__subscription-meta__fact-key',
                    },
                    row.label,
                  ),
                  E(
                    'span',
                    {
                      class:
                        'fkp_dashboard-page__subscription-meta__fact-value',
                    },
                    row.value,
                  ),
                ],
              ),
            ),
          )
        : '',
      actions.length
        ? E(
            'div',
            { class: 'fkp_dashboard-page__subscription-meta__actions' },
            actions,
          )
        : '',
    ]),
    metadata.announce
      ? E(
          'blockquote',
          { class: 'fkp_dashboard-page__subscription-meta__announce' },
          metadata.announce,
        )
      : '',
  ]);
}

function renderSubscriptionUpdateAction(
  section: Forkop.OutboundGroup,
  subscriptionUpdating: boolean,
  onUpdateSubscription: (section: Forkop.OutboundGroup) => void,
) {
  if (!section.subscriptionSourceCount) {
    return undefined;
  }

  return E(
    'button',
    {
      type: 'button',
      class: 'btn fkp_dashboard-page__outbound-section__subscription-update',
      'aria-label': _('Update subscriptions'),
      disabled: subscriptionUpdating ? true : undefined,
      click: (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (subscriptionUpdating) {
          return;
        }

        onUpdateSubscription(section);
      },
    },
    subscriptionUpdating
      ? [renderLoaderCircleIcon24(), _('Update subscriptions')]
      : _('Update subscriptions'),
  );
}

export function getLatencyTestLabel(
  latencyProgress?: Forkop.LatencyActionProgress,
) {
  const total = Math.trunc(Number(latencyProgress?.total ?? 0));
  if (!Number.isFinite(total) || total <= 0) {
    return _('Cancel latency test');
  }

  const completedValue = Number(latencyProgress?.completed ?? 0);
  const completed = Number.isFinite(completedValue)
    ? Math.trunc(completedValue)
    : 0;

  if (completed >= total) {
    return _('Cancel latency test');
  }

  return `${_('Cancel latency test')} (${Math.min(
    Math.max(0, completed),
    total,
  )}/${total})`;
}

export function getPendingLatencyTags(
  section: Forkop.OutboundGroup,
  latencyProgress?: Forkop.LatencyActionProgress,
) {
  const pending = new Set(latencyProgress?.pending || []);

  for (const outbound of section.outbounds) {
    const groupInfo = outbound.urlTestInfo || outbound.fallbackInfo;
    if (!groupInfo || !pending.has(outbound.code)) {
      continue;
    }

    for (const member of groupInfo.outbounds) {
      pending.add(member.code);
    }
  }

  return pending;
}

export function getOutboundLatencyClass(latency: number) {
  if (!latency) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--empty';
  }

  if (latency < 800) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--green';
  }

  if (latency < 1500) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--yellow';
  }

  return 'fkp_dashboard-page__outbound-grid__item__latency--red';
}

function renderDefaultState({
  section,
  onChooseOutbound,
  onCopyOutbound,
  onShowUrlTestInfo,
  onShowFallbackInfo,
  onTestLatency,
  onTestOutboundLatency,
  onUpdateSubscription,
  onSortByLatencyChange,
  latencyFetching,
  latencyCancelling,
  latencyFetchingTarget,
  latencyProgress,
  subscriptionUpdating,
  selectorSwitchingTag,
  sortByLatency,
}: IRenderSectionsProps) {
  const hasPendingLatencyState = Array.isArray(latencyProgress?.pending);
  const pendingLatencyTags = getPendingLatencyTags(section, latencyProgress);
  const hasExactLatencyTarget = section.outbounds.some(
    (outbound) => outbound.code === latencyFetchingTarget,
  );

  function testLatency() {
    if (section.withTagSelect) {
      return onTestLatency(
        section.latencyTestCodes?.length
          ? section.latencyTestCodes
          : section.latencyTestCode || section.code,
      );
    }

    if (section.outbounds.length) {
      return onTestLatency(section.outbounds[0].code);
    }
  }

  function renderOutbound(outbound: Forkop.Outbound) {
    const canCopyLink =
      Boolean(outbound.canCopyLink) || isCopyableProxyLink(outbound.link);
    const selectorSwitching = Boolean(selectorSwitchingTag);
    const outboundSwitching = selectorSwitchingTag === outbound.code;
    const canChooseOutbound =
      section.withTagSelect &&
      outbound.runtimeAvailable !== false &&
      !selectorSwitching &&
      !outbound.selected;
    const groupInfo = outbound.urlTestInfo || outbound.fallbackInfo;
    const groupTargets = Array.from(
      new Set(
        (groupInfo?.outbounds || [])
          .map((member) => member.code)
          .filter(Boolean),
      ),
    );
    const showLatency =
      !groupInfo ||
      (outbound.runtimeAvailable !== false && groupTargets.length > 0);
    const latencyType: Forkop.LatencyActionState['latency_type'] = groupInfo
      ? 'proxy_list'
      : 'proxy';
    const latencyTarget = groupInfo ? groupTargets : outbound.code;
    const serializedLatencyTarget = Array.isArray(latencyTarget)
      ? JSON.stringify(latencyTarget)
      : latencyTarget;
    const outboundLatencyFetching = latencyFetching
      ? hasExactLatencyTarget
        ? latencyFetchingTarget === serializedLatencyTarget
        : hasPendingLatencyState
          ? (Array.isArray(latencyTarget)
              ? latencyTarget
              : [latencyTarget]
            ).some((tag) => pendingLatencyTags.has(tag))
          : latencyFetchingTarget ===
            (Array.isArray(latencyTarget)
              ? JSON.stringify(latencyTarget)
              : latencyTarget)
      : false;
    const canTestOutboundLatency =
      showLatency && outbound.runtimeAvailable !== false && !latencyFetching;
    const className = [
      'fkp_dashboard-page__outbound-grid__item',
      outbound.selected
        ? 'fkp_dashboard-page__outbound-grid__item--active'
        : '',
      canChooseOutbound
        ? 'fkp_dashboard-page__outbound-grid__item--selectable'
        : '',
      section.withTagSelect && !canChooseOutbound
        ? 'fkp_dashboard-page__outbound-grid__item--disabled'
        : '',
      outboundSwitching
        ? 'fkp_dashboard-page__outbound-grid__item--switching'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    const latencyClass = getOutboundLatencyClass(outbound.latency);
    const latencyValue = outbound.latency ? `${outbound.latency}ms` : 'N/A';
    const latency = showLatency
      ? E(
          'button',
          {
            type: 'button',
            class: `btn fkp_dashboard-page__outbound-grid__item__latency ${latencyClass}`,
            title: _('Test latency'),
            'aria-label': _('Test latency'),
            'aria-busy': outboundLatencyFetching ? 'true' : undefined,
            'data-latency-section': section.sectionName,
            'data-latency-code': outbound.code,
            'data-latency-targets': JSON.stringify(
              Array.isArray(latencyTarget) ? latencyTarget : [latencyTarget],
            ),
            disabled: canTestOutboundLatency ? undefined : true,
            click: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              if (canTestOutboundLatency) {
                onTestOutboundLatency(latencyType, latencyTarget);
              }
            },
          },
          [
            outboundLatencyFetching
              ? renderLoaderCircleIcon24()
              : renderRotateCcwIcon24(),
            E(
              'span',
              {
                class: 'fkp_dashboard-page__outbound-grid__item__latency-value',
              },
              latencyValue,
            ),
          ],
        )
      : undefined;
    return E(
      'div',
      {
        class: className,
        'aria-busy': outboundSwitching ? 'true' : undefined,
        'aria-disabled':
          section.withTagSelect && !canChooseOutbound ? 'true' : undefined,
        click: () =>
          canChooseOutbound &&
          window.getSelection()?.isCollapsed !== false &&
          onChooseOutbound(section.sectionName, section.code, outbound.code),
      },
      [
        ...(outboundSwitching
          ? [
              svgEl(
                'svg',
                { class: 'fkp_dashboard-page__outbound-grid__item__snake' },
                [
                  svgEl('rect', {
                    width: '100%',
                    height: '100%',
                    fill: 'none',
                    rx: 4,
                    ry: 4,
                    pathLength: 100,
                  }),
                ],
              ),
            ]
          : []),
        E('div', { class: 'fkp_dashboard-page__outbound-grid__item__header' }, [
          E('b', {}, renderFlagEmojis(outbound.displayName)),
          ...(canCopyLink
            ? [
                E(
                  'button',
                  {
                    type: 'button',
                    class:
                      'btn fkp_dashboard-page__outbound-grid__item__copy-button',
                    title: _('Copy proxy link'),
                    'aria-label': _('Copy proxy link'),
                    click: (event: MouseEvent) => {
                      event.stopPropagation();
                      onCopyOutbound(section, outbound);
                    },
                  },
                  renderCopyIcon24(),
                ),
              ]
            : []),
          ...(outbound.urlTestInfo
            ? [
                E(
                  'button',
                  {
                    type: 'button',
                    class:
                      'btn fkp_dashboard-page__outbound-grid__item__copy-button',
                    title: _('URLTest details'),
                    'aria-label': _('URLTest details'),
                    click: (event: MouseEvent) => {
                      event.stopPropagation();
                      onShowUrlTestInfo(outbound);
                    },
                  },
                  renderInfoIcon24(),
                ),
              ]
            : []),
          ...(outbound.fallbackInfo
            ? [
                E(
                  'button',
                  {
                    type: 'button',
                    class:
                      'btn fkp_dashboard-page__outbound-grid__item__copy-button',
                    title: _('Fallback details'),
                    'aria-label': _('Fallback details'),
                    click: (event: MouseEvent) => {
                      event.stopPropagation();
                      onShowFallbackInfo(outbound);
                    },
                  },
                  renderInfoIcon24(),
                ),
              ]
            : []),
        ]),
        E('div', { class: 'fkp_dashboard-page__outbound-grid__item__footer' }, [
          E(
            'div',
            { class: 'fkp_dashboard-page__outbound-grid__item__type' },
            [outbound.fallbackInfo ? _('Fallback') : outbound.type].filter(
              Boolean,
            ),
          ),
          ...(latency ? [latency] : []),
        ]),
      ],
    );
  }

  const metadataNodes = (section.subscriptionMetadata || [])
    .map((metadata) => renderSubscriptionMetadata(metadata))
    .filter(Boolean) as HTMLElement[];
  const subscriptionUpdateAction = renderSubscriptionUpdateAction(
    section,
    subscriptionUpdating,
    onUpdateSubscription,
  );
  const outbounds = sortByLatency
    ? [...section.outbounds].sort(
        (left, right) => getLatencySortValue(left) - getLatencySortValue(right),
      )
    : section.outbounds;
  const latencySortAction =
    section.outbounds.length > 1
      ? E(
          'button',
          {
            type: 'button',
            class: [
              'btn fkp_dashboard-page__outbound-section__sort-by-latency',
              sortByLatency
                ? 'fkp_dashboard-page__outbound-section__sort-by-latency--active'
                : '',
            ]
              .filter(Boolean)
              .join(' '),
            title: _('Sort by latency'),
            'aria-label': _('Sort by latency'),
            'aria-pressed': sortByLatency ? 'true' : 'false',
            click: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              onSortByLatencyChange?.(section.sectionName, !sortByLatency);
            },
          },
          renderListFilterIcon24(),
        )
      : undefined;

  return E('div', { class: 'fkp_dashboard-page__outbound-section' }, [
    // Title with test latency
    E('div', { class: 'fkp_dashboard-page__outbound-section__title-section' }, [
      E(
        'div',
        {
          class: 'fkp_dashboard-page__outbound-section__title-section__title',
        },
        section.displayName,
      ),
      E(
        'div',
        {
          class: 'fkp_dashboard-page__outbound-section__title-section__actions',
        },
        [
          ...(latencySortAction ? [latencySortAction] : []),
          ...(subscriptionUpdateAction ? [subscriptionUpdateAction] : []),
          E(
            'button',
            {
              type: 'button',
              class: 'btn dashboard-sections-grid-item-test-latency',
              'data-latency-section': section.sectionName,
              disabled: latencyFetching && latencyCancelling ? true : undefined,
              click: (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                if (latencyFetching && latencyCancelling) {
                  return;
                }
                testLatency();
              },
            },
            latencyFetching
              ? [
                  renderLoaderCircleIcon24(),
                  E(
                    'span',
                    {
                      class: 'dashboard-sections-grid-item-test-latency__label',
                    },
                    getLatencyTestLabel(latencyProgress),
                  ),
                ]
              : E(
                  'span',
                  {
                    class: 'dashboard-sections-grid-item-test-latency__label',
                  },
                  _('Test latency'),
                ),
          ),
        ],
      ),
    ]),
    E('div', { class: 'fkp_dashboard-page__outbound-grid' }, [
      ...metadataNodes,
      ...outbounds.map((outbound) => renderOutbound(outbound)),
    ]),
  ]);
}

export function renderSections(props: IRenderSectionsProps) {
  if (props.failed) {
    return renderFailedState();
  }

  if (props.loading) {
    return renderLoadingState();
  }

  return renderDefaultState(props);
}
