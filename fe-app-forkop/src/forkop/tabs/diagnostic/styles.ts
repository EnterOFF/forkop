// language=CSS
import { FORKOP_UCI_PACKAGE as FORKOP_CBI_PREFIX } from '../../../constants';

export const styles = `

#cbi-${FORKOP_CBI_PREFIX}-diagnostic > h3 {
    display: none;
}

/* The page takes the width of the content column, as the other tabs do. The
   tab is one DummyValue, and the theme lays a .cbi-value out as a flex row, where
   the page would be as wide as its content and would grow with whatever a check
   reports. The layout follows that width rather than the window's. */
#cbi-${FORKOP_CBI_PREFIX}-diagnostic-_mount_node {
    display: block;
    container-type: inline-size;
}

/* The controls are as wide as their own buttons need, never narrower than the
   longest system information row on one line - "Sing-box
   1.13.18-extended-2.6.5-f100" is 264px with the card around it. The checks sit
   beside them at a reading width, and a check value with nothing to break at
   wraps inside that width: nothing a check reports widens the page or moves the
   controls. */
.fkp_diagnostic-page {
    display: grid;
    grid-template-columns: minmax(17rem, max-content) minmax(0, 38rem);
    grid-column-gap: 10px;
    align-items: start;
    width: 100%;
}

.fkp_diagnostic-page__controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-row-gap: 10px;
}

.fkp_diagnostic-page__controls__actions {
    border: 2px var(--background-color-low, lightgray) solid;
    border-radius: 4px;
    padding: 10px;

    display: grid;
    grid-template-columns: auto;
    grid-row-gap: 10px;

}

.fkp_diagnostic-page__controls__actions > .fkp-partial-button {
    width: 100%;
    min-width: 0;
    margin-left: 0;
}

/* System information does not get a vote on how wide the column is: its values
   arrive one at a time, and a column measured against them steps sideways once
   per row while the page fills in. A definite zero width keeps the block out of
   that measurement, and the percentage minimum fills the column it is given. */
.fkp_diagnostic-page__controls__system-info {
    width: 0;
    min-width: 100%;

    border: 2px var(--background-color-low, lightgray) solid;
    border-radius: 4px;
    padding: 10px;

    display: grid;
    grid-template-columns: auto;
    grid-row-gap: 10px;
}

.fkp_diagnostic-page__controls__system-info__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-column-gap: 5px;
}

/* A version string carries no space to break at, so it may break anywhere and
   wraps inside the controls column instead of widening it. */
.fkp_diagnostic-page__controls__system-info__row > div {
    min-width: 0;
    overflow-wrap: anywhere;
}

.fkp_diagnostic-page__results {
    display: grid;
    grid-template-columns: 1fr;
    grid-row-gap: 10px;
}

.fkp_diagnostic-page__run_check_wrapper button {
    width: 100%;
}

.fkp_diagnostic-page__checks {
    display: grid;
    grid-template-columns: 1fr;
    grid-row-gap: 10px;
}

/* Below about 19rem of checks beside the controls, the two stack. */
@container (max-width: 599px) {
    .fkp_diagnostic-page {
        grid-template-columns: minmax(0, 1fr);
    }
}

.fkp_diagnostic_alert {
    border: 2px var(--background-color-low, lightgray) solid;
    border-radius: 4px;

    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    grid-column-gap: 10px;
    align-items: center;
    padding: 10px;
}

.fkp_diagnostic_alert--loading {
    border: 2px var(--primary-color-high, dodgerblue) solid;
}

.fkp_diagnostic_alert--warning {
    border: 2px var(--warn-color-medium, orange) solid;
    color: var(--warn-color-medium, orange);
}

.fkp_diagnostic_alert--error {
    border: 2px var(--error-color-medium, red) solid;
    color: var(--error-color-medium, red);
}

.fkp_diagnostic_alert--success {
    border: 2px var(--success-color-medium, green) solid;
    color: var(--success-color-medium, green);
}

.fkp_diagnostic_alert__title {
    display: block;
}

.fkp_diagnostic_alert__summary {
    margin-top: 10px;
}

.fkp_diagnostic_alert__summary__item {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    grid-column-gap: 10px;
}

/* A key and the value it labels, side by side while both fit and stacked when
   they stop fitting. Whether a row needs the break depends on how long its own
   key is, so each row decides for itself: the value keeps 8rem beside its key,
   and below that drops under it with the full width of the row. */
.fkp_diagnostic_alert__summary__item__body {
    display: flex;
    flex-wrap: wrap;
    column-gap: 10px;
}

/* Neither cell may be wider than what it was given. A key or a value with
   nothing to break at - an address list, a version, a server name - would
   otherwise be the width of the row it sits in. */
.fkp_diagnostic_alert__summary__item__key {
    min-width: 0;
    overflow-wrap: anywhere;
}

.fkp_diagnostic_alert__summary__item__value {
    flex: 1 1 8rem;
    min-width: 0;
    overflow-wrap: anywhere;
}

.fkp_diagnostic_alert__summary__item--error {
    color: var(--error-color-medium, red);
}

.fkp_diagnostic_alert__summary__item--warning {
    color: var(--warn-color-medium, orange);
}

.fkp_diagnostic_alert__summary__item--success {
    color: var(--success-color-medium, green);
}

.fkp_diagnostic_alert__summary__item__icon {
    width: 16px;
    height: 16px;
}
`;
