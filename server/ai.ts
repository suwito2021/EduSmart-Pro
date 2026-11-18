import { GoogleGenAI, Type } from '@google/genai';

export type AiProvider = 'gemini' | 'claude' | 'openai' | 'openrouter';
export type QuestionType = 'PG' | 'PGK' | 'BS' | 'MENJODOHKAN' | 'URAIAN';

export interface GeneratedQuestionDraft {
  type: QuestionType;
  prompt: string;
  options: any;
  answerKey: any;
  points: number;
  explanation: string;
  difficultyTarget: string;
}

export interface GenerateQuestionsInput {
  provider: AiProvider;
  model?: string;
  apiKey?: string;
  subject: string;
  gradeLevel: string;
  topic: string;
  questionTypes: QuestionType[];
  count: number;
  difficulty: 'Mudah' | 'Sedang' | 'Sukar' | 'Campuran';
  additionalInstructions?: string;
}

function buildSystemInstruction(): string {
  return `Anda adalah pakar penyusun soal asesmen Kurikulum Merdeka Indonesia yang presisi dan pedagogis.
Buatlah soal berkualitas tinggi dalam Bahasa Indonesia (atau sesuai mata pelajaran seperti Bahasa Inggris / Bahasa Arab jika diminta).
KELIMA TIPE SOAL harus mengikuti struktur JSON tepat berikut:
1. "PG" (Pilihan Ganda):
   - options: array of 5 objects [{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."},{"key":"E","text":"..."}]
   - answerKey: string salah satu "A"|"B"|"C"|"D"|"E"
2. "PGK" (Pilihan Ganda Kompleks - lebih dari 1 jawaban benar):
   - options: array of 5 objects [{"key":"A","text":"..."}, ...]
   - answerKey: array of strings misal ["A","C","D"]
3. "BS" (Benar / Salah majemuk):
   - options: {"statements": ["Pernyataan 1...", "Pernyataan 2...", "Pernyataan 3..."]}
   - answerKey: array of "Benar"|"Salah" sesuai panjang statements misal ["Benar","Salah","Benar"]
4. "MENJODOHKAN" (Matching):
   - options: {"left": ["Premis 1", "Premis 2", "Premis 3"], "right": ["Pasangan A", "Pasangan B", "Pasangan C", "Pengecoh D"]}
   - answerKey: object mapping setiap item left ke jawaban right yang benar misal {"Premis 1":"Pasangan B","Premis 2":"Pasangan A","Premis 3":"Pasangan C"}
5. "URAIAN" (Esai):
   - options: {"rubric": "Kriteria penskoran lengkap...", "maxWords": 250}
   - answerKey: {"modelAnswer": "Jawaban ideal lengkap...", "keywords": ["kata kunci 1", "kata kunci 2", "kata kunci 3"]}

Kembalikan HANYA JSON valid berupa array of objects dengan properti:
type, prompt, options, answerKey, points (integer 5..25), explanation, difficultyTarget ("Mudah"|"Sedang"|"Sukar").`;
}

function buildUserPrompt(input: GenerateQuestionsInput): string {
  return `Buat tepat ${input.count} butir soal untuk:
- Mata Pelajaran: ${input.subject}
- Kelas/Fase: ${input.gradeLevel}
- Topik / Tujuan Pembelajaran: ${input.topic}
- Tipe soal yang diminta (distribusikan secara merata): ${input.questionTypes.join(', ')}
- Tingkat kesulitan: ${input.difficulty}
${input.additionalInstructions ? `- Catatan tambahan guru: ${input.additionalInstructions}` : ''}

Pastikan setiap soal memiliki pembahasan ("explanation") yang jelas dan tidak ambigu. Kembalikan hanya JSON array.`;
}

function extractJsonArray(raw: string): GeneratedQuestionDraft[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  const jsonStr = start !== -1 && end !== -1 ? candidate.slice(start, end + 1) : candidate;
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error('Respons AI tidak berbentuk daftar soal JSON.');
  }
  return parsed.map((item: any) => ({
    type: (['PG', 'PGK', 'BS', 'MENJODOHKAN', 'URAIAN'].includes(item.type) ? item.type : 'PG') as QuestionType,
    prompt: String(item.prompt || ''),
    options: item.options ?? [],
    answerKey: item.answerKey ?? '',
    points: Number(item.points) > 0 ? Number(item.points) : 10,
    explanation: String(item.explanation || ''),
    difficultyTarget: String(item.difficultyTarget || 'Sedang'),
  }));
}

export async function generateQuestionsWithProvider(
  input: GenerateQuestionsInput
): Promise<{ questions: GeneratedQuestionDraft[]; providerUsed: string; modelUsed: string }> {
  const systemInstruction = buildSystemInstruction();
  const userPrompt = buildUserPrompt(input);

  if (input.provider === 'gemini') {
    const key = input.apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('Kunci API Gemini tidak tersedia di server maupun pengaturan terenkripsi.');
    }
    const modelName = input.model || 'gemini-4-hydrogen';
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    const response = await ai.models.generateContent({
      model: modelName,
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              prompt: { type: Type.STRING },
              options: { type: Type.STRING, description: 'JSON-encoded options object or array' },
              answerKey: { type: Type.STRING, description: 'JSON-encoded answerKey' },
              points: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
              difficultyTarget: { type: Type.STRING },
            },
          },
        },
      },
    });

    const text = (response.text ?? '[]').trim();
    const rawItems = JSON.parse(text);
    const normalized: GeneratedQuestionDraft[] = (Array.isArray(rawItems) ? rawItems : []).map((it: any) => {
      let opts = it.options;
      if (typeof opts === 'string') {
        try { opts = JSON.parse(opts); } catch { /* keep string */ }
      }
      let ans = it.answerKey;
      if (typeof ans === 'string' && (ans.startsWith('[') || ans.startsWith('{') || ans.startsWith('"'))) {
        try { ans = JSON.parse(ans); } catch { /* keep string */ }
      }
      return {
        type: (['PG', 'PGK', 'BS', 'MENJODOHKAN', 'URAIAN'].includes(it.type) ? it.type : 'PG') as QuestionType,
        prompt: String(it.prompt || ''),
        options: opts,
        answerKey: ans,
        points: Number(it.points) > 0 ? Number(it.points) : 10,
        explanation: String(it.explanation || ''),
        difficultyTarget: String(it.difficultyTarget || 'Sedang'),
      };
    });
    return { questions: normalized, providerUsed: 'Gemini', modelUsed: modelName };
  }

  if (input.provider === 'claude') {
    if (!input.apiKey) {
      throw new Error('Kunci API Claude belum disimpan. Silakan simpan kunci Claude terenkripsi terlebih dahulu.');
    }
    const modelName = input.model || 'claude-3-5-sonnet-latest';
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        system: systemInstruction,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Anthropic Claude error (${resp.status}): ${errBody.slice(0, 220)}`);
    }
    const data = await resp.json() as any;
    const text = data?.content?.[0]?.text || '[]';
    return { questions: extractJsonArray(text), providerUsed: 'Claude', modelUsed: modelName };
  }

  if (input.provider === 'openai') {
    if (!input.apiKey) {
      throw new Error('Kunci API OpenAI belum disimpan. Silakan simpan kunci OpenAI terenkripsi terlebih dahulu.');
    }
    const modelName = input.model || 'gpt-4o-mini';
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`OpenAI error (${resp.status}): ${errBody.slice(0, 220)}`);
    }
    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content || '[]';
    return { questions: extractJsonArray(text), providerUsed: 'OpenAI', modelUsed: modelName };
  }

  if (input.provider === 'openrouter') {
    if (!input.apiKey) {
      throw new Error('Kunci API OpenRouter belum disimpan. Silakan simpan kunci OpenRouter terenkripsi terlebih dahulu.');
    }
    const modelName = input.model || 'google/gemini-2.5-flash';
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'Lentera Eduka CBT',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`OpenRouter error (${resp.status}): ${errBody.slice(0, 220)}`);
    }
    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content || '[]';
    return { questions: extractJsonArray(text), providerUsed: 'OpenRouter', modelUsed: modelName };
  }

  throw new Error('Provider AI tidak dikenal.');
}
