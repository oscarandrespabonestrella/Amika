// Pure routing rules of the service worker (sw.js loads this with importScripts). They live
// apart so a unit test can check them without a browser. No DOM, no `self`, no side effects.
(function (root) {
  var SHELL_CACHE = "amika-offline-v1"; // the "you're offline" page and icon
  var MANUALS_CACHE = "amika-manuals-v1"; // rulebook PDFs the user saved on this device
  var FILE_PREFIX = "/offline/manuals/files/";
  var MANUALS_PAGE = "/offline/manuals.html";
  var PRECACHE = ["/offline.html", MANUALS_PAGE, "/icons/icon-192.png"];

  /**
   * What the worker does with a request:
   *  - "manual-file": a saved PDF, answered from the manuals cache (works with no network)
   *  - "manuals-page": the offline list of saved manuals, answered from the shell cache
   *  - "navigate": a page load; network first, the offline page if the network fails
   *  - "ignore": everything else goes straight to the network, untouched
   */
  function routeFor(method, mode, url, origin) {
    if (method !== "GET") return "ignore";
    var parsed;
    try {
      parsed = new URL(url, origin);
    } catch {
      return "ignore";
    }
    if (parsed.origin !== origin) return "ignore";
    if (parsed.pathname.indexOf(FILE_PREFIX) === 0) return "manual-file";
    if (parsed.pathname === MANUALS_PAGE) return "manuals-page";
    return mode === "navigate" ? "navigate" : "ignore";
  }

  /** Old shell caches to drop on activate. The manuals cache must NEVER be in this list. */
  function staleCaches(keys) {
    return keys.filter(function (key) {
      return key.indexOf("amika-offline-") === 0 && key !== SHELL_CACHE;
    });
  }

  var api = {
    SHELL_CACHE: SHELL_CACHE,
    MANUALS_CACHE: MANUALS_CACHE,
    FILE_PREFIX: FILE_PREFIX,
    MANUALS_PAGE: MANUALS_PAGE,
    PRECACHE: PRECACHE,
    routeFor: routeFor,
    staleCaches: staleCaches,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AmikaSw = api;
})(typeof self !== "undefined" ? self : this);
