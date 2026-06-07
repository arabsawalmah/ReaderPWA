const requestLog = new Map();
const voiceCache = new Map();

const MAX_TEXT_LENGTH = 2000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;

function json(statusCode, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = process.env.ALLOWED_ORIGIN || origin;

  if (process.env.ALLOWED_ORIGIN && origin !== process.env.ALLOWED_ORIGIN) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function isRateLimited(request) {
  const ip =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);

  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  requestLog.set(ip, recent);
  return false;
}

function azureConfig() {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) return null;
  return { key, region };
}

async function fetchVoices(config) {
  const cached = voiceCache.get(config.region);
  if (cached && Date.now() - cached.createdAt < 60 * 60 * 1000) {
    return cached.voices;
  }

  const response = await fetch(
    `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
    {
      headers: {
        "Ocp-Apim-Subscription-Key": config.key,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Azure voices request failed with ${response.status}`);
  }

  const allVoices = await response.json();
  const voices = allVoices
    .filter((voice) => {
      const locales = [voice.Locale, ...(voice.SecondaryLocaleList || [])].map((locale) =>
        locale.toLowerCase(),
      );
      return (
        locales.some((locale) => locale.startsWith("ar")) &&
        locales.some((locale) => locale.startsWith("en"))
      );
    })
    .map((voice) => ({
      name: voice.ShortName,
      displayName: voice.DisplayName,
      localName: voice.LocalName,
      gender: voice.Gender,
      locale: voice.Locale,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  voiceCache.set(config.region, { createdAt: Date.now(), voices });
  return voices;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function segmentText(text) {
  const arabic = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
  const tokens =
    text.match(
      /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+|[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,:/-]\d+)*|[^\u0600-\u06ff\u0750-\u077f\u08a0-\u08ffA-Za-z\d]+/gu,
    ) || [];
  const segments = [];
  let pending = "";

  for (const token of tokens) {
    const language = arabic.test(token) ? "ar-SA" : /[A-Za-z]/.test(token) ? "en-US" : null;
    if (!language) {
      pending += token;
      continue;
    }

    const content = pending + token;
    pending = "";
    if (segments.at(-1)?.language === language) {
      segments.at(-1).text += content;
    } else {
      segments.push({ language, text: content });
    }
  }

  if (pending) {
    if (segments.length) segments.at(-1).text += pending;
    else segments.push({ language: "ar-SA", text: pending });
  }

  return segments;
}

function buildSsml(text, voice, rate) {
  const ratePercentage = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  const rateValue = `${ratePercentage >= 0 ? "+" : ""}${ratePercentage}%`;
  const content = segmentText(text)
    .map(
      (segment) =>
        `<lang xml:lang="${segment.language}">${escapeXml(segment.text)}</lang>`,
    )
    .join("");

  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-SA">',
    `<voice name="${escapeXml(voice)}">`,
    `<prosody rate="${rateValue}">${content}</prosody>`,
    "</voice>",
    "</speak>",
  ].join("");
}

export default async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return json(403, { error: "Origin is not allowed." });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (isRateLimited(request)) return json(429, { error: "Too many requests." }, cors);

  const config = azureConfig();
  if (!config) {
    return json(503, { error: "Azure Speech is not configured." }, cors);
  }

  const url = new URL(request.url);

  try {
    if (request.method === "GET" && url.searchParams.get("action") === "voices") {
      return json(200, { voices: await fetchVoices(config) }, cors);
    }

    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed." }, cors);
    }

    const { text, voice, rate = 1 } = await request.json();
    if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
      return json(400, { error: `Text must contain 1-${MAX_TEXT_LENGTH} characters.` }, cors);
    }

    const voices = await fetchVoices(config);
    if (!voices.some((item) => item.name === voice)) {
      return json(400, { error: "Unsupported multilingual voice." }, cors);
    }

    const response = await fetch(
      `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "ReaderPWA",
        },
        body: buildSsml(text.trim(), voice, Number(rate)),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      console.error("Azure synthesis failed", response.status, details);
      return json(502, { error: "Azure could not synthesize this text." }, cors);
    }

    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: "Speech service request failed." }, cors);
  }
};
