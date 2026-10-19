import { latencyClassName } from '../latencyClassName';
import { sectionLatencyTarget } from '../sectionLatencyTarget';
import { getRuleEditButtonText } from '../../../cbi/grid';
import {
  renderChevronUpIcon24,
  renderCogIcon24,
  renderLoaderCircleIcon24,
  renderCopyIcon24,
  renderInfoIcon24,
  renderGaugeIcon24,
  renderListFilterIcon24,
  renderRotateCcwIcon24,
} from '../../../../icons';
import { isCopyableProxyLink } from '../../../../helpers/isCopyableProxyLink';
import { prettyBytes } from '../../../../helpers/prettyBytes';
import { Forkop } from '../../../types';
import { renderFlagEmojis } from './renderFlagEmojis';
import { E } from '../../../../helpers/element';

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
  onSortByLatencyChange?: (sectionName: string, enabled: boolean) => void;
  onCollapsedChange?: (sectionName: string, collapsed: boolean) => void;
  onEditSection?: (sectionName: string) => void;
  latencyFetching: boolean;
  latencyFetchingTargets?: Set<string>;
  sortByLatency?: boolean;
  // Folding away the one section a page shows leaves nothing to look at, so the
  // control appears only once there is another section to scroll past.
  collapsible?: boolean;
  collapsed?: boolean;
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
  if (!metadata) {
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
    renderMetadataAction(_('Profile'), metadata.webPageUrl),
    renderMetadataAction(_('Support'), metadata.supportUrl),
    renderMetadataAction(_('More details'), metadata.announceUrl),
  ].filter(Boolean) as HTMLElement[];

  // The tag is not something the block says: every node below already carries
  // it in front of its name. So a block with nothing else in it is a bordered
  // box repeating the list under it, and is left out entirely - which is what a
  // panel that publishes no metadata, and a subscription with the metadata
  // switched off, both come to.
  if (!title && !rows.length && !actions.length && !metadata.announce) {
    return undefined;
  }

  const name = [
    ...(metadata.subscriptionTag
      ? [
          E(
            'div',
            { class: 'fkp_dashboard-page__subscription-meta__heading' },
            [
              E(
                'span',
                {
                  class:
                    'fkp_dashboard-page__outbound-grid__item__subscription-tag',
                },
                metadata.subscriptionTag,
              ),
            ],
          ),
        ]
      : []),
    ...(title
      ? [
          E(
            'div',
            { class: 'fkp_dashboard-page__subscription-meta__title' },
            title,
          ),
        ]
      : []),
  ];

  return E('div', { class: 'fkp_dashboard-page__subscription-meta' }, [
    E('div', { class: 'fkp_dashboard-page__subscription-meta__main' }, [
      name.length
        ? E(
            'div',
            { class: 'fkp_dashboard-page__subscription-meta__name' },
            name,
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

function renderDefaultState({
  section,
  onChooseOutbound,
  onCopyOutbound,
  onShowUrlTestInfo,
  onShowFallbackInfo,
  onTestLatency,
  onTestOutboundLatency,
  onSortByLatencyChange,
  onCollapsedChange,
  onEditSection,
  latencyFetching,
  latencyFetchingTargets = new Set(),
  sortByLatency,
  collapsible,
  collapsed,
}: IRenderSectionsProps) {
  function testLatency() {
    const target = sectionLatencyTarget(section);
    if (target) {
      onTestLatency(target.tag);
    }
  }

  function renderOutbound(outbound: Forkop.Outbound) {
    const canCopyLink =
      Boolean(outbound.canCopyLink) || isCopyableProxyLink(outbound.link);
    const groupInfo = outbound.urlTestInfo || outbound.fallbackInfo;
    // A group with no members cannot dial, so there is nothing to measure and
    // nothing to select: the Clash API reports it, empty, until one appears.
    const hasGroupMembers = !groupInfo || groupInfo.outbounds.length > 0;
    const canChooseOutbound =
      section.withTagSelect &&
      outbound.runtimeAvailable !== false &&
      hasGroupMembers &&
      !outbound.selected;
    const showLatency = hasGroupMembers;
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
    const latencyClass = latencyClassName(outbound.latency);
    const latencyValue = outbound.latency ? `${outbound.latency}ms` : _('N/A');
    const latency = showLatency
      ? E(
          'button',
          {
            type: 'button',
            class: `btn fkp_dashboard-page__outbound-grid__item__latency ${latencyClass}`,
            title: _('Test latency'),
            'aria-label': _('Test latency'),
            'aria-busy': outboundLatencyFetching ? 'true' : undefined,
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
  const collapseLabel = collapsed ? _('Expand section') : _('Collapse section');
  const collapseAction = collapsible
    ? E(
        'button',
        {
          type: 'button',
          class: [
            'btn fkp_dashboard-page__outbound-section__collapse',
            collapsed
              ? 'fkp_dashboard-page__outbound-section__collapse--collapsed'
              : '',
          ]
            .filter(Boolean)
            .join(' '),
          title: collapseLabel,
          'aria-label': collapseLabel,
          'aria-expanded': collapsed ? 'false' : 'true',
          click: (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            onCollapsedChange?.(section.sectionName, !collapsed);
          },
        },
        renderChevronUpIcon24(),
      )
    : undefined;

  // The node the choice landed on is what a reader looks for in a section, and
  // the one thing a folded section still has to say about itself. A section of
  // one node shows it on its only card.
  const selected =
    section.withTagSelect && (collapsed || section.outbounds.length > 1)
      ? section.outbounds.find((outbound) => outbound.selected)
      : undefined;
  const current = selected
    ? E('span', { class: 'fkp_dashboard-page__outbound-section__current' }, [
        E(
          'span',
          { class: 'fkp_dashboard-page__outbound-section__current-name' },
          renderFlagEmojis(selected.displayName),
        ),
        ...(selected.latency
          ? [
              E(
                'span',
                { class: latencyClassName(selected.latency) },
                `${selected.latency}ms`,
              ),
            ]
          : []),
      ])
    : undefined;

  const editLabel = getRuleEditButtonText();
  const editAction = onEditSection
    ? E(
        'button',
        {
          type: 'button',
          class: 'btn fkp_dashboard-page__outbound-section__edit',
          title: editLabel,
          'aria-label': editLabel,
          click: (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            onEditSection(section.sectionName);
          },
        },
        renderCogIcon24(),
      )
    : undefined;

  // The whole header is the fold's target, not only the chevron in it: the
  // buttons on it keep their clicks to themselves, and a click that ends a
  // text selection was not meant for it.
  const headerFold = collapsible
    ? {
        class:
          'fkp_dashboard-page__outbound-section__title-section fkp_dashboard-page__outbound-section__title-section--foldable',
        click: () => {
          if (window.getSelection()?.isCollapsed !== false) {
            onCollapsedChange?.(section.sectionName, !collapsed);
          }
        },
      }
    : { class: 'fkp_dashboard-page__outbound-section__title-section' };

  return E('div', { class: 'fkp_dashboard-page__outbound-section' }, [
    E('div', headerFold, [
      E('div', { class: 'fkp_dashboard-page__outbound-section__heading' }, [
        ...(collapseAction ? [collapseAction] : []),
        E(
          'div',
          {
            class: 'fkp_dashboard-page__outbound-section__title-section__title',
          },
          section.displayName,
        ),
        ...(current ? [current] : []),
      ]),
      E(
        'div',
        {
          class: 'fkp_dashboard-page__outbound-section__title-section__actions',
        },
        [
          ...(latencySortAction ? [latencySortAction] : []),
          E(
            'button',
            {
              type: 'button',
              class: 'btn dashboard-sections-grid-item-test-latency',
              title: _('Test latency'),
              'aria-label': _('Test latency'),
              'aria-busy': latencyFetching ? 'true' : undefined,
              disabled: latencyFetching ? true : undefined,
              click: (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                if (!latencyFetching) testLatency();
              },
            },
            latencyFetching ? renderLoaderCircleIcon24() : renderGaugeIcon24(),
          ),
          ...(editAction ? [editAction] : []),
        ],
      ),
    ]),
    // Everything below the title is what folds away: the subscription lines
    // and every card. What stays is the title row, so the section is still
    // there to unfold and its actions still work on it.
    ...(collapsed
      ? []
      : [
          E('div', { class: 'fkp_dashboard-page__outbound-grid' }, [
            ...metadataNodes,
            ...outbounds.map((outbound) => renderOutbound(outbound)),
          ]),
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
    latencyFetching: false,
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
