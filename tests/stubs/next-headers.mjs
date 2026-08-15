/**
 * Stand-in for next/headers, which only resolves under Next's react-server condition. The unit
 * tests never exercise the cookie reading path (that needs a request context), so throwing here
 * is the honest behaviour => a test that accidentally relies on it fails loudly.
 */
export function cookies() {
  throw new Error('cookies() is not available outside a request; the unit tests must not reach it');
}

export function headers() {
  throw new Error('headers() is not available outside a request; the unit tests must not reach it');
}
