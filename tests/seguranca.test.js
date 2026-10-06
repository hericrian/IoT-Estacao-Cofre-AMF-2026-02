import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import worker from '../worker/worker.js';
globalThis.crypto ??= webcrypto;

// Segredos efêmeros exclusivos do teste; não são credenciais de implantação.
function ambiente(assinatura = 'sim') {
  const usadas = new Set();
  const leituras = [];
  const tentativas = [];
  return {
    API_KEY: 'teste-local-api', CHAVE_HMAC: 'teste-local-hmac',
    EXIGIR_ASSINATURA: assinatura, leituras, tentativas,
    DB: { prepare(sql) {
      return { bind(...args) {
        return { async run() {
          if (sql.startsWith('INSERT OR IGNORE')) {
            const changes = usadas.has(args[0]) ? 0 : 1;
            usadas.add(args[0]); return { meta: { changes } };
          }
          if (sql.startsWith('INSERT INTO leituras')) leituras.push(args);
          if (sql.startsWith('INSERT INTO tentativas')) tentativas.push(args);
          return { meta: { changes: 1 } };
        } };
      } };
    } }
  };
}
function requisicao(env, corpo, { chave = true, assinar = true, assinatura } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (chave) headers['X-API-Key'] = env.API_KEY;
  if (assinar) headers['X-Assinatura'] = assinatura ?? createHmac('sha256', env.CHAVE_HMAC).update(corpo).digest('hex');
  return new Request('https://teste.invalid/insert', { method: 'POST', headers, body: corpo });
}
function corpo(extra = {}) {
  return JSON.stringify({ nome: 'heric', sensor: 'temp', valor: 24, ts: Math.floor(Date.now()/1000), ...extra });
}
test('API key: recusa sem chave e aceita chave correta', async () => {
  const env = ambiente('nao'), b = corpo();
  assert.equal((await worker.fetch(requisicao(env,b,{chave:false}),env)).status,401);
  assert.equal(env.leituras.length,0);
  assert.equal((await worker.fetch(requisicao(env,b,{assinar:false}),env)).status,200);
});
test('HMAC: corpo adulterado e assinatura ausente não gravam', async () => {
  const env = ambiente(), b = corpo();
  const sig = createHmac('sha256',env.CHAVE_HMAC).update(b).digest('hex');
  assert.equal((await worker.fetch(requisicao(env,corpo({valor:45}),{assinatura:sig}),env)).status,401);
  assert.equal((await worker.fetch(requisicao(env,b,{assinar:false}),env)).status,401);
  assert.equal(env.leituras.length,0);
  assert.equal(env.tentativas.length,2);
});
test('replay simultâneo: somente uma leitura é gravada', async () => {
  const env = ambiente(), b = corpo();
  const respostas = await Promise.all([worker.fetch(requisicao(env,b),env),worker.fetch(requisicao(env,b),env)]);
  assert.deepEqual(respostas.map(r=>r.status).sort(),[200,401]);
  assert.equal(env.leituras.length,1);
});
test('timestamp antigo ou futuro é recusado', async () => {
  const env = ambiente();
  for (const delta of [-120,120]) {
    const b = corpo({ts:Math.floor(Date.now()/1000)+delta});
    assert.equal((await worker.fetch(requisicao(env,b),env)).status,401);
  }
  assert.equal(env.leituras.length,0);
});
test('entrada inválida não grava: null, string, booleano, faixa, sensor e JSON', async () => {
  for (const b of [corpo({valor:null}),corpo({valor:'24'}),corpo({valor:true}),corpo({valor:999}),corpo({sensor:'outro'}),'null','{']) {
    const env = ambiente('nao');
    assert.equal((await worker.fetch(requisicao(env,b),env)).status,400);
    assert.equal(env.leituras.length,0);
  }
});
test('AES-GCM: abre com chave certa e recusa chave errada ou adulteração', async () => {
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:128},true,['encrypt','decrypt']);
  const other = await crypto.subtle.generateKey({name:'AES-GCM',length:128},true,['encrypt','decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const claro = new TextEncoder().encode('{"temp":24}');
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,claro));
  assert.deepEqual(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cifrado)),claro);
  await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv},other,cifrado));
  cifrado[0] ^= 1;
  await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv},key,cifrado));
});
