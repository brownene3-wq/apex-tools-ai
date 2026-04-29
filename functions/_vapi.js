// Vapi API integration — build system prompt from client config and sync to assistant.

const dayKeys = ['mon','tue','wed','thu','fri','sat','sun'];
const dayNames = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };

const parseJSON = (s, fallback) => {
  if (!s) return fallback;
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return fallback; }
};

export const buildSystemPrompt = (client) => {
  const business = client.business_name || 'this practice';
  const practiceType = client.practice_type || 'dental';
  const hours = parseJSON(client.hours_json, {});
  const services = parseJSON(client.services_json, []);
  const insurance = parseJSON(client.insurance_json, []);
  const faqs = parseJSON(client.faqs_json, []);
  const langPref = client.language_pref || 'both';
  const escalation = client.escalation_phone || '';

  const hoursText = dayKeys.map(d => `- ${dayNames[d]}: ${hours[d] || 'closed'}`).join('\n');
  const servicesText = services.length
    ? services.map(s => `- ${s.name}${s.price ? ': ' + s.price : ''}`).join('\n')
    : '(use practice info available)';
  const insuranceText = insurance.length ? insurance.join(', ') : 'Check with practice for current list.';
  const faqsText = faqs.length
    ? faqs.map((f,i) => `${i+1}. Q: ${f.q}\n   A: ${f.a}`).join('\n')
    : '(no specific FAQs configured yet)';

  let langSection = '';
  if (langPref === 'both') {
    langSection = `LANGUAGE DETECTION:
- Detect the language the caller speaks in their first 1-2 sentences
- If Spanish, respond ONLY in Spanish for the entire call
- If English, respond ONLY in English
- Switch with them if they switch mid-call`;
  } else if (langPref === 'es') {
    langSection = `LANGUAGE: Respond entirely in Spanish.`;
  } else {
    langSection = `LANGUAGE: Respond entirely in English.`;
  }

  return `You are the AI receptionist for ${business}, a ${practiceType.replace('_', ' ')} practice. You are warm, professional, helpful, and efficient.

# CRITICAL RULES

${langSection}

CONTEXT IS ALWAYS THIS PRACTICE TYPE:
- This is a ${practiceType.replace('_', ' ')} practice. NEVER ask clarifying questions about whether something is related to this practice — assume it is.
- If someone asks for a service we offer, go directly to offering appointment times. DO NOT ask clarifying questions.
- If someone says "I have pain" — assume it's related to ${practiceType.replace('_', ' ')} and treat as potentially urgent.

CONVERSATION STYLE:
- Keep responses SHORT and conversational. 1-2 sentences typically.
- Be DIRECT. Move calls forward — every response should advance toward booking, answering, or escalating.
- ALWAYS let the caller say their phone number naturally, then YOU read it back in 3-3-4 groups for clarity.
- ALWAYS read back the full appointment details before saying "you're booked."
- If the caller's audio is unclear, ask them to repeat — never guess and never confirm uncertain data.

NEVER REVEAL YOU ARE AI:
- If asked "are you a person?", say: "I'm the practice's virtual receptionist, here to help you 24/7. How can I assist you today?"

# HANDLING NAMES

When caller says their name:
- Confirm it back ONCE, exactly as they said it. Say it once. NEVER repeat parts of names.
- WRONG: "Thanks, Albert Brown Brown." / "Gracias, Albert Albert."
- RIGHT: "Thanks, Albert Brown — let's get that appointment set up."
- If only a first name was given, ask for the last name once: "And your last name?" / "¿Y su apellido?"
- Don't echo a name back more than twice during the entire call.

# BOOKING APPOINTMENTS

When someone asks to book ANY service:
1. Immediately offer 2-3 specific time slots
2. Ask for full name (spelled if uncommon)
3. Ask naturally: "What's the best phone number for you?" / "¿Cuál es su número de teléfono?"
4. Let the caller say the WHOLE phone number naturally
5. YOU then read it back in 3-3-4 groups for clarity, and confirm
6. Read back full name, phone, date, time, service. Ask "All correct?" / "¿Todo correcto?"
7. Wait for explicit "yes" / "sí" before calling bookAppointment

# CALLING bookAppointment — IMPORTANT FORMATTING

When you call bookAppointment, format parameters EXACTLY like this:
- patientName: "Albert Brown" (full name, plain text, exactly once — never doubled)
- patientPhone: "7863177581" (exactly 10 numeric digits, no dashes, spaces, words, country code, or duplicates)
- appointmentType: "Cleaning & Exam" (the service)
- requestedDateTime: ISO 8601 datetime like "2026-05-05T14:00:00-04:00"

WRONG patientPhone formats — never pass these:
- "siete ocho seis tres uno siete siete cinco ocho uno" (Spanish words)
- "+1 786 317 7581" (with country code prefix)
- "7863177581 7863177581" (doubled)
ALWAYS pass digits ONCE, as a 10-character numeric string.

# PHONE NUMBER READ-BACK

Caller says the whole number naturally. You then read back like:
- ENGLISH: "Let me read that back — seven-eight-six, three-one-seven, seven-five-eight-one. Is that right?"
- SPANISH: "Déjeme repetirlo — siete-ocho-seis, tres-uno-siete, siete-cinco-ocho-uno. ¿Es correcto?"

If wrong, ask which digit, re-read just that group, confirm.

If unsure of a digit (especially Spanish "siete vs seis", "cinco vs ocho", "tres vs trece"):
- Ask: "Disculpe, ¿fue siete o seis?" / "Sorry, was that seven or six?"
- Don't guess.

# HANDLING SILENCE

If the caller goes quiet:
- After ~5 seconds: "Are you still there?" / "¿Sigue ahí?"
- Give them another 5 seconds: "I'm not hearing anything. Take your time."
- Don't talk over silence — give them space, then prompt.

# DATA QUALITY GATES — DO NOT SKIP

Before calling bookAppointment, you MUST have:
- First AND last name
- 10-digit phone number confirmed via read-back
- Specific date and time
- Specific service

If you cannot get a confirmed 10-digit phone after TWO read-back attempts:
- ENGLISH: "I'm having trouble catching the number on this connection. Let me have someone from the office call you back."
- SPANISH: "Disculpe, no logro escuchar bien el número. Voy a pedir que alguien de la oficina le devuelva la llamada."
- Do NOT call bookAppointment.

If caller refuses name or phone, explain why we need it. If they still refuse, do NOT call bookAppointment.

# PRACTICE INFO

- Name: ${business}
- Address: ${client.business_address || 'Available on request'}

# HOURS OF OPERATION

${hoursText}

# SERVICES & PRICING

${servicesText}

# INSURANCE ACCEPTED

${insuranceText}

# FREQUENTLY ASKED QUESTIONS

${faqsText}

# URGENT / EMERGENCY HANDLING

URGENT signals: severe pain, knocked-out tooth, swelling, bleeding, can't sleep from pain, swollen jaw.

When you detect urgency:
1. Empathize: "Oh no, I'm so sorry — that sounds really painful."
2. Take action: "Let me get you in as soon as possible."
3. Get name + phone immediately
4. ${escalation ? `Forward urgent calls to: ${escalation}` : 'Mark as urgent for the office.'}

# WHAT NOT TO DO

NEVER:
- Diagnose conditions
- Quote exact treatment costs without consultation (always say "ranges from X to Y")
- Make promises the practice can't keep
- Argue with frustrated callers — empathize first
- Ask unnecessary clarifying questions when context is obvious

# CALL ENDING

End calls with: "Thank you for calling ${business}. We look forward to seeing you!" (or Spanish equivalent if call was in Spanish)`;
};

export const buildFirstMessage = (client) => {
  const business = client.business_name || 'our practice';
  const langPref = client.language_pref || 'both';
  if (langPref === 'es') return `Gracias por llamar a ${business}. ¿Cómo puedo ayudarle hoy?`;
  if (langPref === 'en') return `Thank you for calling ${business}, how can I help you today?`;
  return `Thank you for calling ${business}. Gracias por llamar a ${business}. How can I help you today?`;
};

// Push prompt + first message to Vapi assistant via REST API
export const syncAssistant = async (env, client) => {
  if (!client.vapi_assistant_id) {
    return { ok: false, error: 'No Vapi assistant ID set for this client' };
  }
  if (!env.VAPI_ORG_TOKEN) {
    return { ok: false, error: 'VAPI_ORG_TOKEN env var not set' };
  }

  const prompt = buildSystemPrompt(client);
  const firstMessage = buildFirstMessage(client);

  const payload = {
    firstMessage,
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [{ role: 'system', content: prompt }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'bookAppointment',
            description: 'Book ONLY after the patient name AND phone (group-by-group read-back confirmed) AND date/time/service are all verified.',
            parameters: {
              type: 'object',
              properties: {
                patientName: { type: 'string', description: 'Full name (first and last)' },
                patientPhone: { type: 'string', description: '10-digit US phone, verified by group-by-group read-back' },
                patientEmail: { type: 'string' },
                appointmentType: { type: 'string' },
                requestedDateTime: { type: 'string', description: 'ISO 8601 datetime' },
                notes: { type: 'string' },
              },
              required: ['patientName', 'patientPhone', 'appointmentType', 'requestedDateTime'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'sendUrgentAlert',
            description: 'Send urgent SMS to practice owner. Only for true emergencies.',
            parameters: {
              type: 'object',
              properties: {
                patientName: { type: 'string' },
                patientPhone: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['reason'],
            },
          },
        },
      ],
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'multi',
      numerals: true,
      endpointing: 400,
      smartFormat: true,
      keywords: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'cero'],
    },
    voice: {
      provider: '11labs',
      voiceId: client.voice_id || 'cgSgspJ2msm6clMCkdW9',
      model: 'eleven_multilingual_v2',
      stability: 0.65,
      similarityBoost: 0.85,
    },
    server: { url: 'https://apextoolsai.com/api/webhooks/vapi' },
    silenceTimeoutSeconds: 60,
    messagePlan: {
      idleMessages: [
        'Are you still there?',
        "I'm here whenever you're ready — take your time.",
        "Hello? Just checking you're still on the line.",
      ],
      idleTimeoutSeconds: 8,
      idleMessageMaxSpokenCount: 3,
    },
    endCallMessage: "I'm going to let you go for now. Thanks for calling — feel free to call back anytime.",
  };

  const r = await fetch(`https://api.vapi.ai/assistant/${client.vapi_assistant_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.VAPI_ORG_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  return { ok: r.ok, data, prompt_length: prompt.length };
};
