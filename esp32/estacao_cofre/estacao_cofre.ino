// ================================================================
//  ESTACAO COFRE - a estacao de sempre (DHT + LED), agora blindada
//
//  Camada 1  TLS de verdade ......... setCACert() em vez de setInsecure()
//  Camada 2  API key ................ cabecalho X-API-Key no Worker
//  Camada 3  Assinatura HMAC ........ cabecalho X-Assinatura (+ ts anti-replay)
//  Camada 4  Cofre AES-GCM .......... leitura cifrada de ponta a ponta no MQTT
//  Bonus     Comandos assinados ..... so obedece comando com assinatura valida
//
//  Arquivos desta pasta:
//    config.h        -> SEGREDOS (copie de config.example.h). Nao versionar!
//    certificados.h  -> CAs publicas (gerado por scripts/gerar_certificados.ps1)
//
//  Bibliotecas: "PubSubClient" (Nick O'Leary) e "DHT sensor library" (Adafruit).
//  A criptografia (mbedtls) ja vem dentro do core do ESP32 - nada a instalar.
// ================================================================
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>
#include "esp_sntp.h"
#include "mbedtls/md.h"      // HMAC-SHA256
#include "mbedtls/gcm.h"     // AES-GCM
#include "mbedtls/base64.h"  // Base64
#include "config.h"
#include "certificados.h"

// No projeto público Wokwi, as chaves entram pelo Serial somente em RAM.
// Use config.public.h como config.h para esse modo; não salve chaves no editor.
#ifdef PROVISIONAR_SERIAL
String segredoApi, segredoHmac, segredoAes;
#undef API_KEY
#undef CHAVE_HMAC
#undef CHAVE_AES_HEX
#define API_KEY segredoApi.c_str()
#define CHAVE_HMAC segredoHmac.c_str()
#define CHAVE_AES_HEX segredoAes.c_str()
void provisionarSerial() {
  Serial.println("[CONFIG] Envie API_KEY|CHAVE_HMAC|CHAVE_AES_HEX pelo Serial; valores nao serao impressos.");
  for (;;) {
    if (!Serial.available()) { delay(10); continue; }
    String linha = Serial.readStringUntil('\n');
    linha.trim();
    int p1 = linha.indexOf('|'), p2 = linha.lastIndexOf('|');
    if (p1 <= 0 || p2 <= p1) { Serial.println("[CONFIG] Formato invalido."); continue; }
    segredoApi = linha.substring(0, p1);
    segredoHmac = linha.substring(p1 + 1, p2);
    segredoAes = linha.substring(p2 + 1);
    if (segredoApi.length() != 32 || segredoHmac.length() != 64 || segredoAes.length() != 32) {
      Serial.println("[CONFIG] Tamanhos invalidos."); continue;
    }
    Serial.println("[CONFIG] Chaves recebidas em RAM.");
    return;
  }
}
#endif

#define DHTPIN   4
#ifndef DHTTYPE
#define DHTTYPE  DHT11       // no Wokwi use DHT22
#endif
#define LED      2

#define INTERVALO_MS   15000 // uma leitura a cada 15 s
#define JANELA_CMD_S   30    // comando com mais de 30 s e' considerado velho

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure tlsMqtt;    // canal TLS que fica aberto com o broker
PubSubClient mqtt(tlsMqtt);

String T_COFRE  = String("sis1a/") + NOME + "/cofre";    // leituras CIFRADAS
String T_CMD    = String("sis1a/") + NOME + "/comando";  // comandos (assinados)
String T_STATUS = String("sis1a/") + NOME + "/status";   // respostas aos comandos

uint8_t  chaveAES[16];
uint32_t ultimoTsCmd = 0;    // anti-replay dos comandos
bool     ledOn = false;
unsigned long ultimo = 0;
uint16_t portaMqttAtual = MQTT_PORTA;
uint8_t falhasMqtt = 0;
unsigned long proximaTentativaApi = 0;

// ---------------------------------------------------------------
//  Utilidades de criptografia
// ---------------------------------------------------------------

// HMAC-SHA256(CHAVE_HMAC, msg) em hexadecimal minusculo (64 caracteres)
String hmacHex(const String& msg) {
  uint8_t mac[32];
  int resultado = mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                  (const uint8_t*)CHAVE_HMAC, strlen(CHAVE_HMAC),
                  (const uint8_t*)msg.c_str(), msg.length(), mac);
  if (resultado != 0) return String();
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", mac[i]);
  hex[64] = '\0';
  return String(hex);
}

// Compara sem "vazar" pelo tempo em que posicao a diferenca aparece
bool iguais(const String& a, const String& b) {
  if (a.length() != b.length()) return false;
  uint8_t dif = 0;
  for (unsigned int i = 0; i < a.length(); i++) dif |= a[i] ^ b[i];
  return dif == 0;
}

String base64(const uint8_t* dados, size_t n) {
  size_t tam = 0;
  mbedtls_base64_encode(NULL, 0, &tam, dados, n);      // descobre o tamanho
  unsigned char* buf = (unsigned char*)malloc(tam + 1);
  if (!buf) return String();
  if (mbedtls_base64_encode(buf, tam, &tam, dados, n) != 0) {
    free(buf);
    return String();
  }
  buf[tam] = '\0';
  String s = String((const char*)buf).substring(0, tam);
  free(buf);
  return s;
}

bool hexParaBytes(const char* hex, uint8_t* saida, size_t n) {
  if (strlen(hex) != 2 * n) return false;
  for (size_t i = 0; i < n; i++) {
    char par[3] = { hex[2 * i], hex[2 * i + 1], '\0' };
    char* fim;
    saida[i] = (uint8_t)strtol(par, &fim, 16);
    if (*fim != '\0') return false;
  }
  return true;
}

// Cifra 'claro' com AES-128-GCM. Devolve {"iv":"...","dados":"..."}
// "dados" = texto cifrado + tag de 16 bytes (o "lacre" do GCM)
String cifrarCofre(const String& claro) {
  uint8_t iv[12];                                     // NUNCA repetir com a mesma chave
  for (int i = 0; i < 12; i++) iv[i] = (uint8_t)esp_random();

  size_t n = claro.length();
  uint8_t* saida = (uint8_t*)malloc(n + 16);
  if (!saida) return String();
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  int resultado = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, chaveAES, 128);
  if (resultado == 0) resultado = mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, n, iv, sizeof(iv),
                            NULL, 0,                         // sem dado adicional
                            (const uint8_t*)claro.c_str(), saida,
                            16, saida + n);                  // tag vai no fim
  mbedtls_gcm_free(&gcm);
  if (resultado != 0) { free(saida); return String(); }

  String json = "{\"iv\":\"" + base64(iv, sizeof(iv)) +
                "\",\"dados\":\"" + base64(saida, n + 16) + "\"}";
  free(saida);
  return json;
}

uint32_t agora() { return (uint32_t)time(nullptr); }  // segundos desde 1970 (UTC)

// ---------------------------------------------------------------
//  Camadas 1 + 2 + 3: HTTPS validado + API key + assinatura
// ---------------------------------------------------------------
int enviarLeitura(const char* sensor, float valor) {
  WiFiClientSecure tls;
  tls.setCACert(CA_WORKER);           // Camada 1 (antes: tls.setInsecure();)
  tls.setHandshakeTimeout(60);
  tls.setTimeout(20000);

  String corpo = String("{\"nome\":\"") + NOME + "\",\"sensor\":\"" + sensor +
                 "\",\"valor\":" + String(valor, 1) + ",\"ts\":" + String(agora()) + "}";
  String assinatura = hmacHex(corpo); // Camada 3: assina EXATAMENTE o corpo enviado

  HTTPClient http;
  http.setConnectTimeout(20000);
  http.setTimeout(20000);
  http.useHTTP10(true);
  http.begin(tls, String(WORKER_URL) + "/insert");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);          // Camada 2
  http.addHeader("X-Assinatura", assinatura);    // Camada 3
  int codigo = http.POST(corpo);
  char erroTls[120] = "";
  if (codigo < 0) tls.lastError(erroTls, sizeof(erroTls));
  String resposta = http.getString();
  http.end();

  Serial.printf("[HTTPS] %s -> %d %s\n", corpo.c_str(), codigo, resposta.c_str());
  Serial.printf("        assinatura: %s\n", assinatura.c_str());
  if (codigo < 0) {
    Serial.printf("        erro TLS: %s | HTTP: %s\n", erroTls, HTTPClient::errorToString(codigo).c_str());
  }
  return codigo;
}

// ---------------------------------------------------------------
//  Bonus: comandos assinados.  Formato:  comando|ts|assinatura
//  ex.:  led:ON|1791300000|9f2c...   (assinatura = HMAC de "led:ON|1791300000")
// ---------------------------------------------------------------
void responder(const String& texto) {
  Serial.println("[CMD] " + texto);
  mqtt.publish(T_STATUS.c_str(), texto.c_str());
}

void aoReceber(char* topico, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  Serial.printf("[MQTT] recebido em %s: %s\n", topico, msg.c_str());

  int p1 = msg.indexOf('|');
  int p2 = msg.lastIndexOf('|');
  if (p1 < 0 || p2 <= p1) { responder("RECUSADO: sem assinatura -> " + msg); return; }

  String cmd   = msg.substring(0, p1);
  String tsTxt = msg.substring(p1 + 1, p2);
  String sig   = msg.substring(p2 + 1);
  sig.toLowerCase();

  if (!iguais(sig, hmacHex(cmd + "|" + tsTxt))) { responder("RECUSADO: assinatura invalida"); return; }

  uint32_t ts = strtoul(tsTxt.c_str(), NULL, 10);
  uint32_t t  = agora();
  if (ts + JANELA_CMD_S < t || ts > t + JANELA_CMD_S) { responder("RECUSADO: comando expirado"); return; }
  if (ts <= ultimoTsCmd) { responder("RECUSADO: replay (comando repetido)"); return; }
  ultimoTsCmd = ts;

  if (cmd == "led:ON" || cmd == "led:OFF") {
    ledOn = (cmd == "led:ON");
    digitalWrite(LED, ledOn ? HIGH : LOW);
    responder("OK: " + cmd);
  } else {
    responder("RECUSADO: comando desconhecido (" + cmd + ")");
  }
}

// ---------------------------------------------------------------
//  Conexoes
// ---------------------------------------------------------------
void conectarMqtt() {
  if (!mqtt.connected()) {
    Serial.printf("[MQTT] conectando em %s:%d (TLS validado)...", MQTT_HOST, portaMqttAtual);
    String id = String("esp32-") + NOME + "-" + String(esp_random() % 10000);
    bool conectado = portaMqttAtual == 8883
      ? mqtt.connect(id.c_str())
      : mqtt.connect(id.c_str(), MQTT_USER, MQTT_PASS);
    if (conectado) {
      Serial.println(" ok");
      mqtt.subscribe(T_CMD.c_str());
    } else {
      char erro[120];
      tlsMqtt.lastError(erro, sizeof(erro));
      Serial.printf(" falhou rc=%d | TLS: %s (tento de novo em 3 s)\n", mqtt.state(), erro);
      if (++falhasMqtt >= 2 && portaMqttAtual == 8885) {
        portaMqttAtual = 8883;
        mqtt.setServer(MQTT_HOST, portaMqttAtual);
        Serial.println("[MQTT] fallback para 8883 com TLS validado; comandos continuam exigindo HMAC.");
      }
    }
  }
}

void sincronizarRelogio() {
  // TLS e assinatura dependem do relogio certo
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // UTC
  sntp_set_sync_interval(30000); // evita deriva do relogio em simulacao lenta
  Serial.print("[NTP] sincronizando relogio");
  while (agora() < 1700000000UL) { delay(300); Serial.print("."); }
  Serial.printf(" ok (%lu)\n", (unsigned long)agora());
}

void setup() {
  Serial.begin(115200);
#ifdef PROVISIONAR_SERIAL
  provisionarSerial();
#endif
  pinMode(LED, OUTPUT);
  dht.begin();

  if (!hexParaBytes(CHAVE_AES_HEX, chaveAES, sizeof(chaveAES))) {
    Serial.println("CHAVE_AES_HEX invalida: precisa ter 32 caracteres hexadecimais.");
    while (true) delay(1000);
  }

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] conectando");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf(" ok | IP=%s | RSSI=%d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());

  sincronizarRelogio();

  tlsMqtt.setCACert(CA_MOSQUITTO);   // Camada 1 no MQTT (antes: porta 1883, sem TLS)
  tlsMqtt.setHandshakeTimeout(60);
  mqtt.setServer(MQTT_HOST, MQTT_PORTA);
  mqtt.setBufferSize(1024);          // mensagem cifrada e' maior que o padrao (256)
  mqtt.setSocketTimeout(60);        // broker publico pode responder lentamente
  mqtt.setKeepAlive(60);
  mqtt.setCallback(aoReceber);
  // HTTPS continua funcionando mesmo se o broker estiver indisponivel.
  float primeiraLeitura = dht.readTemperature();
  if (!isnan(primeiraLeitura)) enviarLeitura("temp", primeiraLeitura);
}

void loop() {
#ifdef PROVISIONAR_SERIAL
  // Prova local do Passo 4, sem salvar uma variante com CA errada no projeto.
  if (Serial.available()) {
    String teste = Serial.readStringUntil('\n');
    teste.trim();
    if (teste == "TESTE_CA") {
      mqtt.disconnect();
      tlsMqtt.stop();
      tlsMqtt.setCACert(CA_WORKER);
      Serial.println("[TESTE_CA] Tentando MQTT com a CA errada; deve falhar.");
      conectarMqtt();
      tlsMqtt.stop();
      tlsMqtt.setCACert(CA_MOSQUITTO);
      Serial.println("[TESTE_CA] CA correta restaurada.");
    }
  }
#endif
  static unsigned long ultimaTentativaMqtt = 0;
  if (!mqtt.connected() && millis() - ultimaTentativaMqtt >= 3000) {
    ultimaTentativaMqtt = millis();
    conectarMqtt();
  }
  mqtt.loop();
  delay(10); // libera CPU para a rede e para a simulacao

  if (millis() - ultimo >= INTERVALO_MS) {
    ultimo = millis();
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (isnan(t) || isnan(h)) { Serial.println("[DHT] falha na leitura"); return; }

    // Camadas 1-3: grava no Worker
    if (proximaTentativaApi == 0 || (long)(millis() - proximaTentativaApi) >= 0) {
      int codigo = enviarLeitura("temp", t);
      if (codigo > 0) enviarLeitura("umid", h);
      else proximaTentativaApi = millis() + 60000;
    }

    // Camada 4: publica no MQTT so a versao CIFRADA
    String claro = "{\"temp\":" + String(t, 1) + ",\"umid\":" + String(h, 1) +
                   ",\"led\":\"" + (ledOn ? "ON" : "OFF") + "\",\"ts\":" + String(agora()) + "}";
    String cifrado = cifrarCofre(claro);
    if (cifrado.length() == 0 || !mqtt.publish(T_COFRE.c_str(), cifrado.c_str()))
      Serial.println("[COFRE] falha ao cifrar ou publicar");
    Serial.println("[COFRE] claro  : " + claro);
    Serial.println("[COFRE] cifrado: " + cifrado);
  }
}
