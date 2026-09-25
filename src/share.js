/* share.js — share links: the whole spec travels in the URL fragment, so no server ever sees it.
 *
 *   #s=<base64url(deflate-raw(UTF-8 spec JSON))>     compact; what the studio writes
 *   #j=<base64url(UTF-8 spec JSON)>                  uncompressed; for tools that cannot deflate
 * base64url is RFC 4648 §5 without padding. The payload is the spec itself (scale, when not "doc", as spec.scale).
 * Python: base64.urlsafe_b64encode(zlib.compressobj(9, zlib.DEFLATED, -15) …).rstrip(b"=") — see agent/dgs.
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};

  function b64url(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pipe(bytes, stream) { return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  var canDeflate = typeof CompressionStream === 'function';

  // encode(spec) → Promise<fragment> (with the leading '#')
  function encode(spec) {
    var bytes = new TextEncoder().encode(JSON.stringify(spec));
    if (!canDeflate) return Promise.resolve('#j=' + b64url(bytes));
    return pipe(bytes, new CompressionStream('deflate-raw')).then(function (z) { return '#s=' + b64url(z); });
  }
  // decode(hash) → Promise<spec | null>; null when the fragment is not a share link. Rejects with a specific
  // message when it is one but cannot be read.
  function decode(hash) {
    var m = /^#?([sj])=([A-Za-z0-9_-]+)$/.exec(hash || '');
    if (!m) return Promise.resolve(null);
    var bytes;
    try { bytes = unb64url(m[2]); } catch (e) { return Promise.reject(new Error('share link: the fragment is not valid base64url')); }
    var got = m[1] === 'j' ? Promise.resolve(bytes)
      : canDeflate ? pipe(bytes, new DecompressionStream('deflate-raw')).catch(function () { throw new Error('share link: the data is not valid deflate-raw (was the link cut short?)'); })
      : Promise.reject(new Error('share link: this browser cannot decompress #s= links; use a current browser'));
    return got.then(function (b) {
      try { return JSON.parse(new TextDecoder().decode(b)); } catch (e) { throw new Error('share link: the payload is not JSON — ' + e.message); }
    });
  }
  Studio.share = { encode: encode, decode: decode };
})();
