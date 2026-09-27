// What both parked requests know about the daemon they park on.
//
// The page keeps two long polls open against the same ubus object: one for the
// runtime state, one for the log tail. Each asks the daemon to hold the request
// until something happens, and both agree with the daemon here about how long
// it will be held.

// The service publishes the state and the logs under one object.
export const FORKOP_SERVICE_OBJECT = 'forkop';

// An ordinary call, answered from what the service already holds.
export const FORKOP_CALL_TIMEOUT_MS = 5000;

// A parked call. The daemon releases every waiter at FORKOP_STATE_MAX_WAIT_MS,
// 15 seconds by default (service/state_service.uc), so the client has to be
// willing to wait longer than that - a reply arriving exactly at the ceiling
// must not be raced by the browser giving up on it.
export const FORKOP_WAIT_TIMEOUT_MS = 20000;

// After a failure that is not "no such object": something is wrong rather than
// absent, and reissuing immediately would not help. It is also how long a
// backgrounded tab waits before looking at whether it is visible again.
export const FORKOP_WAIT_RETRY_MS = 3000;
