/* Apex Tools AI — Website Chatbot Widget v2
 * Industry-grade lead-qualification chatbot.
 * Bilingual EN/ES auto-detect, persistent session, dynamic suggestion chips,
 * inline CTAs (Call Demo / Book / See Pricing), return-visitor recognition.
 * Skipped on /dashboard, /admin, /login, etc.
 */
(function () {
  const path = window.location.pathname;
  if (/^\/(dashboard|admin|login|reset-password|settings)/.test(path)) return;
  if (document.getElementById('apex-chatbot-widget')) return;

  // ----- Language -----
  const detectLang = () => {
    if (window.location.pathname.startsWith('/es')) return 'es';
    const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    if (htmlLang.startsWith('es')) return 'es';
    const browser = (navigator.language || '').toLowerCase();
    return browser.startsWith('es') ? 'es' : 'en';
  };
  const lang = detectLang();

  const TALL = {
    en: {
      bubble: 'Chat with us',
      headerTitle: 'Apex Tools AI',
      headerSubtitle: 'Live demo • Ask me anything',
      placeholder: 'Type your message…',
      send: 'Send',
      greeting: "Hey 👋 I'm Apex's AI assistant — and a live demo of the bilingual chatbot we'd build for your practice. What kind of practice are you running?",
      welcomeBack: "Welcome back 👋 Want to pick up where we left off?",
      quickReplies: [
        { label: 'How does this work?', text: 'How does the AI receptionist work?' },
        { label: 'See pricing', text: 'How much does it cost?' },
        { label: 'Try the demo', text: "What's the demo line phone number?" },
        { label: 'Book a call', text: "I'd like to book a 15-minute discovery call." },
      ],
      poweredBy: 'Powered by Apex Tools AI · live demo',
      typing: 'Apex is typing…',
      errorGeneric: "Sorry — something went wrong. Try again, or email hello@apextoolsai.com.",
      errorRate: "You're typing fast! Please wait a few seconds.",
      ctaCallDemo: '📞 Call the demo line (954) 475-6922',
      ctaBook: '📅 Book a 15-min call',
      ctaPricing: '💰 See full pricing',
      newMsg: 'New message',
    },
    es: {
      bubble: 'Chatea con nosotros',
      headerTitle: 'Apex Tools AI',
      headerSubtitle: 'Demo en vivo • Pregunte lo que sea',
      placeholder: 'Escriba su mensaje…',
      send: 'Enviar',
      greeting: "¡Hola! 👋 Soy el asistente AI de Apex — una demo en vivo del chatbot bilingüe que armaríamos para su consultorio. ¿Qué tipo de consultorio tiene?",
      welcomeBack: "¡Bienvenido de nuevo! 👋 ¿Continuamos donde quedamos?",
      quickReplies: [
        { label: '¿Cómo funciona?', text: '¿Cómo funciona el recepcionista AI?' },
        { label: 'Ver precios', text: '¿Cuánto cuesta?' },
        { label: 'Probar la demo', text: '¿Cuál es el número de la línea demo?' },
        { label: 'Agendar llamada', text: 'Me gustaría agendar una llamada de 15 minutos.' },
      ],
      poweredBy: 'Tecnología de Apex Tools AI · demo en vivo',
      typing: 'Apex está escribiendo…',
      errorGeneric: 'Disculpe — algo salió mal. Intente de nuevo o escríbanos a hello@apextoolsai.com.',
      errorRate: '¡Está escribiendo rápido! Espere unos segundos.',
      ctaCallDemo: '📞 Llamar la línea demo (954) 475-6922',
      ctaBook: '📅 Agendar llamada de 15 min',
      ctaPricing: '💰 Ver precios completos',
      newMsg: 'Mensaje nuevo',
    },
  };
  const T = TALL[lang];
  let convoLang = lang;  // tracks the language of the live conversation

  // ----- Styles -----
  const style = document.createElement('style');
  style.textContent = `
    #apex-chatbot-bubble {
      position: fixed; right: 20px; bottom: 20px; z-index: 999998;
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      box-shadow: 0 8px 24px rgba(249,115,22,0.45), 0 2px 8px rgba(0,0,0,0.15);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: none; color: white;
      transition: transform .2s ease, box-shadow .2s ease;
      animation: apex-bubble-pulse 2.4s ease-in-out infinite;
    }
    @keyframes apex-bubble-pulse {
      0%, 100% { box-shadow: 0 8px 24px rgba(249,115,22,0.45), 0 0 0 0 rgba(249,115,22,0.45); }
      50%      { box-shadow: 0 8px 24px rgba(249,115,22,0.5),  0 0 0 16px rgba(249,115,22,0); }
    }
    #apex-chatbot-bubble:hover { transform: scale(1.08); }
    #apex-chatbot-bubble svg { width: 30px; height: 30px; }
    #apex-chatbot-bubble .apex-bubble-label {
      position: absolute; right: 76px; background: #0a1628; color: #fff;
      padding: 8px 14px; border-radius: 22px; font-size: 13px; font-weight: 600;
      white-space: nowrap; opacity: 0; pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
      transform: translateX(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    #apex-chatbot-bubble:hover .apex-bubble-label { opacity: 1; transform: translateX(0); }
    #apex-chatbot-bubble .apex-bubble-badge {
      position: absolute; top: -2px; right: -2px; min-width: 22px; height: 22px;
      background: #dc2626; color: white; font-size: 12px; font-weight: 700;
      border-radius: 11px; display: none; align-items: center; justify-content: center;
      border: 2px solid white; padding: 0 6px;
    }
    #apex-chatbot-bubble.has-unread .apex-bubble-badge { display: flex; }

    #apex-chatbot-widget {
      position: fixed; right: 20px; bottom: 20px; z-index: 999999;
      width: min(400px, calc(100vw - 32px));
      height: min(640px, calc(100vh - 40px));
      background: #fff; border-radius: 20px;
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
      padding: 16px 18px; background: linear-gradient(135deg, #0a1628 0%, #172a4a 100%);
      color: white; display: flex; align-items: center; gap: 12px;
    }
    .apex-chat-avatar {
      width: 42px; height: 42px; border-radius: 50%;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      position: relative;
    }
    .apex-chat-avatar svg { width: 22px; height: 22px; color: white; }
    .apex-chat-avatar::after {
      content: ''; position: absolute; bottom: -1px; right: -1px;
      width: 12px; height: 12px; background: #10b981; border: 2px solid #0a1628; border-radius: 50%;
    }
    .apex-chat-titles { flex: 1; min-width: 0; }
    .apex-chat-title { font-weight: 700; font-size: 15px; line-height: 1.2; }
    .apex-chat-sub   { font-size: 11px; opacity: .7; margin-top: 2px; }
    .apex-chat-close {
      width: 34px; height: 34px; border: none; background: rgba(255,255,255,0.1); border-radius: 10px;
      color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background .15s ease;
    }
    .apex-chat-close:hover { background: rgba(255,255,255,0.2); }
    .apex-chat-close svg { width: 18px; height: 18px; }

    .apex-chat-messages {
      flex: 1; overflow-y: auto; padding: 18px;
      background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
      display: flex; flex-direction: column; gap: 12px;
    }
    .apex-msg-row { display: flex; align-items: flex-end; gap: 6px; max-width: 88%; }
    .apex-msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
    .apex-msg-row.bot { align-self: flex-start; }
    .apex-msg-avatar {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      display: flex; align-items: center; justify-content: center;
    }
    .apex-msg-avatar svg { width: 14px; height: 14px; color: white; }
    .apex-msg { padding: 10px 14px; border-radius: 16px;
      font-size: 14px; line-height: 1.5; word-wrap: break-word; }
    .apex-msg.bot { background: #f1f5f9; color: #0f172a; border-bottom-left-radius: 4px; }
    .apex-msg.user { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; border-bottom-right-radius: 4px; }
    .apex-msg.typing { background: #f1f5f9; color: #64748b; font-style: italic;
      display: flex; align-items: center; gap: 8px; }
    .apex-typing-dots { display: inline-flex; gap: 3px; }
    .apex-typing-dots span { width: 6px; height: 6px; background: #94a3b8; border-radius: 50%;
      animation: apex-typing 1.2s ease-in-out infinite; }
    .apex-typing-dots span:nth-child(2) { animation-delay: .15s; }
    .apex-typing-dots span:nth-child(3) { animation-delay: .3s; }
    @keyframes apex-typing {
      0%, 60%, 100% { transform: translateY(0); opacity: .4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
    .apex-msg a { color: #ea580c; text-decoration: underline; font-weight: 600; }
    .apex-msg.user a { color: white; }

    .apex-cta-row { padding: 0 18px 8px; }
    .apex-cta-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      color: white; border: none; padding: 10px 16px; border-radius: 22px;
      font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none;
      box-shadow: 0 4px 12px rgba(249,115,22,0.3);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .apex-cta-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(249,115,22,0.4); }

    .apex-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 18px 10px; }
    .apex-quick-btn { background: white; border: 1px solid #e2e8f0; border-radius: 18px;
      padding: 7px 13px; font-size: 12.5px; font-weight: 500; color: #0f172a; cursor: pointer;
      transition: all .15s ease; }
    .apex-quick-btn:hover { background: #fff7ed; border-color: #f97316; color: #ea580c; }

    .apex-chat-input-row {
      display: flex; gap: 8px; padding: 14px; background: white; border-top: 1px solid #e2e8f0;
    }
    .apex-chat-input {
      flex: 1; padding: 11px 16px; border: 1px solid #e2e8f0; border-radius: 22px;
      font-size: 14px; outline: none; font-family: inherit;
      transition: border-color .15s ease;
    }
    .apex-chat-input:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,0.1); }
    .apex-chat-send {
      width: 44px; height: 44px; border: none; border-radius: 50%;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease;
    }
    .apex-chat-send:hover:not(:disabled) { transform: scale(1.08); }
    .apex-chat-send:disabled { opacity: .5; cursor: not-allowed; }
    .apex-chat-send svg { width: 19px; height: 19px; }

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
    <span class="apex-bubble-badge" id="apex-bubble-badge">1</span>
  `;
  document.body.appendChild(bubble);

  const widget = document.createElement('div');
  widget.id = 'apex-chatbot-widget';
  widget.innerHTML = `
    <div class="apex-chat-header">
      <div class="apex-chat-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div class="apex-chat-titles">
        <div class="apex-chat-title">${T.headerTitle}</div>
        <div class="apex-chat-sub">${T.headerSubtitle}</div>
      </div>
      <button class="apex-chat-close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="apex-chat-messages" id="apex-chat-messages"></div>
    <div class="apex-cta-row" id="apex-cta-row"></div>
    <div class="apex-quick-replies" id="apex-quick-replies"></div>
    <div class="apex-chat-input-row">
      <input class="apex-chat-input" id="apex-chat-input" placeholder="${T.placeholder}" autocomplete="off" />
      <button class="apex-chat-send" id="apex-chat-send" aria-label="${T.send}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
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
  const $ctaRow = widget.querySelector('#apex-cta-row');
  const $close = widget.querySelector('.apex-chat-close');
  const $badge = bubble.querySelector('#apex-bubble-badge');

  // ----- State (persists across visits via localStorage) -----
  const STORE = 'apex-chat-v2';
  const loadState = () => {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
  };
  const saveState = (patch) => {
    const s = { ...loadState(), ...patch };
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {}
  };
  const state = loadState();
  let sessionId = state.sessionId || '';
  let history = state.history || []; // [{role, text, cta, suggest}]
  let opened = false;
  let sending = false;

  const linkify = (text) => {
    let esc = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    // Render markdown bold **text** and italic *text* + links + phones + newlines
    esc = esc
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<![\*\w])\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b)/g, m => `<a href="tel:${m.replace(/[^0-9]/g,'')}">${m}</a>`)
      .replace(/\n/g, '<br>');
    return esc;
  };

  const renderMessage = (role, text) => {
    const row = document.createElement('div');
    row.className = `apex-msg-row ${role}`;
    if (role === 'bot') {
      row.innerHTML = `
        <div class="apex-msg-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="apex-msg bot">${linkify(text)}</div>`;
    } else {
      row.innerHTML = `<div class="apex-msg user">${linkify(text)}</div>`;
    }
    $messages.appendChild(row);
    $messages.scrollTop = $messages.scrollHeight;
    return row;
  };

  // ----- Typing indicator -----
  const showTyping = () => {
    const row = document.createElement('div');
    row.className = 'apex-msg-row bot';
    row.setAttribute('data-typing', '1');
    row.innerHTML = `
      <div class="apex-msg-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div class="apex-msg bot typing"><span class="apex-typing-dots"><span></span><span></span><span></span></span></div>`;
    $messages.appendChild(row);
    $messages.scrollTop = $messages.scrollHeight;
    return row;
  };

  // ----- Suggestion chips -----
  const renderQuickReplies = (items) => {
    $quick.innerHTML = '';
    (items || []).forEach((item) => {
      const label = typeof item === 'string' ? item : item.label;
      const text = typeof item === 'string' ? item : (item.text || item.label);
      if (!label) return;
      const btn = document.createElement('button');
      btn.className = 'apex-quick-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => { sendMessage(text); });
      $quick.appendChild(btn);
    });
  };

  // ----- Inline CTA button -----
  const renderCTA = (cta) => {
    $ctaRow.innerHTML = '';
    if (!cta) return;
    const map = {
      call_demo: { label: TALL[convoLang].ctaCallDemo, href: 'tel:+19544756922' },
      book: { label: TALL[convoLang].ctaBook, href: 'https://cal.com/apextoolsai/discovery' },
      pricing: { label: TALL[convoLang].ctaPricing, href: '/#pricing' },
    };
    const c = map[cta];
    if (!c) return;
    const a = document.createElement('a');
    a.className = 'apex-cta-btn';
    a.textContent = c.label;
    a.href = c.href;
    if (c.href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
    $ctaRow.appendChild(a);
  };

  // ----- Send a message to the chat API -----
  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || sending) return;
    sending = true;
    $send.disabled = true;
    $input.value = '';
    $quick.innerHTML = '';
    $ctaRow.innerHTML = '';

    renderMessage('user', text);
    history.push({ role: 'user', text });

    const typingRow = showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId || undefined,
          language: lang,
          pageUrl: window.location.href,
          referrer: document.referrer || '',
        }),
      });
      let data = {};
      try { data = await res.json(); } catch (e) { data = {}; }
      if (typingRow) typingRow.remove();

      if (!res.ok || data.error) {
        const errText = res.status === 429 ? T.errorRate : (data.error || T.errorGeneric);
        renderMessage('bot', errText);
        history.push({ role: 'bot', text: errText });
      } else {
        if (data.sessionId) sessionId = data.sessionId;
        if (data.language === 'es' || data.language === 'en') convoLang = data.language;
        // Sync the widget's own UI (placeholder, header subtitle) to the conversation language
        $input.placeholder = TALL[convoLang].placeholder;
        var subEl = widget.querySelector('.apex-chat-sub');
        if (subEl) subEl.textContent = TALL[convoLang].headerSubtitle;
        const reply = data.reply || T.errorGeneric;
        renderMessage('bot', reply);
        history.push({ role: 'bot', text: reply, cta: data.cta || null, suggest: data.suggest || null });
        if (data.suggest && data.suggest.length) renderQuickReplies(data.suggest);
        renderCTA(data.cta);
      }
    } catch (e) {
      if (typingRow) typingRow.remove();
      renderMessage('bot', T.errorGeneric);
      history.push({ role: 'bot', text: T.errorGeneric });
    }

    saveState({ sessionId: sessionId, history: history.slice(-40) });
    sending = false;
    $send.disabled = false;
    $input.focus();
  }

  // ----- Open / close -----
  const openWidget = () => {
    widget.classList.add('open');
    bubble.style.display = 'none';
    opened = true;
    if ($badge) $badge.style.display = 'none';
    $input.focus();
    $messages.scrollTop = $messages.scrollHeight;
  };
  const closeWidget = () => {
    widget.classList.remove('open');
    bubble.style.display = '';
    opened = false;
  };

  // ----- Events -----
  bubble.addEventListener('click', openWidget);
  $close.addEventListener('click', closeWidget);
  $send.addEventListener('click', () => sendMessage($input.value));
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage($input.value); }
  });

  // ----- Initial render -----
  if (history.length) {
    history.forEach((m) => renderMessage(m.role, m.text));
    const last = history[history.length - 1];
    if (last && last.role === 'bot') {
      if (last.suggest && last.suggest.length) renderQuickReplies(last.suggest);
      renderCTA(last.cta);
    }
  } else {
    renderMessage('bot', T.greeting);
    history.push({ role: 'bot', text: T.greeting });
    renderQuickReplies(T.quickReplies);
    saveState({ sessionId: sessionId, history: history });
  }
})();
