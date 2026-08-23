import { renderSectionsPlaceholder, renderWidget } from './partials';

export function render() {
  return E(
    'div',
    {
      id: 'dashboard-status',
      class: 'fkp_dashboard-page',
    },
    [
      E('div', { class: 'fkp_dashboard-page__content' }, [
        // Widgets section
        E('div', { class: 'fkp_dashboard-page__widgets-section' }, [
          E(
            'div',
            { id: 'dashboard-widget-traffic' },
            renderWidget({
              loading: true,
              failed: false,
              title: '',
              items: [],
            }),
          ),
          E(
            'div',
            { id: 'dashboard-widget-traffic-total' },
            renderWidget({
              loading: true,
              failed: false,
              title: '',
              items: [],
            }),
          ),
          E(
            'div',
            { id: 'dashboard-widget-system-info' },
            renderWidget({
              loading: true,
              failed: false,
              title: '',
              items: [],
            }),
          ),
          E(
            'div',
            { id: 'dashboard-widget-service-info' },
            renderWidget({
              loading: true,
              failed: false,
              title: '',
              items: [],
            }),
          ),
        ]),
        // All outbounds
        E(
          'div',
          { id: 'dashboard-sections-grid' },
          renderSectionsPlaceholder({ loading: true, failed: false }),
        ),
      ]),
    ],
  );
}
