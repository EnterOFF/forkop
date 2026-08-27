// language=CSS
import { FORKOP_UCI_PACKAGE as FORKOP_CBI_PREFIX } from '../../../constants';

export const styles = `

#cbi-${FORKOP_CBI_PREFIX}-diagnostic > h3 {
    display: none;
}

.fkp_diagnostic-page {
    /* Both tracks stay fractions. The page sits in a shrink-to-fit box, where a
       lone fr track collapses onto its own content instead of taking the rest of
       the row: the checks would end up as narrow as the word inside them. Two
       fractions size each other, which is what this column pair has always done.
       The controls carry the floor instead, see below.

       The checks take a zero minimum so the page's width stays theirs to read
       rather than theirs to set: an fr track is otherwise at least as wide as
       the longest unbreakable thing in it, and a summary value with nothing to
       break at would widen the track, the page, and the split with it. */
    display: grid;
    grid-template-columns: 1fr minmax(0, 2fr);
    grid-column-gap: 10px;
    align-items: start;
}

.fkp_diagnostic-page__controls {
    /* What the column is measured against: the available actions, whose labels
       are fixed text, floored at the width the longest system information row
       needs on one line. "Sing-box 1.13.18-extended-2.6.5-f100" measures 264px
       with the card padding around it, so 17rem leaves a few pixels over. */
    min-width: 17rem;

    display: grid;
    grid-template-columns: 1fr;
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

.fkp_diagnostic-page__controls__system-info__title {

}

.fkp_diagnostic-page__controls__system-info__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-column-gap: 5px;
}

/* What used to widen the controls column once per value while the page filled in.
   A version string carries no space to break at, so the column had to grow to fit
   it; allowed to break anywhere, it wraps inside the column instead and the split
   stays where it started. */
.fkp_diagnostic-page__controls__system-info__row > div {
    min-width: 0;
    overflow-wrap: anywhere;
}

.fkp_diagnostic-page__controls__system-info__row__tag {
    padding: 2px 4px;
    border: 1px transparent solid;
    border-radius: 4px;
    margin-left: 5px;
}

.fkp_diagnostic-page__controls__system-info__row__tag--neutral {
    border: 1px var(--background-color-high, gray) solid;
    color: var(--text-color-medium, gray);
}

.fkp_diagnostic-page__controls__system-info__row__tag--warning {
    border: 1px var(--warn-color-medium, orange) solid;
    color: var(--warn-color-medium, orange);
}

.fkp_diagnostic-page__controls__system-info__row__tag--success {
    border: 1px var(--success-color-medium, green) solid;
    color: var(--success-color-medium, green);
}

.fkp_diagnostic-page__results {
    display: grid;
    grid-template-columns: 1fr;
    grid-row-gap: 10px;
}

.fkp_diagnostic-page__run_check_wrapper {}

.fkp_diagnostic-page__run_check_wrapper button {
    width: 100%;
}

.fkp_diagnostic-page__checks {
    display: grid;
    grid-template-columns: 1fr;
    grid-row-gap: 10px;
}

/* Where the pair stops being worth keeping. The controls hold their 17rem
   whatever the window does, so a narrower page comes out of the checks beside
   them: 473px at a 780px window, 348px at 640px, and under about 19rem they are
   better off with the whole width than with a column of their own. The stack
   used to arrive at 800px, where the checks were still 493px wide.

   Stacked, the page also has to take the width it is given instead of sizing
   itself. Its box is a flex item - the value of a DummyValue reaches the theme
   inside an <output>, and the theme lays a .cbi-value out as a flex row - so
   left alone it settles on its own content: 444px of checks hugging the left
   edge of a 774px column, which is the whole of what this looked like before.
   A block mount node and a full-width page is what the Dashboard tab does for
   the same reason. */
@media (max-width: 620px) {
    #cbi-${FORKOP_CBI_PREFIX}-diagnostic-_mount_node {
        display: block;
    }

    .fkp_diagnostic-page {
        width: 100%;
        grid-template-columns: minmax(0, 1fr);
    }

    /* The floor exists so a column can be measured against it, and there is no
       column left to measure: the page is as wide as it is given. On a 320px
       screen the floor is wider than that. */
    .fkp_diagnostic-page__controls {
        min-width: 0;
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

.fkp_diagnostic_alert--skipped {}

.fkp_diagnostic_alert__icon {}

.fkp_diagnostic_alert__content {}

.fkp_diagnostic_alert__title {
    display: block;
}

.fkp_diagnostic_alert__description {}

.fkp_diagnostic_alert__summary {
    margin-top: 10px;
}

.fkp_diagnostic_alert__summary__item {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    grid-column-gap: 10px;
}

/* A key and the value it labels, side by side while both fit and stacked when
   they stop fitting. The key used to have a column of its own, sized to the
   whole of it, and the value took what was left: "Server #1: Публичный адрес"
   measures 183px, so against the 209px row of a 640px window it left 26px for
   the address - three characters to a line, three lines tall.

   Whether a row needs the break depends on how long its own key is, so each row
   decides for itself instead of every row breaking at one width of the window:
   the value keeps 8rem beside its key, and below that drops under it with the
   full width of the row. */
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
