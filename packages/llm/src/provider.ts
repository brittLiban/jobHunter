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

export type LLMConfig = {
  provider: "openai" | "ollama" | "anthropic";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
};

export class EnvironmentLLMProvider implements LLMProvider {
  private readonly config: LLMConfig | null;

  constructor(config?: LLMConfig | null) {
    this.config = config ?? null;
  }

  async generateObject<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    fallback: T;
  }): Promise<T> {
    const transport = this.config
      ? createTransportFromConfig(this.config)
      : createConfiguredTransport();

    if (!transport) {
      return input.fallback;
    }

    try {
      const raw = await transport.generateText(input.systemPrompt, input.userPrompt);
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

function createTransportFromConfig(config: LLMConfig): Transport | null {
  switch (config.provider) {
    case "anthropic":
      return buildAnthropicTransport(
        config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
        config.model ?? "claude-haiku-4-5-20251001",
      );
    case "openai":
      return buildOpenAiTransport(
        config.apiKey ?? process.env.OPENAI_API_KEY ?? "",
        config.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      );
    case "ollama":
      return buildOllamaTransport(
        normalizeOllamaUrl(config.baseUrl ?? process.env.OLLAMA_URL ?? ""),
        config.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b",
      );
    default:
      return null;
  }
}

function createConfiguredTransport(): Transport | null {
  // Ollama is the default open-source provider — checked first
  if (process.env.OLLAMA_URL) {
    return buildOllamaTransport(
      normalizeOllamaUrl(process.env.OLLAMA_URL),
      process.env.OLLAMA_MODEL ?? "qwen2.5:7b",
    );
  }

  if (process.env.OPENAI_API_KEY) {
    return buildOpenAiTransport(
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    );
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return buildAnthropicTransport(
      process.env.ANTHROPIC_API_KEY,
      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    );
  }

  return null;
}

function buildAnthropicTransport(apiKey: string, model: string): Transport {
  return {
    generateText: async (systemPrompt, userPrompt) => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Anthropic request failed: ${response.status}`);
      }
      const payload = await response.json();
      return String(payload.content?.[0]?.text ?? "");
    },
  };
}

function buildOpenAiTransport(apiKey: string, model: string): Transport {
  return {
    generateText: async (systemPrompt, userPrompt) => {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
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

function buildOllamaTransport(ollamaGenerateUrl: string, model: string): Transport {
  return {
    generateText: async (systemPrompt, userPrompt) => {
      const response = await fetch(ollamaGenerateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
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

/**
 * Normalizes an Ollama base URL to the /api/generate endpoint.
 * If the user provides http://localhost:11434 we append /api/generate.
 * If they already provide the full path we use it as-is.
 */
function normalizeOllamaUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "http://localhost:11434/api/generate";
  }
  if (trimmed.includes("/api/generate") || trimmed.includes("/api/chat")) {
    return trimmed;
  }
  return trimmed.replace(/\/$/, "") + "/api/generate";
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
  return new EnvironmentLLMProvider(null);
}

export function createLLMProviderFromConfig(config: LLMConfig | null | undefined): LLMProvider {
  if (!config || !config.provider) {
    return createLLMProviderFromEnv();
  }
  return new EnvironmentLLMProvider(config);
}

export function detectConfiguredProvider(): "anthropic" | "openai" | "ollama" | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  if (process.env.OLLAMA_URL) {
    return "ollama";
  }
  return null;
}
