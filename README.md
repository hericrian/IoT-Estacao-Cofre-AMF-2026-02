# Estação Cofre — IoT AMF 2026-02

**Aluno:** Héric Rían dos Santos Pereira · **Professor:** Leonam Vieira Hemann

Atividade de 06/10/2026: ESP32, DHT22 (GPIO 4), LED (GPIO 2), TLS validado, API key, HMAC-SHA256 com anti-replay e AES-128-GCM no MQTT.

- [Projeto no Wokwi](https://wokwi.com/projects/477173835312859137)
- [Leituras no Worker publicado](https://iot-cofre-heric.hericrianamf.workers.dev/list?sensor=temp)
- [Entrega e respostas](ENTREGA.md)
- [Enunciado original](ENUNCIADO.md)
- [Evidências reais](evidencias/)

## Executar

`npm ci` instala a dependência da ponte local. `npm test` executa os 6 testes locais de segurança.

`node scripts/servir-pagina.mjs` abre o servidor local do painel; acesse http://127.0.0.1:8789/cofre.html. Se WSS direto não conectar, selecione a ponte local: loopback no computador e TLS com CA validada entre servidor local e broker. Não expõe um servidor na rede local.

`node scripts/testar-worker.mjs` valida a implantação real no Cloudflare. `node scripts/verificar-cifra-serial.mjs` verifica a cifra real capturada do ESP32; ambos leem chaves do `config.h` ignorado e gravam resultados sem chaves.

O projeto Wokwi usa `config.public.h` e recebe as chaves pelo Serial, em uma linha `API_KEY|CHAVE_HMAC|CHAVE_AES_HEX`. Não imprime nem salva os valores. Na placa, copie `config.example.h` para `config.h` e configure Wi-Fi e chaves. `config.h` é ignorado pelo Git. Os Secrets do Worker são `API_KEY` e `CHAVE_HMAC`; `EXIGIR_ASSINATURA=sim` é a configuração final.

`worker/wrangler.toml` aponta para o Worker `iot-cofre-heric` e usa o banco D1 `iot-sala` existente. Aplique `worker/schema.sql` para criar as tabelas auxiliares. Os exemplos de teste usam dados de laboratório; não representam medições de uma sala real.

## Observação do broker

A porta 8885 foi testada com TLS validado, mas o broker recusou o login público com CONNACK 5. Após duas falhas, o firmware tenta 8883, também com CA validada, mantendo HMAC obrigatório nos comandos e AES-GCM no conteúdo. Isso preserva os testes sem desativar a validação TLS. A evidência e a diferença em relação ao enunciado estão na entrega.

**Estado real:** Worker publicado e 7 testes remotos aprovados; firmware compilado e leitura/cifra do DHT22 verificadas. O fluxo completo do ESP32 ainda teve falhas HTTPS/MQTT. Os testes de CA errada, cofre no painel e comandos físicos ainda dependem da recuperação da conexão. Veja [resultados e pendências](ENTREGA.md); os prints registram os resultados efetivamente observados.

O modo público também oferece `TESTE_CA` pelo Serial para tentar a conexão MQTT com CA errada e depois restaurar a correta. As chaves existem somente em RAM nesse modo.

## Aplicação ao projeto final

TLS validado impede que um impostor se passe pelo servidor. API key e HMAC com anti-replay protegem gravações e comandos de iluminação. AES-GCM impede que assinantes do broker leiam as mensagens. Consultas de presença precisam de autorização, e os segredos ficam fora do Git.
