/* ================================================================
   जनमत — चुनाव चिन्ह लाइब्रेरी
   Rendered inline as SVG so they look identical on every device
   (no dependence on emoji fonts).
   ================================================================ */

window.SYMBOLS = [
  {
    id: 'diya',
    name: 'दीया',
    svg: '<path d="M16 4.5c3.2 4.2 4.8 6.9 4.8 9.4a4.8 4.8 0 01-9.6 0c0-2.5 1.6-5.2 4.8-9.4z" fill="#ff9d0a"/><path d="M16 9.5c1.4 2 2.2 3.3 2.2 4.5a2.2 2.2 0 01-4.4 0c0-1.2.8-2.5 2.2-4.5z" fill="#ffd166"/><path d="M4.5 19.5h23c-1.2 5-6 8-11.5 8s-10.3-3-11.5-8z" fill="#b5533a"/><path d="M6.6 22.4c2.4 1.5 5.7 2.4 9.4 2.4s7-.9 9.4-2.4" stroke="#8d3b25" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'sunflower',
    name: 'सूरजमुखी',
    svg: '<g fill="#ffb020"><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(45 16 16)"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(90 16 16)"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(135 16 16)"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(180 16 16)"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(225 16 16)"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(270 16 16)"/><ellipse cx="16" cy="5.6" rx="3.3" ry="4.6" transform="rotate(315 16 16)"/></g><circle cx="16" cy="16" r="6.2" fill="#6b3e0e"/><circle cx="14" cy="14.2" r="1.1" fill="#8d6134"/><circle cx="18.2" cy="15.4" r="1.1" fill="#8d6134"/><circle cx="15.6" cy="18.4" r="1.1" fill="#8d6134"/>',
  },
  {
    id: 'tractor',
    name: 'ट्रैक्टर',
    svg: '<path d="M13.5 9.5h5.6v5h-5.6z" fill="#a5d6a7"/><path d="M6 13.5h13.8l3 4.4V22H6z" fill="#2e7d32"/><path d="M20.4 15h4.8l2.3 3.4v3.1h-7.1z" fill="#43a047"/><circle cx="11" cy="23" r="5.4" fill="#37474f"/><circle cx="11" cy="23" r="2.2" fill="#90a4ae"/><circle cx="25.2" cy="23.6" r="3.6" fill="#37474f"/><circle cx="25.2" cy="23.6" r="1.3" fill="#90a4ae"/><path d="M8 8.4h3.2v3.4H8z" fill="#78909c"/>',
  },
  {
    id: 'bicycle',
    name: 'साइकिल',
    svg: '<circle cx="8.6" cy="21" r="6.2" fill="none" stroke="#1e88e5" stroke-width="2.2"/><circle cx="24" cy="21" r="6.2" fill="none" stroke="#1e88e5" stroke-width="2.2"/><path d="M8.6 21l4.8-8.4h6.2l4.4 8.4M13.4 12.6l5 8.4H8.6M13.4 12.6l-2.4-3.2h-2.2M19.6 12.6l1.6-3.2h2.6" fill="none" stroke="#1565c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="13.4" cy="12.6" r="1.5" fill="#1565c0"/>',
  },
  {
    id: 'wheat',
    name: 'धान की बाली',
    svg: '<path d="M16 29V11" stroke="#8d6e63" stroke-width="2" stroke-linecap="round"/><g fill="#f2b705"><path d="M16 12c-4 0-6-2.4-6-6 4 0 6 2.4 6 6z"/><path d="M16 12c4 0 6-2.4 6-6-4 0-6 2.4-6 6z"/><path d="M16 18c-4 0-6-2.4-6-6 4 0 6 2.4 6 6z"/><path d="M16 18c4 0 6-2.4 6-6-4 0-6 2.4-6 6z"/><path d="M16 24c-4 0-6-2.4-6-6 4 0 6 2.4 6 6z"/><path d="M16 24c4 0 6-2.4 6-6-4 0-6 2.4-6 6z"/></g><path d="M16 11c-2.6 0-4-1.6-4-4" stroke="#c79500" stroke-width="1.3" fill="none"/>',
  },
  {
    id: 'bat',
    name: 'क्रिकेट बल्ला',
    svg: '<g transform="rotate(22 16 16)"><rect x="13" y="3.6" width="6" height="5.4" rx="1.6" fill="#5d4037"/><rect x="12" y="8.4" width="8" height="15" rx="2.6" fill="#e0b97a" stroke="#c69e5f" stroke-width="1.2"/><path d="M14.2 12v9" stroke="#c69e5f" stroke-width="1.2" stroke-linecap="round"/></g><circle cx="24.6" cy="25" r="3.2" fill="#c62828"/><path d="M23 24.4c1 .6 2.2.6 3.2 0" stroke="#ffcdd2" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'book',
    name: 'किताब',
    svg: '<path d="M16 9.6C13 7.6 9.8 7 6.4 7.4v17c3.4-.4 6.6.2 9.6 2.2 3-2 6.2-2.6 9.6-2.2v-17c-3.4-.4-6.6.2-9.6 2.2z" fill="#fff" stroke="#5e35b1" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9.6v17" stroke="#5e35b1" stroke-width="1.8"/><path d="M9 12.4c1.6 0 3.2.4 4.6 1.2M9 16.6c1.6 0 3.2.4 4.6 1.2M22.4 12.4c-1.6 0-3.2.4-4.6 1.2M22.4 16.6c-1.6 0-3.2.4-4.6 1.2" stroke="#b39ddb" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
  },
  {
    id: 'star',
    name: 'तारा',
    svg: '<path d="M16 3.6l3.9 8.1 8.9 1.3-6.4 6.3 1.5 8.9-7.9-4.2-7.9 4.2 1.5-8.9L3.2 13l8.9-1.3z" fill="#f4b400" stroke="#d99a00" stroke-width="1.3" stroke-linejoin="round"/>',
  },
  {
    id: 'hand',
    name: 'हाथ',
    svg: '<path d="M11.6 28.4c-3.2 0-5.4-2.2-5.4-5.4v-6.4a1.9 1.9 0 013.8 0v3.6M10 14.6V9.4a1.9 1.9 0 013.8 0v5.4M13.8 14.4V6.6a1.9 1.9 0 013.8 0v7.8M17.6 15V8.2a1.9 1.9 0 013.8 0v6.6M21.4 15.4a1.9 1.9 0 013.8 0v5.4c0 4.2-3.4 7.6-7.6 7.6z" fill="#ffcc80" stroke="#e69138" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>',
  },
  {
    id: 'house',
    name: 'घर',
    svg: '<path d="M4.4 15.6L16 6.2l11.6 9.4" fill="none" stroke="#ef6c00" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.2 14.4V26.6h17.6V14.4" fill="#fff3e0" stroke="#ef6c00" stroke-width="2" stroke-linejoin="round"/><rect x="13.6" y="19.4" width="4.8" height="7.2" rx="1" fill="#bf360c"/><rect x="9.6" y="17.4" width="2.8" height="2.8" rx=".6" fill="#90caf9"/><rect x="19.6" y="17.4" width="2.8" height="2.8" rx=".6" fill="#90caf9"/>',
  },
  {
    id: 'bell',
    name: 'घंटी',
    svg: '<path d="M16 5.2a2 2 0 012 2v1c4 1 6 4.6 6 9v5l2.2 2H5.8L8 22v-5c0-4.4 2-8 6-9v-1a2 2 0 012-2z" fill="#fdd835" stroke="#f9a825" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.2 26.4a2.8 2.8 0 005.6 0" fill="none" stroke="#f9a825" stroke-width="1.9" stroke-linecap="round"/><path d="M12.4 12.4c0-1.4.5-2.6 1.4-3.4" stroke="#fff9c4" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'umbrella',
    name: 'छाता',
    svg: '<path d="M3.6 17.4a12.4 12.4 0 0124.8 0z" fill="#e53935"/><path d="M16 17.4v8.2a3 3 0 006 0" fill="none" stroke="#8d6e63" stroke-width="2" stroke-linecap="round"/><path d="M10.4 17.4a5.6 5.6 0 0111.2 0" fill="none" stroke="#ffcdd2" stroke-width="1.4"/><circle cx="16" cy="5.6" r="1.4" fill="#8d6e63"/>',
  },
  {
    id: 'drum',
    name: 'ढोल',
    svg: '<path d="M7.6 9.4h16.8l-1.9 14.2H9.5z" fill="#8d6e63"/><ellipse cx="16" cy="9.4" rx="8.4" ry="2.8" fill="#d7ccc8" stroke="#6d4c41" stroke-width="1.4"/><path d="M9.5 13.4l13 3M22.5 13.4l-13 3M10.6 19.4l10.8 2.4M21.4 19.4l-10.8 2.4" stroke="#f5deb3" stroke-width="1.2" stroke-linecap="round"/>',
  },
  {
    id: 'flag',
    name: 'झंडा',
    svg: '<path d="M8.6 4v25" stroke="#6d4c41" stroke-width="2.4" stroke-linecap="round"/><path d="M8.6 6.2c5.2-2 9.4 2 14.8 0v9.4c-5.4 2-9.6-2-14.8 0z" fill="#ff7043"/><path d="M8.6 6.2c5.2-2 9.4 2 14.8 0" stroke="#ffab91" stroke-width="1.2" fill="none"/>',
  },
  {
    id: 'bulb',
    name: 'बल्ब',
    svg: '<path d="M16 4.6a8.4 8.4 0 015.2 15c-.8.6-1.2 1.4-1.2 2.4H12c0-1-.4-1.8-1.2-2.4A8.4 8.4 0 0116 4.6z" fill="#ffe082" stroke="#f9a825" stroke-width="1.7"/><path d="M12.6 24.6h6.8M13.6 27.4h4.8" stroke="#9e9e9e" stroke-width="2" stroke-linecap="round"/><path d="M13.4 13.4c0-1.6.9-3 2.3-3.7" stroke="#fff8e1" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'tree',
    name: 'पेड़',
    svg: '<rect x="14.4" y="19" width="3.2" height="8.6" rx="1" fill="#795548"/><circle cx="16" cy="13.4" r="7.6" fill="#4caf50"/><circle cx="10.6" cy="17.4" r="5" fill="#388e3c"/><circle cx="21.4" cy="17.4" r="5" fill="#388e3c"/><path d="M16 8.4c-1.6 1.4-2.4 3-2.4 4.8" stroke="#a5d6a7" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'fish',
    name: 'मछली',
    svg: '<path d="M5 16c4.4-6.4 12.6-6.4 16.8 0C17.6 22.4 9.4 22.4 5 16z" fill="#29b6f6"/><path d="M21.6 16l5.4-4.2v8.4z" fill="#0288d1"/><circle cx="10.4" cy="14.6" r="1.4" fill="#01579b"/><path d="M13.6 16c2 .6 4 .6 6 0" stroke="#81d4fa" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'kite',
    name: 'पतंग',
    svg: '<path d="M16 2.8l9.2 10.4L16 24.6 6.8 13.2z" fill="#e53935"/><path d="M16 2.8v21.8M6.8 13.2h18.4" stroke="#b71c1c" stroke-width="1.2"/><path d="M16 24.6c2.4 2-1.6 3.4 0 5.4" stroke="#8d6e63" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'leaf',
    name: 'पत्ता',
    svg: '<path d="M7.4 26.6C7.4 16.2 14 9 26.6 8c-.6 12.6-8 19.2-19.2 18.6z" fill="#66bb6a"/><path d="M8.6 25.4C13.4 20 18.4 15 24.6 9.6" stroke="#2e7d32" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'clock',
    name: 'घड़ी',
    svg: '<circle cx="16" cy="16" r="11.4" fill="#fff" stroke="#455a64" stroke-width="2.4"/><path d="M16 8.8V16l5.4 3.2" stroke="#455a64" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="1.5" fill="#e53935"/>',
  },
  {
    id: 'key',
    name: 'चाबी',
    svg: '<circle cx="10.6" cy="20.8" r="5.6" fill="none" stroke="#f9a825" stroke-width="2.6"/><path d="M14.8 16.6L26 5.4M20.4 6.4l3.2 3.2M17.2 9.4l3.2 3.2" stroke="#f9a825" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'pen',
    name: 'कलम',
    svg: '<path d="M5 27l2.2-6.6L20.8 6.8l4.8 4.8L12 25.2z" fill="#90caf9" stroke="#1565c0" stroke-width="1.8" stroke-linejoin="round"/><path d="M18.4 9.2l4.8 4.8M7.2 20.4l4.8 4.8" stroke="#1565c0" stroke-width="1.5"/><path d="M5 27l2.2-6.6 4.8 4.8z" fill="#37474f"/>',
  },
  {
    id: 'mango',
    name: 'आम',
    svg: '<path d="M19.8 8.4c5 2.4 7.2 7.6 5.2 12.8-2.2 6-9.4 8.8-14.4 5.6-4-2.6-4.8-7-2.6-10.6 2.2-3.6 6.6-9.6 11.8-7.8z" fill="#fbc02d" stroke="#f9a825" stroke-width="1.5"/><path d="M19.8 8.4c-.2-3 1.6-5 5-5.2" stroke="#43a047" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M20 9.4c3-.4 4.6-1.6 5.4-3.4" stroke="#66bb6a" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  },
  {
    id: 'rose',
    name: 'गुलाब',
    svg: '<path d="M16 24v6" stroke="#2e7d32" stroke-width="2.2" stroke-linecap="round"/><path d="M16 26.4c-3.4.4-5-1.6-5-4.4 3 0 5 1.4 5 4.4zM16 24.6c3-.4 4.6-2.2 4.6-4.8-2.8 0-4.6 1.4-4.6 4.8z" fill="#43a047"/><circle cx="16" cy="13" r="8.6" fill="#e91e63"/><path d="M16 7.6a5.4 5.4 0 015.4 5.4 3.8 3.8 0 01-7.6 0c0-1.6.8-2.8 2.2-3.6" fill="none" stroke="#ffcdd2" stroke-width="1.5" stroke-linecap="round"/>',
  },
];

window.SYMBOL_MAP = Object.create(null);
window.SYMBOLS.forEach(function (s) { window.SYMBOL_MAP[s.id] = s; });

/**
 * Return an inline SVG string for a symbol id.
 * Falls back to a ballot-box icon for unknown ids (or legacy emoji).
 */
window.symbolSVG = function (id, size) {
  var px = size || 24;
  var s = window.SYMBOL_MAP[id];
  var inner = s
    ? s.svg
    : '<rect x="4" y="11" width="24" height="18" rx="3" fill="#e3e1f5" stroke="#9c96d8" stroke-width="1.8"/><path d="M12 11V7.6a2 2 0 012-2h4a2 2 0 012 2V11" fill="none" stroke="#9c96d8" stroke-width="1.8"/><path d="M12.4 20l3 3 5-5.6" fill="none" stroke="#6d5bf6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<svg viewBox="0 0 32 32" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false" style="display:block">' + inner + '</svg>';
};

window.symbolName = function (id) {
  var s = window.SYMBOL_MAP[id];
  return s ? s.name : 'चुनाव चिन्ह';
};
