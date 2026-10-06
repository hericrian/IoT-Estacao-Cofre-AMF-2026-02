import {readFile,writeFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const cfg=await readFile(new URL('../esp32/estacao_cofre/config.h',import.meta.url),'utf8');
const valor=n=>cfg.match(new RegExp('#define\\s+'+n+'\\s+"([^"]+)"'))[1];
const url=valor('WORKER_URL'), api=valor('API_KEY'), hmac=valor('CHAVE_HMAC');
const resultados=[];
const corpo=extra=>JSON.stringify({nome:'teste-'+crypto.randomUUID(),sensor:'temp',valor:24,ts:Math.floor(Date.now()/1000),...extra});
const assinatura=b=>createHmac('sha256',hmac).update(b).digest('hex');
async function enviar(b,headers={}) {
 const r=await fetch(url+'/insert',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':api,'X-Assinatura':assinatura(b),...headers},body:b});
 return {status:r.status,resposta:await r.text()};
}
async function verificar(nome,b,status,headers) {
 const r=await enviar(b,headers); assert.equal(r.status,status,nome);
 resultados.push({teste:nome,...r}); console.log(nome+': HTTP '+r.status);
}
await verificar('Valido',corpo({}),200);
await verificar('Sem API key',corpo({}),401,{'X-API-Key':''});
const b=corpo({valor:25});
await verificar('Adulterado',b.replace('"valor":25','"valor":45'),401,{'X-Assinatura':assinatura(b)});
const replay=corpo({});
const respostas=await Promise.all([enviar(replay),enviar(replay)]);
assert.deepEqual(respostas.map(r=>r.status).sort(),[200,401]);
resultados.push({teste:'Replay simultaneo',status:respostas.map(r=>r.status)});
console.log('Replay simultaneo: 200 / 401');
await verificar('Atrasado',corpo({ts:Math.floor(Date.now()/1000)-300}),401);
await verificar('Futuro',corpo({ts:Math.floor(Date.now()/1000)+300}),401);
await verificar('Valor null',corpo({valor:null}),400);
const r=await fetch(url+'/tentativas',{headers:{'X-API-Key':api}});
assert.equal(r.status,200);
const tentativas=(await r.json()).map(({motivo,timestamp})=>({motivo,timestamp}));
await writeFile(new URL('../evidencias/testes-remotos.json',import.meta.url),JSON.stringify({url,executadoEm:new Date().toISOString(),resultados,tentativas},null,2));
console.log('7 testes remotos aprovados; registros salvos sem chaves ou IPs.');
