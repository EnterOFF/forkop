// language=CSS
import { FORKOP_UCI_PACKAGE as FORKOP_CBI_PREFIX } from '../../../constants';

export const styles = `
#cbi-${FORKOP_CBI_PREFIX}-monitoring-_mount_node {
    margin: 16px 0 22px;
    padding: 0;
}

#cbi-${FORKOP_CBI_PREFIX}-monitoring-_mount_node > .cbi-value-title {
    display: none;
}

#cbi-${FORKOP_CBI_PREFIX}-monitoring-_mount_node > .cbi-value-field {
    margin-left: 0;
    width: 100%;
}

#cbi-${FORKOP_CBI_PREFIX}-monitoring-_mount_node > div {
    width: 100%;
}

#cbi-${FORKOP_CBI_PREFIX}-monitoring > h3 {
    display: none;
}

.fkp_monitoring-page {
    --fkp-monitoring-control-height: 34px;
    --fkp-monitoring-row-action-size: 24px;
    --fkp-monitoring-divider-color: rgba(127, 127, 127, 0.22);
    --fkp-monitoring-soft-bg: rgba(127, 127, 127, 0.08);
    --fkp-monitoring-soft-bg-hover: rgba(127, 127, 127, 0.14);
    --fkp-monitoring-danger-color: var(--error-color-medium, #d32f2f);
    --fkp-monitoring-success-color: var(--success-color-medium, #2e7d32);
    --fkp-monitoring-paused-color: var(--primary-color-high, #1976d2);

    width: 100%;
    min-width: 0;
}

.fkp_monitoring-page__panel {
    margin-top: 0;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: transparent;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__icon-button {
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    line-height: 1;
    margin: 0;
    border: 1px solid var(--fkp-monitoring-divider-color) !important;
    border-radius: 6px;
    background: var(--fkp-monitoring-soft-bg) !important;
    color: var(--text-color-medium) !important;
    box-shadow: none;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__icon-button:hover:not(:disabled) {
    background: var(--fkp-monitoring-soft-bg-hover) !important;
    color: var(--text-color-high) !important;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__icon-button--active {
    background: rgba(25, 118, 210, 0.16) !important;
    color: var(--primary-color-high, #1976d2) !important;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__icon-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.fkp_monitoring-page #monitoring-close-all.btn.fkp_monitoring-page__icon-button {
    order: 2;
    border-color: rgba(217, 83, 79, 0.4) !important;
    background: transparent !important;
    color: var(--fkp-monitoring-danger-color) !important;
}

.fkp_monitoring-page #monitoring-close-all.btn.fkp_monitoring-page__icon-button:hover:not(:disabled) {
    border-color: rgba(217, 83, 79, 0.6) !important;
    background: transparent !important;
    color: color-mix(in srgb, var(--fkp-monitoring-danger-color) 70%, white) !important;
}

.fkp_monitoring-page #monitoring-pause-toggle.btn.fkp_monitoring-page__icon-button,
.fkp_monitoring-page #monitoring-pause-toggle.btn.fkp_monitoring-page__icon-button--active {
    order: 1;
    border-color: rgba(128, 128, 128, 0.3) !important;
    background: transparent !important;
    color: var(--text-color-medium, #888) !important;
}

.fkp_monitoring-page #monitoring-pause-toggle.btn.fkp_monitoring-page__icon-button:hover:not(:disabled),
.fkp_monitoring-page #monitoring-pause-toggle.btn.fkp_monitoring-page__icon-button--active:hover:not(:disabled) {
    border-color: rgba(128, 128, 128, 0.6) !important;
    background: transparent !important;
    color: var(--text-color-high, #eee) !important;
}

.fkp_monitoring-page__icon-button svg,
.fkp_monitoring-page__row-action svg {
    width: 16px;
    height: 16px;
    display: block;
    flex: 0 0 auto;
}

.fkp_monitoring-page__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    width: 100%;
    min-width: 0;
}

.fkp_monitoring-page__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
}

.fkp_monitoring-page__tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    width: max-content;
    padding: 2px;
    border: 1px solid var(--fkp-monitoring-divider-color);
    border-radius: 6px;
    background: var(--fkp-monitoring-soft-bg);
    box-sizing: border-box;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__tab {
    height: calc(var(--fkp-monitoring-control-height) - 6px);
    min-height: calc(var(--fkp-monitoring-control-height) - 6px);
    margin: 0;
    padding: 0 12px;
    border: 0 !important;
    border-radius: 4px;
    background: transparent !important;
    color: var(--text-color-medium) !important;
    box-shadow: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 600;
    line-height: 1;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__tab:hover {
    background: var(--fkp-monitoring-soft-bg-hover) !important;
    color: var(--text-color-high) !important;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__tab--active {
    background: rgba(25, 118, 210, 0.16) !important;
    color: var(--primary-color-high, #1976d2) !important;
    font-weight: 700;
}

.fkp_monitoring-page__tab-label {
    display: inline-block;
}

.fkp_monitoring-page__tab-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(127, 127, 127, 0.22);
    color: var(--text-color-medium);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}

.fkp_monitoring-page__tab--active .fkp_monitoring-page__tab-badge {
    background: rgba(25, 118, 210, 0.22);
    color: var(--primary-color-high, #1976d2);
}

.fkp_monitoring-page__filters {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    min-width: 0;
}

.fkp_monitoring-page__device-filter {
    width: min(220px, 100%);
    min-width: 0;
    height: var(--fkp-monitoring-control-height) !important;
    min-height: var(--fkp-monitoring-control-height) !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    margin: 0 !important;
    box-sizing: border-box;
    line-height: calc(var(--fkp-monitoring-control-height) - 2px) !important;
}

.fkp_monitoring-page__search {
    position: relative;
    display: flex;
    align-items: center;
    width: min(320px, 100%);
    min-width: 0;
    height: var(--fkp-monitoring-control-height);
    margin: 0;
}

.fkp_monitoring-page__search-icon {
    position: absolute;
    left: 8px;
    width: 16px;
    height: 16px;
    color: var(--text-color-medium);
    pointer-events: none;
}

.fkp_monitoring-page__search-icon svg {
    width: 16px;
    height: 16px;
    display: block;
}

.fkp_monitoring-page__search-input {
    width: 100%;
    height: var(--fkp-monitoring-control-height) !important;
    min-height: var(--fkp-monitoring-control-height) !important;
    padding-left: 30px !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    margin: 0 !important;
    box-sizing: border-box;
    line-height: calc(var(--fkp-monitoring-control-height) - 2px) !important;
}

.fkp_monitoring-page__body {
    margin-top: 0;
    width: 100%;
    min-width: 0;
}

.fkp_monitoring-page__table-wrap {
    width: 100%;
    overflow-x: auto;
    margin-bottom: 0;
}

.fkp_monitoring-page__table {
    width: 100%;
    min-width: 840px;
    table-layout: fixed;
    border-collapse: collapse;
    border-spacing: 0;
    margin-bottom: 0;
}

.fkp_monitoring-page__table th,
.fkp_monitoring-page__table td {
    padding: 8px 6px;
    border-bottom: 1px solid var(--fkp-monitoring-divider-color);
    box-sizing: border-box;
    text-align: left;
    vertical-align: middle;
    overflow: hidden;
    white-space: nowrap;
}

.fkp_monitoring-page__table th {
    color: var(--text-color-medium);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-bottom-color: rgba(127, 127, 127, 0.32);
}

/*
 * The layout is fixed, so a heading wider than its share is cut off. The two
 * traffic shares hold the arrow and the word above them, not just the digits.
 */
.fkp_monitoring-page__table th:nth-child(1) {
    width: 26%;
}

.fkp_monitoring-page__table th:nth-child(2) {
    width: 6%;
}

.fkp_monitoring-page__table th:nth-child(3) {
    width: 13.75%;
}

.fkp_monitoring-page__table th:nth-child(4) {
    width: 8%;
}

.fkp_monitoring-page__table th:nth-child(5) {
    width: 12.25%;
}

.fkp_monitoring-page__table th:nth-child(6) {
    width: 10%;
}

.fkp_monitoring-page__table th:nth-child(7) {
    width: 16%;
}

.fkp_monitoring-page__table th:nth-child(8) {
    width: 8%;
}

.fkp_monitoring-page__table tbody tr:last-child td {
    border-bottom: 0;
}

.fkp_monitoring-page__table td:last-child {
    padding-top: 0;
    padding-bottom: 0;
}

.fkp_monitoring-page__table th:nth-child(4),
.fkp_monitoring-page__table td:nth-child(4),
.fkp_monitoring-page__table th:nth-child(5),
.fkp_monitoring-page__table td:nth-child(5),
.fkp_monitoring-page__table th:nth-child(6),
.fkp_monitoring-page__table td:nth-child(6) {
    text-align: right;
}

.fkp_monitoring-page__table th:nth-child(7),
.fkp_monitoring-page__table td:nth-child(7) {
    text-align: left;
}

.fkp_monitoring-page__table th:last-child,
.fkp_monitoring-page__table td:last-child {
    text-align: center;
}

.fkp_monitoring-page__value {
    display: block;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    line-height: 1.3;
    color: var(--text-color-high);
    font-size: 13px;
    user-select: text;
}

.fkp_monitoring-page__source-value {
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: 5px;
}

.fkp_monitoring-page__source-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fkp_monitoring-page__source-ip {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-color-medium);
    font-size: 12px;
}

.fkp_monitoring-page__source-value--ip-only {
    color: var(--text-color-high);
}

.fkp_monitoring-page__route {
    display: inline-block;
    width: auto;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(128, 128, 128, 0.15);
    color: var(--text-color-high);
    font-size: 11px;
    font-weight: 500;
}

.fkp_monitoring-page__network {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-color-medium, #bbb);
    font-family: inherit;
    font-size: 13px;
    text-transform: lowercase;
}

.fkp_monitoring-page__table td:nth-child(4) .fkp_monitoring-page__value,
.fkp_monitoring-page__table td:nth-child(5) .fkp_monitoring-page__value,
.fkp_monitoring-page__table td:nth-child(6) .fkp_monitoring-page__value {
    color: var(--text-color-medium, #bbb);
    font-family: inherit;
    text-align: right;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__row-action {
    width: var(--fkp-monitoring-row-action-size);
    height: var(--fkp-monitoring-row-action-size);
    min-width: var(--fkp-monitoring-row-action-size);
    min-height: var(--fkp-monitoring-row-action-size);
    padding: 0;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    margin: 0;
    border: 0 !important;
    border-radius: 999px;
    background: transparent !important;
    color: var(--fkp-monitoring-danger-color) !important;
    box-shadow: none;
    cursor: pointer;
}

.fkp_monitoring-page__row-action svg {
    width: 14px;
    height: 14px;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__row-action:hover:not(:disabled) {
    background: var(--fkp-monitoring-soft-bg-hover) !important;
    color: var(--fkp-monitoring-danger-color) !important;
}

.fkp_monitoring-page .btn.fkp_monitoring-page__row-action:disabled {
    opacity: 0.45;
    cursor: wait;
}

.fkp_monitoring-page__row--closing {
    opacity: 0.55;
}

.fkp_monitoring-page__state {
    min-height: 90px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color-medium);
    text-align: center;
    box-sizing: border-box;
}

.fkp_monitoring-page__state-cell {
    padding: 0 !important;
}

.fkp_monitoring-page__state--error {
    color: var(--error-color-medium, #d32f2f);
}

@media (max-width: 900px) {
    .fkp_monitoring-page__controls {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
        gap: 12px;
    }

    .fkp_monitoring-page__tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-column: 1 / -1;
        width: 100%;
    }

    .fkp_monitoring-page__filters {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(180px, 320px);
        gap: 12px;
    }

    .fkp_monitoring-page__actions {
        grid-column: 2;
    }

    .fkp_monitoring-page__device-filter,
    .fkp_monitoring-page__search {
        width: 100%;
        max-width: none;
    }

    .fkp_monitoring-page__table {
        min-width: 620px;
    }

    .fkp_monitoring-page__table th,
    .fkp_monitoring-page__table td {
        padding-right: 4px;
        padding-left: 4px;
    }
}

/*
 * Below the width where the eight-column table still fits, every connection
 * becomes a three-line card built from the same cells, so nothing scrolls
 * sideways. Line one is the host with the close action, line two the source
 * with route and protocol, line three the duration with the traffic counters.
 */
@media (max-width: 640px) {
    .fkp_monitoring-page__table-wrap {
        overflow-x: visible;
    }

    .fkp_monitoring-page__table,
    .fkp_monitoring-page__table tbody {
        display: block;
        width: 100%;
        min-width: 0;
    }

    .fkp_monitoring-page__table thead {
        display: none;
    }

    .fkp_monitoring-page__state-row {
        display: block;
    }

    .fkp_monitoring-page__state-cell {
        display: block;
    }

    .fkp_monitoring-page__row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: 8px;
        row-gap: 2px;
        padding: 8px 0;
        border-bottom: 1px solid var(--fkp-monitoring-divider-color);
    }

    .fkp_monitoring-page__row:last-child {
        border-bottom: 0;
    }

    .fkp_monitoring-page__row::before,
    .fkp_monitoring-page__row::after {
        content: '';
        flex: 0 0 100%;
        height: 0;
    }

    .fkp_monitoring-page__row::before {
        order: 3;
    }

    .fkp_monitoring-page__row::after {
        display: none;
        order: 7;
    }

    .fkp_monitoring-page__table td {
        display: block;
        flex: 0 0 auto;
        max-width: 100%;
        padding: 0;
        border-bottom: 0;
    }

    .fkp_monitoring-page__table td:nth-child(1) {
        order: 1;
        flex: 1 1 auto;
        min-width: 0;
    }

    .fkp_monitoring-page__table td:nth-child(8) {
        order: 2;
    }

    .fkp_monitoring-page__table td:nth-child(7) {
        order: 4;
        flex: 0 1 auto;
        min-width: 0;
    }

    .fkp_monitoring-page__table td:nth-child(3) {
        order: 5;
    }

    .fkp_monitoring-page__table td:nth-child(2) {
        order: 6;
    }

    .fkp_monitoring-page__table td:nth-child(4) {
        order: 8;
    }

    .fkp_monitoring-page__table td:nth-child(5) {
        order: 9;
        margin-left: auto;
    }

    .fkp_monitoring-page__table td:nth-child(6) {
        order: 10;
    }

    .fkp_monitoring-page__table td:nth-child(1) .fkp_monitoring-page__value {
        font-weight: 600;
    }

    .fkp_monitoring-page__table td:nth-child(4),
    .fkp_monitoring-page__table td:nth-child(5),
    .fkp_monitoring-page__table td:nth-child(6) {
        display: flex;
        align-items: baseline;
        gap: 3px;
        color: var(--text-color-medium);
        font-size: 12px;
    }

    .fkp_monitoring-page__table td:nth-child(4) .fkp_monitoring-page__value,
    .fkp_monitoring-page__table td:nth-child(5) .fkp_monitoring-page__value,
    .fkp_monitoring-page__table td:nth-child(6) .fkp_monitoring-page__value {
        font-size: 12px;
    }

    .fkp_monitoring-page__table td:nth-child(5)::before {
        content: '\\2193';
    }

    .fkp_monitoring-page__table td:nth-child(6)::before {
        content: '\\2191';
    }

    .fkp_monitoring-page__row-action-placeholder {
        display: none;
    }
}

@media (max-width: 520px) {
    .fkp_monitoring-page__filters {
        display: contents;
    }

    .fkp_monitoring-page__device-filter {
        grid-column: 1 / -1;
    }

    .fkp_monitoring-page__search {
        grid-column: 1;
    }

    .fkp_monitoring-page__actions {
        grid-column: 2;
        align-self: flex-end;
    }
}

/* Narrow phones cannot hold the source and the counters on one line. */
@media (max-width: 480px) {
    .fkp_monitoring-page__row::after {
        display: block;
    }
}
`;
