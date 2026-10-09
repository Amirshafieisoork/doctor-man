(() => {
  let saved;
  try { saved=localStorage.getItem('drman-theme'); } catch {}
  const apply=value=>document.documentElement.dataset.theme=value;
  apply(['light','dark'].includes(saved)?saved:'light');
  document.addEventListener('DOMContentLoaded',()=>{
    const parent=document.querySelector('header .actions') || document.querySelector('header .toolbar') || document.querySelector('header .navrow') || document.querySelector('header');
    if(!parent)return;
    const button=document.createElement('button');button.type='button';button.className='theme-toggle';
    const refresh=()=>{const dark=document.documentElement.dataset.theme==='dark';button.textContent=dark?'حالت روشن':'حالت تیره';button.setAttribute('aria-label',button.textContent);};
    button.onclick=()=>{const value=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(value);try{localStorage.setItem('drman-theme',value);}catch{}refresh();};
    refresh();parent.append(button);
  });
})();
