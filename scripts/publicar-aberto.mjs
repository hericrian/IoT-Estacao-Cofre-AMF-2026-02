// Leitura demonstrativa do próprio laboratório, sem dados de colegas.
import net from 'node:net';
const str = s => { const b=Buffer.from(s); return Buffer.concat([Buffer.from([b.length>>8,b.length&255]),b]); };
const mqtt = (tipo,body) => { let n=body.length, bytes=[]; do { let b=n%128; n=Math.floor(n/128); if(n)b|=128; bytes.push(b); }while(n); return Buffer.concat([Buffer.from([tipo,...bytes]),body]); };
const body=Buffer.concat([str('MQTT'),Buffer.from([4,2,0,60]),str('lab-heric-'+Date.now())]);
await new Promise(resolve=>{
 const socket=net.connect(1883,'test.mosquitto.org',()=>socket.write(mqtt(16,body)));
 socket.setTimeout(20000,()=>{console.log('Timeout');socket.destroy();resolve();});
 socket.on('data',d=>{
   if(d[0]===32 && d[3]===0){
     socket.write(mqtt(48,Buffer.concat([str('sis1a/hericrian/aberto'),Buffer.from('{"temp":24,"origem":"demonstracao-local-sem-cifra"}')])));
     console.log('Publicada leitura demonstrativa em sis1a/hericrian/aberto');
     socket.end(); resolve();
   }
 });
 socket.on('error',e=>{console.log(e.message);resolve();});
});
