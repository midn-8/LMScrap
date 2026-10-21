// Runs in the PAGE (MAIN world) at document_start, before the SPA loads, so it
// hooks the app's own XHR/fetch and grabs the auth headers from every API call.
// Deterministic — no dependence on service-worker timing.
(() => {
  const grab = (h) => {
    const a = h.authorization;
    if (a && a.startsWith("Bearer ")) {
      window.postMessage({
        source: "lmscrap",
        auth: { authorization: a, roleId: h.roleid || "", rOId: h.roid || "" },
      }, "*");
    }
  };

  const setH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    (this.__h = this.__h || {})[k.toLowerCase()] = v;
    return setH.apply(this, arguments);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__h) grab(this.__h);
    return send.apply(this, arguments);
  };

  const fetch0 = window.fetch;
  window.fetch = function (input, init) {
    try {
      const src = (init && init.headers) || (input && input.headers);
      if (src) {
        const h = {};
        if (typeof src.forEach === "function") src.forEach((v, k) => (h[k.toLowerCase()] = v));
        else for (const k in src) h[k.toLowerCase()] = src[k];
        grab(h);
      }
    } catch (_) {}
    return fetch0.apply(this, arguments);
  };
})();
