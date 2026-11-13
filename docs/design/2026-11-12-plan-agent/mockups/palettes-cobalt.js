// Cobalt + Sunburst family: the 30% dock and 10% accent stay fixed, only the 60% base changes.
(function () {
  const dock = { s30:'#13316E', s30b:'#1A3F8B', s30edge:'#2854B0', on30:'#F2F7FF', on30muted:'#A6C0EE', c10:'#FFD026', on10:'#1E1600' };
  const light = { light:true, c30:'#2F6BE0', up:'#0F9960', down:'#D93848' };
  const dark = { light:false, c30:'#4B83F2', up:'#2AD88A', down:'#FF5C6C' };
  window.ORBIT_PALETTES = [
    { ...dock, ...light, id:'titanium', name:'A · Warm Titanium', tag:'titanium · racing cobalt · sunburst',
      inspo:'The #4 base with #3 colours. Warm grey hardware feel; the cobalt dock reads like an anodised panel and yellow is the one switch.',
      n60:'titanium', n30:'racing cobalt', n10:'sunburst',
      c60:'#F1F0EC', card:'#FAFAF8', raise:'#E5E3DC', edge:'#D6D3C9', ink:'#141518', ink2:'#575A62', ink3:'#8A8D96' },
    { ...dock, ...light, id:'chalk', name:'B · Chalk', tag:'warm chalk · racing cobalt · sunburst',
      inspo:'Creamier and softer than titanium, like a printed race programme. Most relaxed for long reading on Review.',
      n60:'chalk', n30:'racing cobalt', n10:'sunburst',
      c60:'#F5F1E8', card:'#FFFDF7', raise:'#EBE5D8', edge:'#DED6C6', ink:'#1A1814', ink2:'#5E594F', ink3:'#908A7E' },
    { ...dock, ...light, id:'concrete', name:'C · Concrete', tag:'cool concrete · racing cobalt · sunburst',
      inspo:'Cool, neutral pit-lane grey. Most technical of the light options; cobalt and yellow look the cleanest against it.',
      n60:'concrete', n30:'racing cobalt', n10:'sunburst',
      c60:'#E9ECF0', card:'#F7F8FA', raise:'#DDE1E7', edge:'#CDD3DC', ink:'#12161D', ink2:'#535B68', ink3:'#858D9A' },
    { ...dock, ...dark, id:'graphite', name:'D · Warm Graphite', tag:'warm graphite · racing cobalt · sunburst',
      inspo:'A dark option without the blue-black of jet carbon. Neutral warm charcoal, so the cobalt dock is the only blue on screen.',
      n60:'warm graphite', n30:'racing cobalt', n10:'sunburst',
      c60:'#161514', card:'#1E1D1B', raise:'#282624', edge:'#353230', ink:'#F2EFEA', ink2:'#A7A29A', ink3:'#6E6A63' },
    { ...dock, ...dark, id:'gunmetal', name:'E · Gunmetal', tag:'gunmetal · racing cobalt · sunburst',
      inspo:'Mid-dark machined metal. Lighter than carbon, so it feels less like a void and more like an instrument body.',
      n60:'gunmetal', n30:'racing cobalt', n10:'sunburst',
      c60:'#23262B', card:'#2B2F35', raise:'#343940', edge:'#424850', ink:'#F1F3F6', ink2:'#A9B0BA', ink3:'#757D88',
      s30:'#16397F', s30b:'#1E489C', s30edge:'#2F5CC0' },
    { ...dock, ...dark, id:'livery', name:'F · Full Livery', tag:'deep cobalt · bright cobalt · sunburst',
      inspo:'All-in on the team colours: a deep cobalt base with a brighter cobalt dock. Boldest and most branded, like a racing livery.',
      n60:'deep cobalt', n30:'bright cobalt', n10:'sunburst',
      c60:'#0C1630', card:'#111E3E', raise:'#18284D', edge:'#22355F', ink:'#EEF3FF', ink2:'#9FB0D6', ink3:'#6478A6',
      s30:'#1D47A6', s30b:'#2556BF', s30edge:'#3B6CD6', on30muted:'#C3D5FA', c30:'#6E9BFF' },
  ];
  window.applyPalette = function (el, p) {
    ['c60','card','raise','edge','ink','ink2','ink3','s30','s30b','s30edge','on30','on30muted','c30','c10','on10','up','down']
      .forEach(k => { if (p[k]) el.style.setProperty('--' + k, p[k]); });
    el.dataset.light = p.light ? '1' : '0';
  };
})();
