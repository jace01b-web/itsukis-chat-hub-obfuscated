/* test/security/_lib.js — a shim, not a library.
 *
 * The kept reference copies of old endpoints (spin.v54-original.vulnerable.js,
 * spin.v54-1-rewind.js) live in this folder so Vercel never deploys them - every file under
 * api/ becomes a live endpoint. But they contain `require('./_lib')` exactly as shipped, and
 * that resolves to this folder.
 *
 * Rather than edit those copies - which would weaken the comparison, since the point is to run
 * the code as it actually shipped - this file exists so the path resolves. The test harnesses
 * then replace it in require.cache with their in-memory fake, which is what they do to
 * api/_lib.js too.
 *
 * Nothing in the site or the real api/ folder uses this file.
 */
module.exports = require('../../api/_lib.js');
