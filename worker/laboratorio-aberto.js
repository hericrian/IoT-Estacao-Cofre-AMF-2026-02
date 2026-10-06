// Somente laboratório do Passo 1. Nunca use como implantação final.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/insert' && request.method === 'POST') {
      const b = await request.json();
      await env.DB.prepare('INSERT INTO leituras (sensor, valor, timestamp) VALUES (?, ?, ?)')
        .bind(b.sensor, b.valor, Date.now()).run();
      return new Response('Laboratorio antes das camadas: leitura aceita');
    }
    if (url.pathname === '/list') {
      const {results} = await env.DB.prepare('SELECT valor, timestamp FROM leituras WHERE sensor = ? ORDER BY timestamp DESC LIMIT 50')
        .bind(url.searchParams.get('sensor') || 'temp').all();
      return Response.json(results);
    }
    return new Response('Laboratorio temporario', {status:404});
  }
};
