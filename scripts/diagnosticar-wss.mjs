const str=s=>{const b=Buffer.from(s);return Buffer.concat([Buffer.from([b.length>>8,b.length&255]),b]);};
const body=Buffer.concat([str('MQTT'),Buffer.from([4,2,0,60]),str('wss-heric-'+Date.now())]);
await new Promise(resolve=>{
 const ws=new WebSocket('wss://test.mosquitto.org:8081/mqtt','mqtt');
 const timer=setTimeout(()=>{console.log('Timeout MQTT sobre WSS');ws.close();resolve();},15000);
 ws.addEventListener('open',()=>{console.log('WSS aberto; enviando CONNECT');ws.send(Buffer.concat([Buffer.from([16,body.length]),body]));});
 ws.addEventListener('message',async e=>{console.log('Resposta MQTT:',Buffer.from(await e.data.arrayBuffer()).toString('hex'));clearTimeout(timer);ws.close();resolve();});
 ws.addEventListener('error',()=>{console.log('Erro WSS');clearTimeout(timer);resolve();});
 ws.addEventListener('close',e=>{console.log('WSS fechou:',e.code,e.reason);clearTimeout(timer);resolve();});
});
