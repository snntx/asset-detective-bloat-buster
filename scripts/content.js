// content.js — Injected into every page. AJAX monitoring + DOM-impact tracking.

(function () {
  'use strict';

  if (window.__assetDetectiveLoaded) return;
  window.__assetDetectiveLoaded = true;

  // ── DOM snapshot ───────────────────────────────────────────────────────────
  // Collect all classes and IDs present in the DOM at scan time.
  // Background uses these to cross-reference JS function names.
  function snapshotDOM() {
    const classes = new Set();
    const ids     = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      el.className.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    });
    document.querySelectorAll('[id]').forEach(el => ids.add(el.id));
    return { classes: [...classes], ids: [...ids] };
  }

  // ── DOM mutation tracker ──────────────────────────────────────────────────
  let mutationCount        = 0;
  let domMutationClasses   = new Set();
  let domMutationIds       = new Set();

  const mutObs = new MutationObserver(mutations => {
    for (const m of mutations) {
      mutationCount++;
      // Capture classes/IDs added via DOM mutations (JS-driven changes)
      if (m.type === 'attributes' && m.attributeName === 'class') {
        m.target.className.split(/\s+/).filter(Boolean).forEach(c => domMutationClasses.add(c));
      }
      if (m.type === 'attributes' && m.attributeName === 'id' && m.target.id) {
        domMutationIds.add(m.target.id);
      }
      if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.className) node.className.split(/\s+/).filter(Boolean).forEach(c => domMutationClasses.add(c));
          if (node.id) domMutationIds.add(node.id);
          // Walk children too
          node.querySelectorAll?.('[class],[id]').forEach(el => {
            if (el.className) el.className.split(/\s+/).filter(Boolean).forEach(c => domMutationClasses.add(c));
            if (el.id) domMutationIds.add(el.id);
          });
        });
      }
    }
  });

  mutObs.observe(document.documentElement, {
    childList:  true,
    subtree:    true,
    attributes: true,
    attributeFilter: ['class', 'id'],
  });

  // ── AJAX Monitor ──────────────────────────────────────────────────────────
  class AjaxMonitor {
    constructor(delay = 3000) {
      this.delay = delay;
      this.pendingRequests = 0;
      this.lastActivityTime = Date.now();
      this.observers = [];
      this._origXHRSend = null;
      this._origFetch   = null;
    }

    start() {
      this._patchXHR();
      this._patchFetch();
      this._watchDOM();
      return this._waitForQuiet();
    }

    _patchXHR() {
      const self = this;
      this._origXHRSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (...args) {
        self.pendingRequests++;
        self._activity();
        this.addEventListener('loadend', () => {
          self.pendingRequests = Math.max(0, self.pendingRequests - 1);
          self._activity();
        });
        return self._origXHRSend.apply(this, args);
      };
    }

    _patchFetch() {
      const self = this;
      this._origFetch = window.fetch;
      window.fetch = function (...args) {
        self.pendingRequests++;
        self._activity();
        return self._origFetch.apply(this, args).finally(() => {
          self.pendingRequests = Math.max(0, self.pendingRequests - 1);
          self._activity();
        });
      };
    }

    _watchDOM() {
      const obs = new MutationObserver(() => this._activity());
      obs.observe(document.documentElement, { childList: true, subtree: true });
      this.observers.push(obs);
    }

    _activity() { this.lastActivityTime = Date.now(); }

    _waitForQuiet() {
      return new Promise(resolve => {
        const check = () => {
          const quiet = Date.now() - this.lastActivityTime >= this.delay;
          if (this.pendingRequests === 0 && quiet) {
            this.cleanup();
            resolve();
          } else {
            setTimeout(check, 300);
          }
        };
        setTimeout(check, 500);
      });
    }

    cleanup() {
      if (this._origXHRSend) XMLHttpRequest.prototype.send = this._origXHRSend;
      if (this._origFetch)   window.fetch = this._origFetch;
      this.observers.forEach(o => o.disconnect());
    }
  }

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  async function autoScroll() {
    const total = document.documentElement.scrollHeight;
    const step  = Math.floor(window.innerHeight * 0.8);
    let pos = 0;
    while (pos < total) {
      window.scrollBy(0, step);
      pos += step;
      await sleep(120);
    }
    window.scrollTo(0, 0);
  }

  // ── Trigger common interactions ───────────────────────────────────────────
  function triggerInteractions() {
    document.querySelectorAll('nav a, .menu-item, button, [data-toggle], [data-bs-toggle]').forEach(el => {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseout',  { bubbles: true }));
    });
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_DOM_SNAPSHOT') {
      sendResponse({
        ...snapshotDOM(),
        mutationCount:       mutationCount,
        mutationClasses:     [...domMutationClasses],
        mutationIds:         [...domMutationIds],
      });
      return true;
    }

    if (msg.type === 'WAIT_FOR_AJAX') {
      const {
        ajaxDelay          = 3000,
        autoScroll:doScroll = true,
        triggerInteractions: doInteract = true,
      } = msg.settings || {};

      const monitor = new AjaxMonitor(ajaxDelay);

      const work = async () => {
        if (doInteract) triggerInteractions();
        if (doScroll)   await autoScroll();

        const interval = setInterval(() => {
          const pending = monitor.pendingRequests;
          const quiet   = Date.now() - monitor.lastActivityTime;
          chrome.runtime.sendMessage({
            type:    'SCAN_PROGRESS',
            tabId:   msg.tabId,
            message: pending > 0
              ? `Waiting for ${pending} network request${pending > 1 ? 's' : ''}…`
              : `Settling… ${Math.max(0, ajaxDelay - quiet)}ms left`,
          });
        }, 800);

        await monitor.start();
        clearInterval(interval);

        // Final DOM snapshot after everything settles
        sendResponse({
          done:           true,
          domSnapshot:    snapshotDOM(),
          mutationCount,
          mutationClasses: [...domMutationClasses],
          mutationIds:     [...domMutationIds],
        });
      };

      work().catch(err => sendResponse({ done: false, error: err.message }));
      return true;
    }
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();
