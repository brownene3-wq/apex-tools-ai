// Vapi API integration — build system prompt from client config and sync to assistant.

const dayKeys = ['mon','tue','wed','thu','fri','sat','sun'];
const dayNames = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };

// Bump this whenever buildSystemPrompt() or syncAssistant payload changes.
// The webhook checks each client's last_synced_prompt_version and auto-runs
// syncAssistant before processing a call when this number is higher.
export const PROMPT_VERSION = 17;

// Lazy-sync helper: if client.last_synced_prompt_version < PROMPT_VERSION,
// re-push the assistant config to Vapi and bump the stored version.
export const ensureAssistantSynced = async (env, client) => {
  if (!client?.vapi_assistant_id) return { ok: false, skipped: true, reason: 'no assistant' };
  const stored = client.last_synced_prompt_version || 0;
  if (stored >= PROMPT_VERSION) return { ok: true, skipped: true, version: stored };
  const r = await syncAssistant(env, client);
  if (r.ok) {
    try {
      await env.DB.prepare('UPDATE clients SET last_synced_prompt_version = ?, updated_at = ? WHERE id = ?')
        .bind(PROMPT_VERSION, Date.now(), client.id).run();
    } catch (e) { console.error('[ensureAssistantSynced] could not store version', e); }
  }
  return { ok: r.ok, version: PROMPT_VERSION, error: r.error || r.data?.message };
};

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

# PHONE NUMBER PACING IN BOTH READBACKS — SAME PAUSE EVERY TIME

The phone number MUST be spoken in 3-3-4 grouped format BOTH times — the initial
verification readback (step 5) AND the final summary readback (step 6). Same
pacing both times so it sounds natural, not robotic.

CORRECT spoken format (use this EXACT comma + space pattern so ElevenLabs pauses
between groups):
- ENGLISH: "seven eight six, three one seven, seven five eight one"
- SPANISH: "siete ocho seis, tres uno siete, siete cinco ocho uno"

WRONG — never produce these formats (they read as one continuous run-on with no
pauses):
- "7863177581"
- "siete ocho seis tres uno siete siete cinco ocho uno"  (no commas)
- "(786) 317-7581"  (the AI cannot voice parentheses well)

When you do the final "Para confirmar / To confirm" summary in step 6, format it like:
- ENGLISH: "To confirm — Albert Brown, phone seven eight six, three one seven, seven five eight one, urgent visit today at three. All correct?"
- SPANISH: "Para confirmar — Albert Brown, teléfono siete ocho seis, tres uno siete, siete cinco ocho uno, cita urgente hoy a las tres. ¿Todo correcto?"

The COMMAS between digit groups are mandatory. They're what makes ElevenLabs
pause for ~250ms between groups. Without them the number sounds robotic in the
summary even though it sounded fine in the first readback.

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

# PHONE NUMBER READ-BACK — CRITICAL TURN RULES

When you ask for the phone number, STAY ABSOLUTELY SILENT until the caller has said all 10 digits.
Do not respond to a period, comma, or pause. Periods and commas mid-number are transcription
artifacts, NOT signals that the caller is done. Count digits, not punctuation.
A phone number has 2-3 natural pauses inside it ("786 ... 317 ... 7581"). Those pauses
are NOT the caller finishing — they are breath/thinking pauses inside one continuous answer.

NEVER do any of these while the caller is reciting their number:
- Do NOT say "continúe", "sigue", "y el resto", "and the rest", "faltan dígitos", "missing digits".
- Do NOT echo back partial digits.
- Do NOT prompt them to keep going.
- Do NOT say anything at all until you count at least 10 spoken digits OR they explicitly stop and ask you something.

If the caller pauses for more than ~3 seconds AFTER you have counted fewer than 10 digits, then
(and only then) gently say: "Take your time — I'm listening." / "Tómese su tiempo, lo escucho."

Once you have heard all 10 digits, read them back grouped 3-3-4:
- ENGLISH: "Let me read that back — seven-eight-six, three-one-seven, seven-five-eight-one. Is that right?"
- SPANISH: "Déjeme repetirlo — siete-ocho-seis, tres-uno-siete, siete-cinco-ocho-uno. ¿Es correcto?"

If wrong, ask which group is wrong, re-read just that group, confirm.

If unsure of a digit (Spanish "siete vs seis", "cinco vs ocho", "tres vs trece"):
- Ask once: "Disculpe, ¿fue siete o seis?" / "Sorry, was that seven or six?"
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

# URGENT / EMERGENCY HANDLING — CRITICAL

URGENT signals: severe pain, knocked-out tooth, swelling, bleeding, can't sleep from pain, swollen jaw.

When you detect urgency, follow these EXACT steps in order:
1. Empathize: "Oh no, I'm so sorry — that sounds really painful." / "Lo siento mucho — eso suena muy doloroso."
2. Take action: "Let me get you in as soon as possible." / "Lo voy a atender lo antes posible."
3. Offer 2 specific times — the soonest today AND a backup tomorrow morning. Example: "Tengo hoy a las tres de la tarde, o mañana a las diez de la mañana. ¿Cuál le conviene más?" / "I have today at three pm, or tomorrow at ten am. Which works better?"
4. Get full name. Confirm.
5. Get 10-digit phone. Read back in 3-3-4 groups. Confirm.
6. Confirm the time the caller wants ("¿Hoy a las 3 de la tarde, está bien?" / "Today at 3pm, does that work?").
7. Once they say yes — call sendUrgentAlert with ALL of these parameters:
   - patientName: "Albert Brown" (full name)
   - patientPhone: "7863177581" (10 digits, no spaces/dashes/words)
   - reason: "severe tooth pain and bleeding" (brief description)
   - requestedDateTime: "2026-04-29T15:00:00-04:00" (ISO 8601 — the time you confirmed in step 6)
   - appointmentType: "Urgent exam" or similar
8. After sendUrgentAlert returns success, deliver the closing line it gives you and end the call.

IMPORTANT: sendUrgentAlert BOTH notifies the practice AND records the appointment in their dashboard. Do NOT also call bookAppointment for urgent calls — that would create a duplicate.

${escalation ? `(Practice escalation phone configured: ${escalation})` : '(No escalation phone — only email notification will fire.)'}

# WHAT NOT TO DO

NEVER:
- Diagnose conditions
- Quote exact treatment costs without consultation (always say "ranges from X to Y")
- Make promises the practice can't keep
- Argue with frustrated callers — empathize first
- Ask unnecessary clarifying questions when context is obvious

# CALL ENDING

End calls with ONE language only — match the call language, do NOT say both:
- If call was in English: "Thank you for calling ${business}. We look forward to seeing you!"
- If call was in Spanish: "Gracias por llamar a ${business}. Lo esperamos."
NEVER say both lines back to back. Pick the right one for the call language and stop.`;
};

export const buildFirstMessage = (client) => {
  const business = client.business_name || 'our practice';
  const langPref = client.language_pref || 'both';
  if (langPref === 'es') return `Gracias por llamar a ${business}. ¿Cómo puedo ayudarle hoy?`;
  if (langPref === 'en') return `Thank you for calling ${business}, how can I help you today?`;
  return `Thank you for calling ${business}, gracias por llamar a ${business} — how can I help you today? ¿En qué le puedo ayudar?`;
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
            description: 'For true emergencies. Notifies the practice AND records the appointment in their dashboard automatically. Pass patientName + patientPhone (10 digits) + requestedDateTime so the office sees the urgent appointment immediately. Do NOT also call bookAppointment — sendUrgentAlert handles both notification and booking.',
            parameters: {
              type: 'object',
              properties: {
                patientName: { type: 'string', description: 'Full name (first and last)' },
                patientPhone: { type: 'string', description: '10-digit US phone, verified by group-by-group read-back' },
                reason: { type: 'string', description: 'Brief description of the emergency (pain, bleeding, swelling, etc.)' },
                requestedDateTime: { type: 'string', description: 'ISO 8601 datetime when the patient should be seen — usually ASAP/now' },
                appointmentType: { type: 'string', description: 'Type of urgent visit (emergency exam, urgent extraction, etc.)' },
              },
              required: ['reason', 'patientName', 'patientPhone'],
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
      // Vapi caps endpointing at 500ms. We compensate for natural intra-number
      // pauses with startSpeakingPlan.waitSeconds + smart-endpointing livekit below.
      endpointing: 500,
      // smartFormat OFF: it was inserting periods mid-utterance after spoken digit
      // groups (e.g. "Siete ocho seis." after the area code), which Vapi treated as
      // a hard turn boundary. AI interrupted the caller. Punctuation isn't needed
      // here — the prompt drives the digit-group readback explicitly.
      smartFormat: false,
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
    // Wait longer before AI grabs the turn — important for phone numbers and names.
    startSpeakingPlan: {
      // Long wait + lenient livekit smart endpointing to cover natural intra-number
      // pauses ("786 ... 317 ... 7581"). Smart endpointing's x is the prob the user
      // is done; waitFunction outputs ms to wait. Even at high probability we wait
      // ~250ms; at low probability up to 12s — so the AI hesitates rather than
      // talking over a continuing number.
      waitSeconds: 2.5,
      smartEndpointingPlan: { provider: 'livekit', waitFunction: '250 + 12000 * x' },
    },
    // Don't let small interjections from the AI cut off the caller mid-sentence.
    stopSpeakingPlan: {
      numWords: 3,
      voiceSeconds: 0.5,
      backoffSeconds: 1.0,
    },
    silenceTimeoutSeconds: 90,
    messagePlan: {
      idleMessages: [
        'Are you still there?',
        "I'm here whenever you're ready — take your time.",
        "Hello? Just checking you're still on the line.",
      ],
      idleTimeoutSeconds: 12,
      idleMessageMaxSpokenCount: 3,
    },
    // endCallMessage intentionally omitted — Vapi appends it in static English regardless
    // of call language, leaking English into Spanish calls. AI's own closing line handles this.
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
