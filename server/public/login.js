document.getElementById('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button'),error=document.getElementById('login-error');button.disabled=true;error.textContent='';
  try{const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});document.getElementById('password').value='';if(!response.ok){const data=await response.json();throw new Error(data.error?.code==='login_rate_limited'?'Слишком много попыток. Повторите через минуту.':'Неверный пароль.');}location.assign('/');}
  catch(e){error.textContent=e.message;}finally{button.disabled=false;}
});
