// Wraps an async Express handler so a rejected promise is routed to
// next(error) instead of becoming an unhandled rejection that crashes the
// process. Express 4 does not do this automatically for async handlers.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
