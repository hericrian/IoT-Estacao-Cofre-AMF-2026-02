// Cliente MQTT 3.1.1 mínimo: WebSocket, QoS 0, SUBSCRIBE e keep-alive.
// Sem CDN: o painel continua utilizável quando bibliotecas externas falham.
const mqtt = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const juntar = (...partes) => {
    const out = new Uint8Array(partes.reduce((n,p)=>n+p.length,0));
    let i=0; for (const p of partes) { out.set(p,i); i+=p.length; } return out;
  };
  const texto = s => { const b=enc.encode(s); return juntar(new Uint8Array([b.length>>8,b.length&255]),b); };
  function pacote(tipo,corpo=new Uint8Array()) {
    let n=corpo.length, bytes=[];
    do { let b=n%128; n=Math.floor(n/128); if(n)b|=128; bytes.push(b); } while(n);
    return juntar(new Uint8Array([tipo,...bytes]),corpo);
  }
  class Cliente {
    constructor(url,opcoes={}) {
      this.connected=false; this.eventos=new Map(); this.id=0; this.buffer=new Uint8Array();
      this.ws=new WebSocket(url,'mqtt'); this.ws.binaryType='arraybuffer';
      this.limite=setTimeout(()=>{this.emitir('error',new Error('Tempo de conexão excedido'));this.end();},opcoes.connectTimeout||30000);
      this.ws.onopen=()=>this.ws.send(pacote(16,juntar(texto('MQTT'),new Uint8Array([4,2,0,60]),texto(opcoes.clientId||'cofre-'+Date.now()))));
      this.ws.onmessage=e=>{
        this.buffer=juntar(this.buffer,new Uint8Array(e.data));
        this.processar();
      };
      this.ws.onerror=()=>this.emitir('error',new Error('Falha no WebSocket MQTT'));
      this.ws.onclose=()=>{clearTimeout(this.limite);clearInterval(this.ping);this.connected=false;this.emitir('close');};
    }
    on(evento,fn) { if(!this.eventos.has(evento))this.eventos.set(evento,[]);this.eventos.get(evento).push(fn);return this; }
    emitir(evento,...args) { for(const fn of this.eventos.get(evento)||[])fn(...args); }
    processar() {
      while(this.buffer.length>=2) {
        let n=0, multiplicador=1, i=1, b;
        do {
          if(i>=this.buffer.length)return;
          b=this.buffer[i++];n+=(b&127)*multiplicador;multiplicador*=128;
          if(i>5){this.emitir('error',new Error('Pacote MQTT inválido'));this.end();return;}
        }while(b&128);
        if(this.buffer.length<i+n)return;
        const tipo=this.buffer[0], corpo=this.buffer.slice(i,i+n);
        this.buffer=this.buffer.slice(i+n);
        if((tipo>>4)===2) {
          clearTimeout(this.limite);
          if(corpo[1]!==0){this.emitir('error',new Error('CONNACK recusado: '+corpo[1]));this.end();return;}
          this.connected=true;this.ping=setInterval(()=>{if(this.connected)this.ws.send(pacote(192));},20000);this.emitir('connect');
        }else if((tipo>>4)===3) {
          const tam=(corpo[0]<<8)|corpo[1];
          let inicio=2+tam;
          if(((tipo>>1)&3)>0)inicio+=2;
          const bytes=corpo.slice(inicio);
          this.emitir('message',dec.decode(corpo.slice(2,2+tam)),{toString:()=>dec.decode(bytes)});
        }else if((tipo>>4)===9 && corpo[2]===128) {
          this.emitir('error',new Error('Assinatura do tópico recusada pelo broker'));
        }
      }
    }
    subscribe(topico) {
      if(!this.connected)return false;
      this.id=(this.id%65535)+1;
      this.ws.send(pacote(130,juntar(new Uint8Array([this.id>>8,this.id&255]),texto(topico),new Uint8Array([0]))));return true;
    }
    publish(topico,conteudo) {
      if(!this.connected)return false;
      this.ws.send(pacote(48,juntar(texto(topico),enc.encode(conteudo))));return true;
    }
    end() { clearTimeout(this.limite);clearInterval(this.ping);this.connected=false;this.ws.close(); }
  }
  return {connect:(url,opcoes)=>new Cliente(url,opcoes)};
})();
