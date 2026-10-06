# Evidências reais — 06/10/2026

As imagens são capturas reais do navegador. Os arquivos de resultados vieram de execuções efetivas dos scripts. Campos de chaves estão mascarados; nenhuma chave foi publicada.

| Evidência | O que comprova |
|---|---|
| [Worker antes/depois](worker-antes-depois.jpg) | Página com logs reais dos ataques ao Worker de laboratório |
| [MQTT legível](passo1-mqtt-legivel.jpg) | Payload próprio de laboratório visível antes da cifra |
| [Broker 8885](passo4-broker8885.jpg) | Recusa real de autenticação no Serial da simulação |
| [Leitura e cifra do ESP32](wokwi-leitura-cifra-falha-rede.jpg) | DHT22 e AES-GCM executados; falhas de rede também aparecem |
| [Cifra verificada](cifra-real-verificada.jpg) | Bytes reais do ESP32 abertos pela chave correta e recusados por duas chaves diferentes, via teste a partir do Serial |
| [7 testes remotos](testes-remotos.json) | API key, adulteração, replay simultâneo, timestamps e validação no Worker/D1 publicados |
| [Cliente MQTT real](teste-transporte-mqtt.json) | Roundtrip no broker usando a implementação do cliente do painel em Node |
| [Cifra real em JSON](cifra-real-esp32.json) | Resultado verificável com captura original do firmware |

O print do relatório mostra dados de execução apresentados em HTML. Não é uma captura de terminal nem substitui o teste completo do ESP32 até o painel. `wokwi-gateway-falha.jpg` registra uma falha do gateway. O broker público e o fluxo de rede da simulação falharam em tentativas posteriores; a confirmação integral de comandos e do cofre recebido pelo painel permanece pendente conforme [ENTREGA.md](../ENTREGA.md).
