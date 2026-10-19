// language=CSS
import { DashboardTab } from './forkop/tabs/dashboard';
import { DiagnosticTab } from './forkop/tabs/diagnostic';
import { MonitoringTab } from './forkop/tabs/monitoring';
import { LogsTab } from './forkop/tabs/logs';
import { PartialStyles } from './partials';
import { FORKOP_UCI_PACKAGE as FORKOP_CBI_PREFIX } from './constants';
import { SPIN_PERIOD_MS } from './helpers/spinPhase';

export const GlobalStyles = `
${DashboardTab.styles}
${DiagnosticTab.styles}
${MonitoringTab.styles}
${LogsTab.styles}
${PartialStyles}


/* The version beside the name. The theme draws h2 small in its lowest text
   colour, which its dark variant makes nearly black on black. */
#cbi-${FORKOP_CBI_PREFIX} > h2 > small {
    color: var(--text-color-medium, #888);
    font-weight: normal;
}

/* The service state after the version, muted like it; only the dot carries
   the colour of the state, and it pulses while an operation runs. */
.fkp_page-status {
    margin-left: 0.4em;
    white-space: nowrap;
}

.fkp_page-status__dot {
    display: inline-block;
    width: 0.55em;
    height: 0.55em;
    margin-right: 0.35em;
    border-radius: 50%;
    vertical-align: 0.1em;
}

.fkp_page-status--success .fkp_page-status__dot {
    background: var(--success-color-medium, green);
}

.fkp_page-status--error .fkp_page-status__dot {
    background: var(--error-color-medium, red);
}

.fkp_page-status--progress .fkp_page-status__dot {
    background: var(--warn-color-medium, #b8860b);
    animation: fkp_page-status-pulse 1.2s ease-in-out infinite;
}

@keyframes fkp_page-status-pulse {
    50% {
        opacity: 0.3;
    }
}

/* Hide extra H3 for settings tab */
#cbi-${FORKOP_CBI_PREFIX}-settings > h3 {
    display: none;
}

/* Hide extra H3 for rules tab */
#cbi-${FORKOP_CBI_PREFIX}-section > h3:nth-child(1) {
    display: none;
}

/* Rule reorder visuals */
#cbi-${FORKOP_CBI_PREFIX}-section {
    position: relative;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row {
    position: relative;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.placeholder {
    opacity: 1;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.placeholder em {
    font-style: italic;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-above::after,
#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-below::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    height: 2px;
    border-radius: 2px;
    background: var(--primary-color-high, #1976d2);
    pointer-events: none;
    z-index: 2;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-above::after {
    top: -1px;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-below::after {
    bottom: -1px;
}

/* Centered class helper */
.centered {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Rotate class helper. Each spinner is handed an animation-delay that places it
   in this turn - see helpers/spinPhase.ts - so the period has to stay the one
   that delay is a fraction of. */
.rotate {
    animation: spin ${SPIN_PERIOD_MS}ms linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* Skeleton styles*/
.skeleton {
    background-color: var(--background-color-low, #e0e0e0);
    border-radius: 4px;
    position: relative;
    overflow: hidden;
}

.skeleton::after {
    content: '';
    position: absolute;
    top: 0;
    left: -150%;
    width: 150%;
    height: 100%;
    background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.4),
            transparent
    );
    animation: skeleton-shimmer 1.6s infinite;
}

@keyframes skeleton-shimmer {
    100% {
        left: 150%;
    }
}
/* Toast */
.toast-container {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    z-index: 9999;
    font-family: system-ui, sans-serif;
}

.toast {
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    padding: 10px 16px;
    border-radius: 6px;
    color: #fff;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    min-width: 220px;
    max-width: 340px;
    text-align: center;
}

.toast-success {
    background-color: #28a745;
}

.toast-error {
    background-color: #dc3545;
}

.toast.visible {
    opacity: 1;
    transform: translateY(0);
}
`;
