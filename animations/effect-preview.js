const stage=document.getElementById('stage');
const replay=document.getElementById('replay');
const slow=document.getElementById('slow');
const normalTime=getComputedStyle(document.body).getPropertyValue('--time').trim()||'1s';
function play(){stage.classList.remove('playing');void stage.offsetWidth;stage.classList.add('playing')}
replay.addEventListener('click',play);
slow.addEventListener('click',()=>{
  const on=document.body.classList.toggle('slow');
  document.body.style.setProperty('--time',on?'3s':normalTime);
  slow.setAttribute('aria-pressed',String(on));
  slow.textContent=on?'恢复原速':'慢放检查';
  play();
});
window.addEventListener('load',()=>setTimeout(play,280));
