const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 64125);
const ROOT = __dirname;
const BOT_TOKEN = '8862561283:AAFeIgqIFgaoZvWwTd_F9JrcjiYlHRvRCdo';
const ADMIN_FILE = path.join(ROOT, 'telegram-admin.json');
const REQUESTS_FILE = path.join(ROOT, 'booking-requests.jsonl');

let adminChatId = '';
let updateOffset = 0;
let isPolling = false;

function loadConfig() {
  try {
    if (fs.existsSync(ADMIN_FILE)) {
      const data = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
      adminChatId = data.chatId ? String(data.chatId) : '';
      updateOffset = Number(data.updateOffset || 0);
      console.log('[System] Loaded config. Admin ID:', adminChatId, 'Offset:', updateOffset);
    }
  } catch (err) {
    console.error('[System] Failed to load config:', err.message);
  }
}

function saveConfig() {
  try {
    const data = {
      chatId: adminChatId,
      updateOffset: updateOffset,
      lastUpdate: new Date().toISOString()
    };
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[System] Failed to save config:', err.message);
  }
}

loadConfig();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatBooking(data) {
  return [
    '🔔 *НОВА ЗАЯВКА: ВАЛЕНSІА*',
    '',
    `👤 *Ім’я:* ${clean(data.name) || 'не вказано'}`,
    `📞 *Контакт:* ${clean(data.contact) || 'не вказано'}`,
    `🎉 *Подія:* ${clean(data.eventFormat) || 'не вказано'}`,
    `👥 *Гості:* ${clean(data.guests) || 'не вказано'}`,
    '',
    `💬 *Коментар:* ${clean(data.comment) || 'відсутній'}`
  ].join('\n');
}

async function telegramSendMessage(chatId, text) {
  if (!BOT_TOKEN || !chatId) return { ok: false };
  console.log(`[Telegram] Sending to ${chatId}...`);
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    const result = await response.json();
    console.log('[Telegram] Send result:', result.ok ? 'SUCCESS' : 'FAILED', result.description || '');
    return result;
  } catch (err) {
    console.error('[Telegram] Error sending message:', err.message);
    return { ok: false };
  }
}

async function pollTelegram() {
  if (!BOT_TOKEN || isPolling) return;
  isPolling = true;
  
  const url = new URL(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
  url.searchParams.set('timeout', '20');
  if (updateOffset) url.searchParams.set('offset', String(updateOffset));
  
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const updates = await response.json();
    
    if (updates.ok && Array.isArray(updates.result)) {
      let changed = false;
      for (const update of updates.result) {
        if (update.update_id >= updateOffset) {
          updateOffset = update.update_id + 1;
          changed = true;
        }
        
        const message = update.message;
        if (!message || !message.text) continue;

        const chatId = String(message.chat.id);
        const text = message.text.trim();
        console.log(`[Telegram] Message from ${chatId}: ${text}`);

        if (text === '/start') {
          await telegramSendMessage(chatId, '🔒 *ВХІД У СИСТЕМУ ВАЛЕНSІА*\n\nБудь ласка, введіть секретний пароль менеджера для активації сповіщень:');
          continue;
        }

        if (text === '7uj8ik9ol0p@') {
          adminChatId = chatId;
          saveConfig();
          await telegramSendMessage(chatId, '👑 *АВТОРИЗАЦІЯ УСПІШНА*\n\nТепер ви офіційний менеджер сайту «Валенsіа». Усі нові заявки будуть надходити сюди миттєво.');
          continue;
        }

        if (!adminChatId || adminChatId !== chatId) {
          await telegramSendMessage(chatId, '⚠️ *ДОСТУП ЗАБОРОНЕНО*\nНевірний пароль. Спробуйте ще раз або зверніться до адміністратора.');
        }
      }
      if (changed) saveConfig();
    }
  } catch (error) {
    // console.error('[Telegram Polling] Error:', error.message);
  } finally {
    isPolling = false;
    setTimeout(pollTelegram, 500);
  }
}

async function handleBooking(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const data = JSON.parse(rawBody || '{}');
    if (!clean(data.name) || !clean(data.contact)) {
      return jsonResponse(res, 400, { ok: false, error: 'Вкажіть ім’я та контакт.' });
    }

    fs.appendFileSync(REQUESTS_FILE, JSON.stringify({ createdAt: new Date().toISOString(), ...data }) + '\n', 'utf8');

    if (BOT_TOKEN && adminChatId) {
      await telegramSendMessage(adminChatId, formatBooking(data));
      return jsonResponse(res, 200, { ok: true, adminReady: true });
    }

    return jsonResponse(res, 200, { ok: true, adminReady: false });
  } catch (error) {
    console.error('[Booking Error]', error.message);
    return jsonResponse(res, 500, { ok: false, error: 'Помилка сервера.' });
  }
}

function serveStatic(req, res) {
  const requestedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestedUrl.pathname);
  let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (safePath === '.' || safePath === '\\' || safePath === '/') safePath = 'index.html';
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/booking') { handleBooking(req, res); return; }
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 [Server] Валенsіа running at http://127.0.0.1:${PORT}/`);
  if (BOT_TOKEN) {
    console.log(adminChatId ? '✅ [Telegram] Manager connected.' : '⏳ [Telegram] Waiting for manager login...');
    pollTelegram();
  }
});