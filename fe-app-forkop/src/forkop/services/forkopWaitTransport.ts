// The service publishes the state and the logs under one object.
export const FORKOP_SERVICE_OBJECT = 'forkop';

// An ordinary call, answered from what the service already holds.
export const FORKOP_CALL_TIMEOUT_MS = 5000;

// The daemon releases waiters at 15 s (MAX_WAIT_MS in service/state_service.uc), so the browser
// must wait longer than that.
export const FORKOP_WAIT_TIMEOUT_MS = 20000;

// After a failure other than "no such object"; also how often a background tab checks whether
// it is visible again.
export const FORKOP_WAIT_RETRY_MS = 3000;
