// Runs in the ISOLATED world (has chrome.* APIs). Bridges the page hook's
// postMessage to the background service worker, which stores the token.
window.addEventListener("message", (e) => {
  if (e.source === window && e.data && e.data.source === "lmscrap" && e.data.auth) {
    chrome.runtime.sendMessage({ type: "auth", auth: e.data.auth }).catch(() => {});
  }
});
