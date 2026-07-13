(function(){
  const manifestUrl = '/assets/downloads/releases.json';
  const appByHref = {
    '/download/almoathen-shinqiti': 'almoathen-shinqiti',
    '/download/safe-to-spend': 'safe-to-spend'
  };
  function updateField(el, value){
    if(value === undefined || value === null || value === '') return;
    const label = el.getAttribute('data-dl-label');
    if(label){ el.textContent = label + ': ' + value; }
    else { el.textContent = value; }
  }
  function hydrate(appId, data){
    document.querySelectorAll('[data-download-app="'+appId+'"]').forEach(root => {
      root.querySelectorAll('[data-dl-field]').forEach(el => {
        const field = el.getAttribute('data-dl-field');
        updateField(el, data[field]);
      });
    });
  }
  document.querySelectorAll('a[href^="/download/"]').forEach(a => {
    const appId = appByHref[a.getAttribute('href')];
    if(appId){
      let node = a.closest('.product-card, .download-card, .modern-download-panel, .app-download-section, .modern-final-download');
      if(node && !node.hasAttribute('data-download-app')) node.setAttribute('data-download-app', appId);
    }
  });
  fetch(manifestUrl, {cache:'no-store'})
    .then(r => r.ok ? r.json() : null)
    .then(manifest => {
      if(!manifest || !manifest.apps) return;
      Object.keys(manifest.apps).forEach(appId => hydrate(appId, manifest.apps[appId]));
    })
    .catch(() => {});
})();
