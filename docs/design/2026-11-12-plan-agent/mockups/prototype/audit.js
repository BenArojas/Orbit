/* Layout audit: load index.html?audit=1&demo=<name> at a given window size. Results go to #auditout. */
(async () => {
  await new Promise(r => setTimeout(r, 2200));
  const bad = [], ws = document.querySelector('#ws');
  const name = el => { const c = typeof el.className === 'string' ? el.className.split(' ')[0] : ''; return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${c ? '.' + c : ''}`; };
  const box = el => el.getBoundingClientRect();
  document.querySelectorAll('#ws .card, #ws .ph, header.top').forEach(card => {
    const cr = box(card);
    card.querySelectorAll('*').forEach(el => {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
      const r = box(el); if (!r.width || !r.height) return;
      if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5) bad.push(`spills out of ${name(card)}: ${name(el)} "${(el.textContent || '').trim().slice(0, 32)}" by ${Math.round(Math.max(r.right - cr.right, cr.left - r.left))}px`);
    });
  });
  document.querySelectorAll('#ws *, header.top *').forEach(el => {
    if (el.closest('svg') || el.classList.contains('ell') || el.closest('.ell') || el.classList.contains('chhead')) return;
    const cs = getComputedStyle(el);
    if (el.children.length === 0 && (el.textContent || '').trim() && el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX)) bad.push(`text cut off: ${name(el)} "${el.textContent.trim().slice(0, 32)}"`);
  });
  document.querySelectorAll('#ws svg').forEach(svg => {
    const sr = box(svg), ts = [...svg.querySelectorAll('text')].map(t => ({ t: t.textContent, r: box(t) })).filter(x => x.r.width);
    ts.forEach(x => { if (x.r.right > sr.right + 1 || x.r.left < sr.left - 1 || x.r.bottom > sr.bottom + 1 || x.r.top < sr.top - 1) bad.push(`chart text past the edge: "${x.t.slice(0, 24)}"`); });
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = ts[i].r, b = ts[j].r, w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 2 && h > 2) bad.push(`chart labels overlap: "${ts[i].t.slice(0, 18)}" and "${ts[j].t.slice(0, 18)}"`); }
  });
  if (ws.scrollWidth > ws.clientWidth + 1) bad.push(`workspace scrolls sideways by ${ws.scrollWidth - ws.clientWidth}px`);
  const pre = document.createElement('pre'); pre.id = 'auditout'; pre.textContent = JSON.stringify({ w: innerWidth, ws: ws.clientWidth, route: S.route, bad: [...new Set(bad)] }); document.body.appendChild(pre);
})();
