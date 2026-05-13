/* Apex Tools AI — Website Chatbot Widget
 * Self-contained: appends styles + DOM, talks to /api/chat.
 * Bilingual EN/ES auto-detect via first message.
 * Skipped on /dashboard, /admin, /login, and other authed pages.
 */
(function () {
  // Don't load on authenticated/admin pages
  const path = window.location.pathname;
  if (/^\/(dashboard|admin|login|reset-password|settings)/.test(path)) return;
  if (document.getElementById('apex-chatbot-widget')) return;

  // Language pref from <html lang=""> or URL
  const detectLang = () => {
    const url = window.location.pathname;
    if (url.startsWith('/es')) return 'es';
    const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    if (htmlLang.startsWith('es')) return 'es';
    const browser = (navigator.language || '').toLowerCase();
    return browser.startsWith('es') ? 'es' : 'en';
  };

  const lang = detectLang();
  const T = {
    en: {
      bubble: 'Chat with us',
      headerTitle: 'Apex Tools AI',
      headerSubtitle: 'Live demo — also our actual chatbot',
      placeholder: 'Type your message…',
      send: 'Send',
      greeting: "Hey 👋 I'm Apex's AI assistant — and a live demo of the bilingual chatbot we build for dental practices and med spas. What brings you here today?",
      quickReplies: [
        { label: 'How does this work?', text: 'How does the AI receptionist work?' },
        { label: 'See pricing', text: 'What does it cost?' },
        { label: 'Talk to the demo', text: 'I want to call the demo line. What number do I dial?' },
        { label: 'Book a call', text: 'I want to book a discovery call.' },
      ],
      poweredBy: 'Powered by Apex Tools AI',
      typing: 'Typing…',
      errorGeneric: "Sorry — something went wrong. Try again, or email hello@apextoolsai.com.",
      errorRate: "You're typing fast! Please wait a few seconds before sending another message.",
    },
    es: {
      bubble: 'Chatea con nosotros',
      headerTitle: 'Apex Tools AI',
      headerSubtitle: 'Demo en vivo — también es nuestro chatbot real',
      placeholder: 'Escriba su mensaje…',
      send: 'Enviar',
      greeting: "¡Hola! 👋 Soy el asistente AI de Apex — y una demo en vivo del chatbot bilingüe que armamos para consultorios dentales y med spas. ¿En qué le puedo ayudar?",
      quickReplies: [
        { label: '¿Cómo funciona?', text: '¿Cómo funciona el recepcionista AI?' },
        { label: 'Ver precios', text: '¿Cuánto cuesta?' },
        { label: 'Llamar la demo', text: 'Quiero llamar la línea demo. ¿Qué número marco?' },
        { label: 'Agendar llamada', text: 'Quiero agendar una llamada.' },
      ],
      poweredBy: 'Tecnología de Apex Tools AI',
      typing: 'Escribiendo…',
      errorGeneric: 'Disculpe — algo salió mal. Intente de nuevo o escríbanos a hello@apextoolsai.com.',
      errorRate: '¡Está escribiendo rápido! Espere unos segundos antes de enviar otro mensaje.',
    },
  }[lang];

  // ----- Styles -----
  const style = document.createElement('style');
  style.textContent = `
    #apex-chatbot-bubble {
      position: fixed; right: 20px; bottom: 20px; z-index: 999998;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      box-shadow: 0 8px 24px rgba(249,115,22,0.45), 0 2px 8px rgba(0,0,0,0.15);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: none; color: white;
      transition: transform .2s ease, box-shadow .2s ease;
      animation: apex-bubble-pulse 2.4s ease-in-out infinite;
    }
    @keyframes apex-bubble-pulse {
      0%, 100% { box-shadow: 0 8px 24px rgba(249,115,22,0.45), 0 0 0 0 rgba(249,115,22,0.45); }
      50%       { box-shadow: 0 8px 24px rgba(249,115,22,0.5), 0 0 0 14px rgba(249,115,22,0); }
    }
    #apex-chatbot-bubble:hover { transform: scale(1.08); }
    #apex-chatbot-bubble svg { width: 28px; height: 28px; }
    #apex-chatbot-bubble .apex-bubble-label {
      position: absolute; right: 72px; background: #0a1628; color: #fff;
      padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 600;
      white-space: nowrap; opacity: 0; pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
      transform: translateX(8px);
    }
    #apex-chatbot-bubble:hover .apex-bubble-label { opacity: 1; transform: translateX(0); }

    #apex-chatbot-widget {
      position: fixed; right: 20px; bottom: 20px; z-index: 999999;
      width: min(380px, calc(100vw - 32px));
      height: min(620px, calc(100vh - 40px));
      background: #fff; border-radius: 18px;
      box-shadow: 0 20px 60px rgba(10,22,40,0.25), 0 4px 12px rgba(0,0,0,0.08);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      animation: apex-chat-in .25s ease;
    }
    @keyframes apex-chat-in {
      from { opacity: 0; transform: translateY(20px) scale(.95); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    #apex-chatbot-widget.open { display: flex; }

    .apex-chat-header {
      padding: 14px 16px; background: linear-gradient(135deg, #0a1628 0%, #172a4a 100%);
      color: white; display: flex; align-items: center; gap: 12px;
    }
    .apex-chat-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      position: relative;
    }
    .apex-chat-avatar svg { width: 20px; height: 20px; color: white; }
    .apex-chat-avatar::after {
      content: ''; position: absolute; bottom: -1px; right: -1px;
      width: 11px; height: 11px; background: #10b981; border: 2px solid #0a1628; border-radius: 50%;
    }
    .apex-chat-titles { flex: 1; min-width: 0; }
    .apex-chat-title { font-weight: 700; font-size: 15px; line-height: 1.2; }
    .apex-chat-sub   { font-size: 11px; opacity: .7; margin-top: 2px; }
    .apex-chat-close {
      width: 32px; height: 32px; border: none; background: rgba(255,255,255,0.1); border-radius: 8px;
      color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background .15s ease;
    }
    .apex-chat-close:hover { background: rgba(255,255,255,0.2); }
    .apex-chat-close svg { width: 16px; height: 16px; }

    .apex-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
      display: flex; flex-direction: column; gap: 10px;
    }
    .apex-msg { max-width: 85%; padding: 10px 14px; border-radius: 16px;
      font-size: 14px; line-height: 1.5; word-wrap: break-word; }
    .apex-msg.bot { background: #f1f5f9; color: #0f172a; border-bottom-left-radius: 4px; align-self: flex-start; }
    .apex-msg.user { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; border-bottom-right-radius: 4px; align-self: flex-end; }
    .apex-msg.typing { background: #f1f5f9; color: #64748b; font-style: italic; align-self: flex-start;
      display: flex; align-items: center; gap: 6px; }
    .apex-typing-dots { display: inline-flex; gap: 3px; }
    .apex-typing-dots span { width: 5px; height: 5px; background: #94a3b8; border-radius: 50%;
      animation: apex-typing 1.2s ease-in-out infinite; }
    .apex-typing-dots span:nth-child(2) { animation-delay: .15s; }
    .apex-typing-dots span:nth-child(3) { animation-delay: .3s; }
    @keyframes apex-typing {
      0%, 60%, 100% { transform: translateY(0); opacity: .4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
    .apex-msg a { color: #ea580c; text-decoration: underline; }
    .apex-msg.user a { color: white; }

    .apex-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }
    .apex-quick-btn { background: white; border: 1px solid #e2e8f0; border-radius: 18px;
      padding: 6px 12px; font-size: 12px; font-weight: 500; color: #0f172a; cursor: pointer;
      transition: all .15s ease; }
    .apex-quick-btn:hover { background: #fff7ed; border-color: #f97316; color: #ea580c; }

    .apex-chat-input-row {
      display: flex; gap: 8px; padding: 12px; background: white; border-top: 1px solid #e2e8f0;
    }
    .apex-chat-input {
      flex: 1; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 22px;
      font-size: 14px; outline: none; font-family: inherit;
      transition: border-color .15s ease;
    }
    .apex-chat-input:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,0.1); }
    .apex-chat-send {
      width: 42px; height: 42px; border: none; border-radius: 50%;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease;
    }
    .apex-chat-send:hover:not(:disabled) { transform: scale(1.08); }
    .apex-chat-send:disabled { opacity: .5; cursor: not-allowed; }
    .apex-chat-send svg { width: 18px; height: 18px; }

    .apex-chat-footer {
      padding: 6px 12px; text-align: center; font-size: 10px; color: #94a3b8;
      background: white; border-top: 1px solid #f1f5f9;
    }
    .apex-chat-footer a { color: #94a3b8; text-decoration: none; }
    .apex-chat-footer a:hover { color: #ea580c; }

    @media (max-width: 480px) {
      #apex-chatbot-widget { right: 0; bottom: 0; width: 100vw; height: 100vh; border-radius: 0; }
      #apex-chatbot-bubble { right: 16px; bottom: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ----- DOM -----
  const bubble = document.createElement('button');
  bubble.id = 'apex-chatbot-bubble';
  bubble.setAttribute('aria-label', T.bubble);
  bubble.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
    <span class="apex-bubble-label">${T.bubble}</span>
  `;
  document.body.appendChild(bubble);

  const widget = document.createElement('div');
  widget.id = 'apex-chatbot-widget';
  widget.innerHTML = `
    <div class="apex-chat-header">
      <div class="apex-chat-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="3"/>
          <path d="M5 21v-2a7 7 0 0 1 14 0v2"/>
        </svg>
      </div>
      <div class="apex-chat-titles">
        <div class="apex-chat-title">${T.headerTitle}</div>
        <div class="apex-chat-sub">${T.headerSubtitle}</div>
      </div>
      <button class="apex-chat-close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="apex-chat-messages" id="apex-chat-messages"></div>
    <div class="apex-quick-replies" id="apex-quick-replies"></div>
    <div class="apex-chat-input-row">
      <input class="apex-chat-input" id="apex-chat-input" placeholder="${T.placeholder}" autocomplete="off" />
      <button class="apex-chat-send" id="apex-chat-send" aria-label="${T.send}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
    <div class="apex-chat-footer">${T.poweredBy}</div>
  `;
  document.body.appendChild(widget);

  const $messages = widget.querySelector('#apex-chat-messages');
  const $input = widget.querySelector('#apex-chat-input');
  const $send = widget.querySelector('#apex-chat-send');
  const $quick = widget.querySelector('#apex-quick-replies');
  const $close = widget.querySelector('.apex-chat-close');

  // ----- State -----
  let sessionId = sessionStorage.getItem('apex-chat-session') || '';
  let sending = false;
  let opened = false;

  const saveSession = (id) => { sessionId = id; sessionStorage.setItem('apex-chat-session', id); };

  const linkify = (text) => {
    const esc = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    return esc
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b)/g, '<a href="tel:$1">$1</a>')
      .replace(/\n/g, '<br>');
  };

  const addMessage = (role, text) => {
    const el = document.createElement('div');
    el.className = `apex-msg ${role}`;
    el.innerHTML = linkify(text);
    $messages.appendChild(el);
    $messages.scrollTop = $messages.scrollHeight;
    return el;
  };

  const showTyping = () => {
    const el = document.createElement('div');
    el.className = 'apex-msg typing';
    el.innerHTML = `${T.typing} <span class="apex-typing-dots"><span></span><span></span><span></span></span>`;
    el.id = 'apex-typing-indicator';
    $messages.appendChild(el);
    $messages.scrollTop = $messages.scrollHeight;
  };
  const hideTyping = () => { document.getElementById('apex-typing-indicator')?.remove(); };

  const showQuickReplies = (replies) => {
    $quick.innerHTML = '';
    if (!replies?.length) return;
    replies.forEach(r => {
      const b = document.createElement('button');
      b.className = 'apex-quick-btn';
      b.textContent = r.label;
      b.onclick = () => { sendMessage(r.text); };
      $quick.appendChild(b);
    });
  };
  const hideQuickReplies = () => { $quick.innerHTML = ''; };

  const sendMessage = async (text) => {
    text = (text || $input.value || '').trim();
    if (!text || sending) return;
    sending = true;
    $send.disabled = true;
    $input.value = '';
    hideQuickReplies();
    addMessage('user', text);
    showTyping();

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, message: text, language: lang,
          pageUrl: window.location.href,
          referrer: document.referrer || null,
        }),
      });
      hideTyping();
      if (resp.status === 429) {
        addMessage('bot', T.errorRate);
      } else {
        const data = await resp.json();
        if (data.sessionId) saveSession(data.sessionId);
        if (data.reply) addMessage('bot', data.reply);
        else addMessage('bot', T.errorGeneric);
      }
    } catch (e) {
      hideTyping();
      addMessage('bot', T.errorGeneric);
    } finally {
      sending = false;
      $send.disabled = false;
      $input.focus();
    }
  };

  // ----- Wire up events -----
  const openChat = () => {
    widget.classList.add('open');
    bubble.style.display = 'none';
    opened = true;
    if ($messages.children.length === 0) {
      addMessage('bot', T.greeting);
      showQuickReplies(T.quickReplies);
    }
    setTimeout(() => $input.focus(), 200);
  };
  const closeChat = () => {
    widget.classList.remove('open');
    bubble.style.display = 'flex';
  };

  bubble.addEventListener('click', openChat);
  $close.addEventListener('click', closeChat);
  $send.addEventListener('click', () => sendMessage());
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // First-visit attention nudge after 20s if not opened
  setTimeout(() => {
    if (!opened && bubble.style.display !== 'none') {
      const label = bubble.querySelector('.apex-bubble-label');
      if (label) {
        label.style.opacity = '1';
        label.style.transform = 'translateX(0)';
        setTimeout(() => {
          if (!opened) { label.style.opacity = ''; label.style.transform = ''; }
        }, 3500);
      }
    }
  }, 20000);
})();
