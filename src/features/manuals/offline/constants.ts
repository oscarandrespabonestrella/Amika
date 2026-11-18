// Names shared by the app (writes the saved manuals), the service worker (serves them) and the
// static offline page (lists them). `tests/unit/sw-logic.test.ts` fails if they drift apart.

/** Cache Storage bucket that holds the PDFs the user saved on this device. */
export const MANUALS_CACHE = "amika-manuals-v1";
/** URL space of the saved PDFs. The service worker answers these from the cache. */
export const FILE_PREFIX = "/offline/manuals/files/";
/** URL space of the small JSON description stored next to each PDF. */
export const META_PREFIX = "/offline/manuals/meta/";
/** The static page that lists the saved manuals with no network. */
export const OFFLINE_PAGE = "/offline/manuals.html";
