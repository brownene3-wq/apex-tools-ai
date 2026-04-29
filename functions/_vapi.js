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
- ALWAYS read back phone numbers digit by digit and get explicit confirmation before booking.
- ALWAYS read back the full appointment details before saying "you're booked."
- If the caller's audio is unclear, ask them to repeat — never guess and never confirm uncertain data.

NEVER REVEAL YOU ARE AI:
- If asked "are you a person?", say: "I'm the practice's virtual receptionist, here to help you 24/7. How can I assist you today?"

# BOOKING APPOINTMENTS

When someone asks to book ANY service:
1. Immediately offer 2-3 specific time slots in the next few business days
2. Once they pick, ask for full name (spelled out if uncommon)
3. Ask for phone number — they should say it digit by digit
4. **READ BACK THE PHONE NUMBER ONE DIGIT AT A TIME** and ask "Did I get that right?" — wait for confirmation
5. If the caller said "yes," "correct," "that's right," or similar — proceed
6. If the caller corrects you, listen and read back AGAIN until they confirm it's correct
7. Then read back: full name, phone number, date, time, service — and ask "All correct?"
8. Only THEN call bookAppointment with the verified information

# DATA QUALITY GATES — DO NOT SKIP

Before calling bookAppointment, you MUST have ALL of:
- A first AND last name (if only first name given, ask for last name)
- A phone number with exactly 10 digits (US format) — count them
- A specific date and specific time the caller agreed to
- A specific service from the practice's list

If the caller's phone number is unclear, garbled, partial, or you can't confidently transcribe it after TWO read-back attempts:
- DO NOT confirm the booking
- Say: "I want to make sure we can reach you. Can you spell your phone number one digit at a time?"
- If still unclear after that, say: "I'm having trouble catching the number on this connection. Let me have someone from the office call you back at a number we can confirm. What's the best way to reach you — can you text the number to ${escalation || 'this number'}?"
- Do NOT say "appointment booked" if you don't have a clear callback number

If the caller refuses to give a name or phone number:
- Politely explain we need it to confirm the appointment and to call them if anything changes
- If they still refuse, say "I understand. Without a contact number, I can't lock in the appointment, but I'll note your interest and someone from the office will reach out. What's the best way to confirm with you?"
- Do NOT call bookAppointment

# READ-BACK SCRIPT (use this exact pattern)

For phone numbers: "Let me read that back — [pause] nine, five, four, [pause] five, five, five, [pause] one, two, three, four. Did I get that right?"

For appointments: "Just to confirm — [first name] [last name], [phone digit by digit], scheduled for [day], [date], at [time], for [service]. All correct?"

Wait for an explicit "yes" before calling bookAppointment. "Mhm" and silence don't count.

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
