
const toggle=document.querySelector('.menu-toggle');const nav=document.querySelector('.main-nav');if(toggle&&nav){toggle.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));});}
const items=document.querySelectorAll('.reveal');if('IntersectionObserver'in window){const obs=new IntersectionObserver((entries)=>{for(const e of entries){if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}}},{threshold:.12});items.forEach(i=>obs.observe(i));}else{items.forEach(i=>i.classList.add('visible'));}


// Product screenshot lightbox
(function(){
  const galleryImages = document.querySelectorAll('.gallery-grid .gallery-item img');
  if(!galleryImages.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'image-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Screenshot preview');

  const close = document.createElement('button');
  close.className = 'image-lightbox-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close preview');
  close.textContent = '×';

  const img = document.createElement('img');
  img.alt = '';

  overlay.appendChild(close);
  overlay.appendChild(img);
  document.body.appendChild(overlay);

  function openLightbox(src, alt){
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('is-open');
    document.body.classList.add('lightbox-open');
  }

  function closeLightbox(){
    overlay.classList.remove('is-open');
    document.body.classList.remove('lightbox-open');
    img.removeAttribute('src');
  }

  galleryImages.forEach(image => {
    image.closest('.gallery-item')?.classList.add('is-clickable');
    image.addEventListener('click', () => openLightbox(image.currentSrc || image.src, image.alt));
  });

  close.addEventListener('click', closeLightbox);
  overlay.addEventListener('click', event => {
    if(event.target === overlay) closeLightbox();
  });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && overlay.classList.contains('is-open')) closeLightbox();
  });
})();
