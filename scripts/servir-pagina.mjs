import http from 'node:http';
import tls from 'node:tls';
import {WebSocketServer} from 'ws';
import {readFile} from 'node:fs/promises';
const certificados = await readFile(new URL('../esp32/estacao_cofre/certificados.h',import.meta.url),'utf8');
const caMosquitto = certificados.match(/CA_MOSQUITTO = R"CERT\(\s*([\s\S]*?)\)CERT"/)[1];
const arquivos = new Map([
  ['/cofre.html', new URL('../pagina/cofre.html', import.meta.url)],
  ['/mqtt-client.js', new URL('../pagina/mqtt-client.js', import.meta.url)],
  ['/evidencias.html', new URL('../pagina/evidencias.html', import.meta.url)]
]);
const server = http.createServer(async (req,res) => {
  const arquivo = arquivos.get(new URL(req.url,'http://localhost').pathname);
  if (!arquivo) { res.writeHead(404); res.end('Nao encontrado'); return; }
  try { res.setHeader('Content-Type',arquivo.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'); res.end(await readFile(arquivo)); }
  catch { res.writeHead(404); res.end('Nao encontrado'); }
});
const wsServer = new WebSocketServer({noServer:true,handleProtocols:()=> 'mqtt',maxPayload:65536});
server.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/mqtt' || req.headers.origin!=='http://127.0.0.1:8789') { socket.destroy();return; }
  wsServer.handleUpgrade(req,socket,head,ws=>wsServer.emit('connection',ws));
});
wsServer.on('connection',ws=>{
  const fila=[];let pronto=false;
  const remoto=tls.connect({host:'test.mosquitto.org',port:8883,servername:'test.mosquitto.org',ca:caMosquitto,rejectUnauthorized:true},()=>{
    pronto=true;for(const b of fila)remoto.write(b);fila.length=0;
    console.log('Ponte MQTT: TLS do broker validado.');
  });
  remoto.setTimeout(90000,()=>{ws.close();remoto.destroy();});
  ws.on('message',b=>{if(pronto)remoto.write(b);else if(fila.length<10)fila.push(b);else ws.close();});
  remoto.on('data',b=>{if(ws.readyState===1)ws.send(b);});
  remoto.on('error',e=>{console.log('Ponte MQTT:',e.code||'falha TLS');ws.close();});
  remoto.on('close',()=>ws.close());ws.on('close',()=>remoto.destroy());
  ws.on('error',()=>remoto.destroy());
});
server.listen(8789,'127.0.0.1',()=>console.log('Pagina: http://127.0.0.1:8789/cofre.html'));
