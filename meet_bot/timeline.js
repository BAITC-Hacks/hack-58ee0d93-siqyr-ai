(() => {
  if (window.__siqyrTimeline) return;
  const emit = (event) => {
    if (typeof window.__siqyrReceive === 'function') {
      Promise.resolve(window.__siqyrReceive(event)).catch(() => {});
    }
  };
  let last = '';
  const scan = () => {
    // Meet does not expose a stable public caption DOM contract. Emit only visible,
    // explicitly labelled captions; never guess a speaker from tile order.
    const nodes = document.querySelectorAll('[aria-label*="caption" i], [aria-label*="субтитр" i]');
    for (const node of nodes) {
      const text = (node.innerText || '').trim();
      if (!text || text === last) continue;
      const parts = text.split('\n').map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const name = parts[0];
      const utterance = parts.slice(1).join(' ');
      if (!name || !utterance) continue;
      last = text;
      emit({ type: 'speaker', name, text: utterance, t_ms: Date.now(), end_ms: Date.now() });
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  window.__siqyrTimeline = { stop: () => observer.disconnect() };
})();
