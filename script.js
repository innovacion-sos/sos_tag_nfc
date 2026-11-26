const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('show');io.unobserve(e.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
const scan=document.getElementById('scan'),ficha=document.getElementById('ficha'),alertBox=document.getElementById('alert');
scan.addEventListener('click',()=>{
  ficha.hidden=false;
  alertBox.classList.remove('sent');
  alertBox.textContent='📍 Enviando ubicación a contactos de emergencia…';
  setTimeout(()=>{alertBox.classList.add('sent');alertBox.textContent='✅ Ubicación enviada a contactos de emergencia · Hace 12 s · Sin instalar apps ni registrarse'},1800);
});
