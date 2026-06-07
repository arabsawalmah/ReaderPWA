import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const arabicPattern = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const englishPattern = /[A-Za-z]/;

function segmentText(text) {
  const tokens =
    text.match(
      /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+|[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,:/-]\d+)*|[^\u0600-\u06ff\u0750-\u077f\u08a0-\u08ffA-Za-z\d]+/gu,
    ) || [];
  const segments = [];
  let pending = "";

  for (const token of tokens) {
    const hasArabic = arabicPattern.test(token);
    const hasEnglish = englishPattern.test(token);

    if (!hasArabic && !hasEnglish) {
      pending += token;
      continue;
    }

    const language = hasArabic ? "ar" : "en";
    const content = pending + token;
    pending = "";

    if (segments.at(-1)?.language === language) {
      segments.at(-1).text += content;
    } else {
      segments.push({ language, text: content });
    }
  }

  if (pending) {
    if (segments.length) {
      segments.at(-1).text += pending;
    } else {
      segments.push({ language: "ar", text: pending });
    }
  }

  return segments.filter((segment) => segment.text.trim());
}

function voiceLabel(voice) {
  return `${voice.name} (${voice.lang})${voice.default ? " — افتراضي" : ""}`;
}

export default function App() {
  const [text, setText] = useState(() => localStorage.getItem("reader-text") || "");
  const [voices, setVoices] = useState([]);
  const [arabicVoiceUri, setArabicVoiceUri] = useState("");
  const [englishVoiceUri, setEnglishVoiceUri] = useState("");
  const [rate, setRate] = useState(() => {
    const savedRate = Number(localStorage.getItem("reader-rate"));
    return savedRate >= 0.5 && savedRate <= 1.5 ? savedRate : 1;
  });
  const [status, setStatus] = useState("idle");
  const textareaRef = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(0);
  const sessionRef = useRef(0);

  const supported =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const segments = useMemo(() => segmentText(text), [text]);
  const arabicVoices = useMemo(
    () => voices.filter((voice) => voice.lang.toLowerCase().startsWith("ar")),
    [voices],
  );
  const englishVoices = useMemo(
    () => voices.filter((voice) => voice.lang.toLowerCase().startsWith("en")),
    [voices],
  );

  useEffect(() => {
    localStorage.setItem("reader-text", text);
  }, [text]);

  useEffect(() => {
    localStorage.setItem("reader-rate", String(rate));
  }, [rate]);

  useEffect(() => {
    if (!supported) return undefined;

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);

      setArabicVoiceUri((current) => {
        if (availableVoices.some((voice) => voice.voiceURI === current)) return current;
        return (
          availableVoices.find((voice) => voice.lang.toLowerCase() === "ar-sa")
            ?.voiceURI ||
          availableVoices.find((voice) => voice.lang.toLowerCase().startsWith("ar"))
            ?.voiceURI ||
          ""
        );
      });

      setEnglishVoiceUri((current) => {
        if (availableVoices.some((voice) => voice.voiceURI === current)) return current;
        return (
          availableVoices.find((voice) => voice.lang.toLowerCase() === "en-us")
            ?.voiceURI ||
          availableVoices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
            ?.voiceURI ||
          ""
        );
      });
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      sessionRef.current += 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, [supported]);

  const finishReading = useCallback(() => {
    queueRef.current = [];
    indexRef.current = 0;
    setStatus("idle");
  }, []);

  const speakNext = useCallback(
    function speakNext(activeSession) {
      if (activeSession !== sessionRef.current) return;
      const segment = queueRef.current[indexRef.current];

      if (!segment) {
        finishReading();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(segment.text);
      const voiceUri = segment.language === "ar" ? arabicVoiceUri : englishVoiceUri;
      const voice = voices.find((item) => item.voiceURI === voiceUri);

      utterance.lang = voice?.lang || (segment.language === "ar" ? "ar-SA" : "en-US");
      utterance.voice = voice || null;
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.onend = () => {
        if (activeSession !== sessionRef.current) return;
        indexRef.current += 1;
        speakNext(activeSession);
      };
      utterance.onerror = (event) => {
        if (["canceled", "interrupted"].includes(event.error)) return;
        indexRef.current += 1;
        speakNext(activeSession);
      };

      window.speechSynthesis.speak(utterance);
    },
    [arabicVoiceUri, englishVoiceUri, finishReading, rate, voices],
  );

  function startReading() {
    if (!text.trim()) {
      textareaRef.current?.focus();
      setStatus("empty");
      return;
    }

    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    queueRef.current = segments;
    indexRef.current = 0;
    setStatus("speaking");
    speakNext(sessionRef.current);
  }

  function togglePause() {
    if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("speaking");
      return;
    }

    if (status === "speaking") {
      window.speechSynthesis.pause();
      setStatus("paused");
    }
  }

  function stopReading() {
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    finishReading();
  }

  function clearText() {
    stopReading();
    setText("");
    textareaRef.current?.focus();
  }

  const isReading = status === "speaking" || status === "paused";
  const statusLabel = {
    idle: "جاهز",
    empty: "اكتب نصاً أولاً",
    speaking: "جاري القراءة",
    paused: "متوقف مؤقتاً",
  }[status];

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">قارئ صوتي</p>
          <h1>اقرأ أي نص بصوت واضح</h1>
          <p className="subtitle">العربية والإنجليزية والأرقام في النص نفسه.</p>
        </div>
        <div className={`status ${status}`} role="status" aria-live="polite">
          <span className="status-dot" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <section className="editor-section" aria-labelledby="text-label">
        <div className="editor-heading">
          <label id="text-label" htmlFor="text">
            النص
          </label>
          <button
            className="icon-button"
            type="button"
            title="مسح النص"
            aria-label="مسح النص"
            onClick={clearText}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <textarea
          ref={textareaRef}
          id="text"
          dir="auto"
          spellCheck="true"
          placeholder="مثال: مرحباً، موعدنا tomorrow at 5:30 مساءً."
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="text-meta">
          <span>{text.length} حرف</span>
          <span>{segments.length} مقطع صوتي</span>
        </div>
      </section>

      <section className="settings" aria-label="إعدادات الصوت">
        <div className="field">
          <label htmlFor="arabicVoice">الصوت العربي</label>
          <select
            id="arabicVoice"
            value={arabicVoiceUri}
            disabled={!arabicVoices.length}
            onChange={(event) => setArabicVoiceUri(event.target.value)}
          >
            {!arabicVoices.length && <option value="">سيستخدم المتصفح الصوت المتاح</option>}
            {arabicVoices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voiceLabel(voice)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="englishVoice">الصوت الإنجليزي</label>
          <select
            id="englishVoice"
            value={englishVoiceUri}
            disabled={!englishVoices.length}
            onChange={(event) => setEnglishVoiceUri(event.target.value)}
          >
            {!englishVoices.length && <option value="">سيستخدم المتصفح الصوت المتاح</option>}
            {englishVoices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voiceLabel(voice)}
              </option>
            ))}
          </select>
        </div>

        <div className="field rate-field">
          <div className="range-heading">
            <label htmlFor="rate">السرعة</label>
            <output htmlFor="rate">{rate.toFixed(1)}×</output>
          </div>
          <input
            id="rate"
            type="range"
            min="0.5"
            max="1.5"
            value={rate}
            step="0.1"
            onChange={(event) => setRate(Number(event.target.value))}
          />
        </div>
      </section>

      <section className="controls" aria-label="أدوات التشغيل">
        <button
          className="primary-button"
          type="button"
          disabled={!supported || status === "speaking"}
          onClick={startReading}
        >
          <span className="button-icon" aria-hidden="true">▶</span>
          <span>ابدأ القراءة</span>
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!isReading}
          onClick={togglePause}
        >
          <span className="button-icon" aria-hidden="true">
            {status === "paused" ? "▶" : "Ⅱ"}
          </span>
          <span>{status === "paused" ? "متابعة" : "إيقاف مؤقت"}</span>
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!isReading}
          onClick={stopReading}
        >
          <span className="button-icon" aria-hidden="true">■</span>
          <span>إيقاف</span>
        </button>
      </section>

      {!supported && (
        <p className="compatibility">
          المتصفح الحالي لا يدعم القراءة الصوتية. استخدم Chrome أو Edge بإصدار حديث.
        </p>
      )}
    </main>
  );
}
