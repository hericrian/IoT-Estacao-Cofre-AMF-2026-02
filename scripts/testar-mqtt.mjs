import vm from 'node:vm';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const fonte=await readFile(new URL('../pagina/mqtt-client.js',import.meta.url),'utf8');
const mqtt=vm.runInNewContext(fonte+'\nmqtt',{WebSocket,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,setInterval,clearInterval});
const topic='sis1a/hericrian/teste-'+crypto.randomUUID();
const texto=JSON.stringify({teste:'Transporte MQTT real',aluno:'Héric',executadoEm:new Date().toISOString()});
await new Promise((resolve,reject)=>{
 const client=mqtt.connect('wss://test.mosquitto.org:8081/mqtt',{clientId:'teste-heric-'+Date.now()});
 const limite=setTimeout(()=>{client.end();reject(new Error('Tempo excedido no teste MQTT'));},30000);
 client.on('error',e=>{clearTimeout(limite);client.end();reject(e);});
 client.on('connect',()=>{client.subscribe(topic);client.publish(topic,texto);});
 client.on('message',async(t,p)=>{
   if(t!==topic)return;
   try{
     assert.equal(p.toString(),texto);
     await writeFile(new URL('../evidencias/teste-transporte-mqtt.json',import.meta.url),JSON.stringify({broker:'wss://test.mosquitto.org:8081/mqtt',topico:topic,enviado:JSON.parse(texto),recebido:JSON.parse(p.toString()),resultado:'PASS'},null,2));
     clearTimeout(limite);client.end();console.log('MQTT real: conexão TLS, assinatura de tópico, publicação e UTF-8 aprovados.');resolve();
   }catch(e){clearTimeout(limite);client.end();reject(e);}
 });
});
