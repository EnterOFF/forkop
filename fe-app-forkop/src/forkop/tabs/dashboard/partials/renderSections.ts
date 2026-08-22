import {
  renderLoaderCircleIcon24,
  renderCopyIcon24,
  renderInfoIcon24,
  renderListFilterIcon24,
  renderRotateCcwIcon24,
} from '../../../../icons';
import { isCopyableProxyLink } from '../../../../helpers';
import { prettyBytes } from '../../../../helpers/prettyBytes';
import { Forkop } from '../../../types';
import { renderFlagEmojis } from './renderFlagEmojis';

interface IRenderSectionsProps {
  loading: boolean;
  failed: boolean;
  section: Forkop.OutboundGroup;
  onTestLatency: (tag: string) => void;
  onTestOutboundLatency: (latencyType: 'group' | 'proxy', tag: string) => void;
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
  latencyFetchingTargets?: Set<string>;
  subscriptionUpdating: boolean;
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
      E('div', { class: 'fkp_dashboard-page__subscription-meta__heading' }, [
        ...(metadata.subscriptionTag
          ? [
              E(
                'span',
                {
                  class:
                    'fkp_dashboard-page__outbound-grid__item__subscription-tag',
                },
                metadata.subscriptionTag,
              ),
            ]
          : []),
        _('Subscription info:'),
      ]),
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

function getOutboundLatencyClass(latency: number) {
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
  latencyFetchingTargets = new Set(),
  subscriptionUpdating,
  sortByLatency,
}: IRenderSectionsProps) {
  function testLatency() {
    if (section.withTagSelect) {
      return onTestLatency(section.latencyTestCode || section.code);
    }

    if (section.outbounds.length) {
      return onTestLatency(section.outbounds[0].code);
    }
  }

  function renderOutbound(outbound: Forkop.Outbound) {
    const canCopyLink =
      Boolean(outbound.canCopyLink) || isCopyableProxyLink(outbound.link);
    const canChooseOutbound =
      section.withTagSelect &&
      outbound.runtimeAvailable !== false &&
      !outbound.selected;
    const groupInfo = outbound.urlTestInfo || outbound.fallbackInfo;
    const showLatency =
      !groupInfo ||
      (outbound.runtimeAvailable !== false && groupInfo.outbounds.length > 0);
    const latencyType: 'group' | 'proxy' = groupInfo ? 'group' : 'proxy';
    const latencyTarget = outbound.code;
    const outboundLatencyFetching = latencyFetchingTargets.has(latencyTarget);
    const canTestOutboundLatency =
      showLatency &&
      outbound.runtimeAvailable !== false &&
      !outboundLatencyFetching;
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
        'aria-disabled':
          section.withTagSelect && !canChooseOutbound ? 'true' : undefined,
        click: () =>
          canChooseOutbound &&
          window.getSelection()?.isCollapsed !== false &&
          onChooseOutbound(section.sectionName, section.code, outbound.code),
      },
      [
        E('div', { class: 'fkp_dashboard-page__outbound-grid__item__header' }, [
          E('b', {}, [
            ...(outbound.subscriptionTag
              ? [
                  E(
                    'span',
                    {
                      class:
                        'fkp_dashboard-page__outbound-grid__item__subscription-tag',
                    },
                    outbound.subscriptionTag,
                  ),
                ]
              : []),
            ...renderFlagEmojis(outbound.displayName),
          ]),
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
              'aria-busy': latencyFetching ? 'true' : undefined,
              disabled: latencyFetching ? true : undefined,
              click: (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                if (!latencyFetching) testLatency();
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
                    _('Test latency'),
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

// The grid is drawn before any section is known and again whenever the load
// fails, so the empty shape both of those need lives next to the renderer.
export function renderSectionsPlaceholder(state: {
  loading: boolean;
  failed: boolean;
}) {
  return renderSections({
    ...state,
    section: {
      code: '',
      sectionName: '',
      displayName: '',
      outbounds: [],
      withTagSelect: false,
    },
    onTestLatency: () => {},
    onTestOutboundLatency: () => {},
    onChooseOutbound: () => {},
    onCopyOutbound: () => {},
    onShowUrlTestInfo: () => {},
    onShowFallbackInfo: () => {},
    onUpdateSubscription: () => {},
    latencyFetching: false,
    subscriptionUpdating: false,
  });
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
