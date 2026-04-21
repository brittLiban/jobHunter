export interface LLMProvider {
  generateObject<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    fallback: T;
  }): Promise<T>;
}

export class MockLLMProvider implements LLMProvider {
  async generateObject<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    fallback: T;
  }): Promise<T> {
    void input.systemPrompt;
    void input.userPrompt;
    return input.fallback;
  }
}

export class EnvironmentLLMProvider implements LLMProvider {
  async generateObject<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    fallback: T;
  }): Promise<T> {
    const provider = createConfiguredTransport();
    if (!provider) {
      return input.fallback;
    }

    try {
      const raw = await provider.generateText(input.systemPrompt, input.userPrompt);
      const parsed = parseJsonFromText<T>(raw);
      return parsed ?? input.fallback;
    } catch {
      return input.fallback;
    }
  }
}

type Transport = {
  generateText(systemPrompt: string, userPrompt: string): Promise<string>;
};

function createConfiguredTransport(): Transport | null {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (openAiApiKey) {
    return {
      generateText: async (systemPrompt, userPrompt) => {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiApiKey}`,
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (!response.ok) {
          throw new Error(`OpenAI request failed: ${response.status}`);
        }
        const payload = await response.json();
        return String(payload.choices?.[0]?.message?.content ?? "");
      },
    };
  }

  const ollamaUrl = process.env.OLLAMA_URL;
  if (ollamaUrl) {
    return {
      generateText: async (systemPrompt, userPrompt) => {
        const response = await fetch(ollamaUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL ?? "llama3.1:8b-instruct-q4_K_M",
            format: "json",
            stream: false,
            prompt: `${systemPrompt}\n\n${userPrompt}`,
          }),
        });
        if (!response.ok) {
          throw new Error(`Ollama request failed: ${response.status}`);
        }
        const payload = await response.json();
        return String(payload.response ?? "");
      },
    };
  }

  return null;
}

function parseJsonFromText<T>(value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function createLLMProviderFromEnv(): LLMProvider {
  return new EnvironmentLLMProvider();
}
