import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';

// Verifica bytes realmente gerados pelo firmware e capturados no Serial.
// Não substitui o teste de publicação MQTT do ESP32.
const root = new URL('../', import.meta.url);
const config = await readFile(new URL('esp32/estacao_cofre/config.h', root), 'utf8');
const hex = config.match(/#define\s+CHAVE_AES_HEX\s+"([^"]+)"/)[1];
const serial = await readFile(new URL('evidencias/wokwi-leitura-cifra-serial.txt', root), 'utf8');
const capturas = [...serial.matchAll(/\[COFRE\] cifrado: (\{[^\r\n]+\})/g)];
assert.ok(capturas.length, 'A captura precisa conter ciphertext real do firmware');
const pacote = JSON.parse(capturas.at(-1)[1]);
async function abrir(chaveHex) {
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(chaveHex, 'hex'), 'AES-GCM', false, ['decrypt']);
  return JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(pacote.iv, 'base64') }, key, Buffer.from(pacote.dados, 'base64'))).toString());
}
const leitura = await abrir(hex);
assert.equal(leitura.temp, 24);
assert.equal(leitura.umid, 50);
const errada = (hex[0] === '0' ? '1' : '0') + hex.slice(1);
await assert.rejects(() => abrir(errada));
await assert.rejects(() => abrir('11'.repeat(16)));
const resultado = { executadoEm: new Date().toISOString(), origem: 'Ciphertext real do ESP32/DHT22, capturado no Serial do Wokwi', transporteMqttDoEsp32Confirmado: false, chaveCorreta: { resultado: 'APROVADO', leitura }, chaveAlterada: 'RECUSADA', segundaChaveIndependente: 'RECUSADA', pacote };
await writeFile(new URL('evidencias/cifra-real-esp32.json', root), JSON.stringify(resultado, null, 2) + '\n');
console.log('Cifra real do ESP32: abriu com a chave correta; recusou duas chaves diferentes.');
