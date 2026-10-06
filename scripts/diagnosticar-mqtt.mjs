import tls from 'node:tls';
import {readFile} from 'node:fs/promises';
const cert = await readFile(new URL('../esp32/estacao_cofre/certificados.h',import.meta.url),'utf8');
const ca = cert.match(/CA_MOSQUITTO = R"CERT\(\s*([\s\S]*?)\)CERT"/)[1];
const str = s => { const b=Buffer.from(s); return Buffer.concat([Buffer.from([b.length>>8,b.length&255]),b]); };
const id='diagnostico-heric-'+Date.now();
const port=Number(process.argv[2]||8885);
const body=Buffer.concat([str('MQTT'),Buffer.from([4,port===8885?194:2,0,60]),str(id),...(port===8885?[str('rw'),str('readwrite')]:[])]);
const packet=Buffer.concat([Buffer.from([16,body.length]),body]);
await new Promise(resolve=>{
 const socket=tls.connect({host:'test.mosquitto.org',port,servername:'test.mosquitto.org',ca,rejectUnauthorized:true},()=>{
   console.log('TLS validado; enviando CONNECT MQTT'); socket.write(packet);
 });
 socket.setTimeout(20000,()=>{console.log('Timeout esperando broker');socket.destroy();resolve();});
 socket.on('data',d=>{console.log('CONNACK:',d.toString('hex'));socket.end();resolve();});
 socket.on('error',e=>{console.log('Falha:',e.message);resolve();});
 socket.on('close',resolve);
});
