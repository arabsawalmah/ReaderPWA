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

function wordLengthAt(text, start) {
  const match = text.slice(start).match(/^[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/u);
  return match?.[0].length || 1;
}

function trackingParts(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu)].map(
      (match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      }),
  );
}

const speechApiUrl = import.meta.env.VITE_SPEECH_API_URL || "/api/speech";
const cloudSpeechEnabled = import.meta.env.VITE_ENABLE_CLOUD_SPEECH === "true";

export function App() {
  const [text, setText] = useState(() => localStorage.getItem("reader-text") || "");
  const [backgroundImage, setBackgroundImage] = useState(
      () => localStorage.getItem("reader-background") || "",
  );
  const [voices, setVoices] = useState([]);
  const [arabicVoiceUri, setArabicVoiceUri] = useState("");
  const [englishVoiceUri, setEnglishVoiceUri] = useState("");
  const [unifiedVoiceUri, setUnifiedVoiceUri] = useState(
      () => localStorage.getItem("reader-unified-voice") || "",
  );
  const [useUnifiedVoice, setUseUnifiedVoice] = useState(
      () => localStorage.getItem("reader-use-unified-voice") !== "false",
  );
  const [speechSource, setSpeechSource] = useState(
      () =>
          cloudSpeechEnabled && localStorage.getItem("reader-speech-source") === "cloud"
              ? "cloud"
              : "device",
  );
  const [cloudVoices, setCloudVoices] = useState([]);
  const [cloudVoice, setCloudVoice] = useState(
      () => localStorage.getItem("reader-cloud-voice") || "",
  );
  const [cloudError, setCloudError] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [readingContent, setReadingContent] = useState("");
  const [activeWord, setActiveWord] = useState(null);
  const [rate, setRate] = useState(() => {
    const savedRate = Number(localStorage.getItem("reader-rate"));
    return savedRate >= 0.5 && savedRate <= 4 ? savedRate : 1;
  });
  const [status, setStatus] = useState("idle");
  const textareaRef = useRef(null);
  const backgroundInputRef = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(0);
  const sessionRef = useRef(0);
  const audioRef = useRef(null);
  const audioUrlRef = useRef("");
  const trackingRef = useRef(null);

  const supported =
      "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const segments = useMemo(() => segmentText(text), [text]);
  const selectedText = useMemo(
      () => text.slice(selection.start, selection.end),
      [selection.end, selection.start, text],
  );
  const readingParts = useMemo(() => trackingParts(readingContent), [readingContent]);
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
    localStorage.setItem("reader-use-unified-voice", String(useUnifiedVoice));
  }, [useUnifiedVoice]);

  useEffect(() => {
    if (unifiedVoiceUri) {
      localStorage.setItem("reader-unified-voice", unifiedVoiceUri);
    }
  }, [unifiedVoiceUri]);

  useEffect(() => {
    localStorage.setItem("reader-speech-source", speechSource);
  }, [speechSource]);

  useEffect(() => {
    if (cloudVoice) localStorage.setItem("reader-cloud-voice", cloudVoice);
  }, [cloudVoice]);

  useEffect(() => {
    if (speechSource !== "cloud" || cloudVoices.length) return;

    const controller = new AbortController();
    setCloudError("");

    fetch(`${speechApiUrl}?action=voices`, { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "تعذر تحميل أصوات Azure");
          setCloudVoices(data.voices || []);
          setCloudVoice((current) =>
              data.voices?.some((voice) => voice.name === current)
                  ? current
                  : data.voices?.[0]?.name || "",
          );
        })
        .catch((error) => {
          if (error.name !== "AbortError") setCloudError(error.message);
        });

    return () => controller.abort();
  }, [cloudVoices.length, speechSource]);

  useEffect(() => {
    const defaultBackground = `${import.meta.env.BASE_URL}nature-background.jpg`;
    document.body.style.backgroundImage = `url("${
        backgroundImage || defaultBackground
    }")`;
  }, [backgroundImage]);

  useEffect(() => {
    trackingRef.current
        ?.querySelector(".tracking-word.active")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeWord]);

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

      setUnifiedVoiceUri((current) => {
        if (availableVoices.some((voice) => voice.voiceURI === current)) return current;
        return (
            availableVoices.find((voice) => voice.lang.toLowerCase() === "ar-sa")
                ?.voiceURI ||
            availableVoices.find((voice) => voice.lang.toLowerCase().startsWith("ar"))
                ?.voiceURI ||
            availableVoices[0]?.voiceURI ||
            ""
        );
      });
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      sessionRef.current += 1;
      window.speechSynthesis.cancel();
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, [supported]);

  const finishReading = useCallback(() => {
    queueRef.current = [];
    indexRef.current = 0;
    setActiveWord(null);
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
        const voiceUri = useUnifiedVoice
            ? unifiedVoiceUri
            : segment.language === "ar"
                ? arabicVoiceUri
                : englishVoiceUri;
        const voice = voices.find((item) => item.voiceURI === voiceUri);

        utterance.lang = segment.language === "ar" ? "ar-SA" : "en-US";
        utterance.voice = voice || null;
        utterance.rate = rate;
        utterance.pitch = 1;
        utterance.onstart = () => {
          const start = segment.offset;
          setActiveWord({
            start,
            end: start + wordLengthAt(readingContent, start),
          });
        };
        utterance.onboundary = (event) => {
          if (event.name && event.name !== "word") return;
          const start = segment.offset + event.charIndex;
          setActiveWord({
            start,
            end: start + (event.charLength || wordLengthAt(readingContent, start)),
          });
        };
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
      [
        arabicVoiceUri,
        englishVoiceUri,
        finishReading,
        rate,
        readingContent,
        unifiedVoiceUri,
        useUnifiedVoice,
        voices,
      ],
  );

  async function startReading(readingText) {
    const content = readingText.trim();

    if (!content) {
      textareaRef.current?.focus();
      setStatus(readingText === selectedText ? "selection-empty" : "empty");
      return;
    }

    setReadingContent(content);
    setActiveWord(null);

    if (speechSource === "cloud") {
      if (!cloudVoice) {
        setCloudError("اختر صوت Azure أولاً");
        return;
      }

      stopReading();
      setStatus("loading");
      setCloudError("");

      try {
        const response = await fetch(speechApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: content, voice: cloudVoice, rate }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "تعذر إنشاء الصوت");
        }

        const blob = await response.blob();
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = URL.createObjectURL(blob);

        const audio = new Audio(audioUrlRef.current);
        audioRef.current = audio;
        audio.onended = finishReading;
        audio.onerror = () => {
          setCloudError("تعذر تشغيل الملف الصوتي");
          finishReading();
        };
        await audio.play();
        setStatus("speaking");
      } catch (error) {
        setCloudError(error.message);
        finishReading();
      }
      return;
    }

    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    let offset = 0;
    queueRef.current = segmentText(content).map((segment) => {
      const item = { ...segment, offset };
      offset += segment.text.length;
      return item;
    });
    indexRef.current = 0;
    setStatus("speaking");
    speakNext(sessionRef.current);
  }

  function togglePause() {
    if (speechSource === "cloud" && audioRef.current) {
      if (status === "paused") {
        audioRef.current.play();
        setStatus("speaking");
      } else if (status === "speaking") {
        audioRef.current.pause();
        setStatus("paused");
      }
      return;
    }

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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    finishReading();
  }

  function clearText() {
    stopReading();
    setText("");
    setSelection({ start: 0, end: 0 });
    textareaRef.current?.focus();
  }

  function updateSelection(event) {
    setSelection({
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
    });
  }

  function selectAllText() {
    textareaRef.current?.focus();
    textareaRef.current?.select();
    setSelection({ start: 0, end: text.length });
  }

  function changeBackground(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      const maxDimension = 1920;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      try {
        localStorage.setItem("reader-background", dataUrl);
        setBackgroundImage(dataUrl);
      } catch {
        setBackgroundImage(dataUrl);
      }

      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    };
    image.src = objectUrl;
  }

  const isReading = status === "speaking" || status === "paused";
  const statusLabel = {
    idle: "جاهز",
    empty: "اكتب نصاً أولاً",
    speaking: "جاري القراءة",
    paused: "متوقف مؤقتاً",
    loading: "جاري تجهيز الصوت",
    "selection-empty": "حدد جزءاً من النص",
  }[status];

  return (
      <main className="app">
        <header className="app-header">
          <div>
            <p className="eyebrow">قارئ صوتي</p>
            <h1>اقرأ أي نص بصوت واضح</h1>
            <p className="subtitle">العربية والإنجليزية والأرقام في النص نفسه.</p>
          </div>
          <div className="header-actions">
            <button
                className="background-button"
                type="button"
                onClick={() => backgroundInputRef.current?.click()}
            >
              <span aria-hidden="true">▧</span>
              <span>تغيير الخلفية</span>
            </button>
            <input
                ref={backgroundInputRef}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={changeBackground}
            />
            <div className={`status ${status}`} role="status" aria-live="polite">
              <span className="status-dot"/>
              <span>{statusLabel}</span>
            </div>
          </div>
        </header>

        <section className="editor-section" aria-labelledby="text-label">
          <div className="editor-heading">
            <label id="text-label" htmlFor="text">
              النص
            </label>
            <div className="editor-actions">
              <button className="text-button" type="button" onClick={selectAllText}>
                تحديد الكل
              </button>
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
          </div>
          <textarea
              ref={textareaRef}
              id="text"
              dir="auto"
              spellCheck="true"
              placeholder="مثال: مرحباً، موعدنا tomorrow at 5:30 مساءً."
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                updateSelection(event);
              }}
              onSelect={updateSelection}
          />
          <div className="text-meta">
            <span>{text.length} حرف</span>
            <span>
              {selectedText.length
                  ? `${selectedText.length} حرف محدد`
                  : `${segments.length} مقطع صوتي`}
            </span>
          </div>
        </section>

        {readingContent && (
            <section className="tracking-panel" aria-label="متابعة القراءة">
              <div className="tracking-heading">
                <strong>متابعة القراءة</strong>
                <span>{activeWord ? "الكلمة الحالية" : "جاهز للقراءة"}</span>
              </div>
              <div ref={trackingRef} className="tracking-text" dir="auto" aria-live="off">
                {readingParts.map((part) => {
                  const isWord = /[\p{L}\p{N}]/u.test(part.text);
                  const isActive =
                      isWord &&
                      activeWord &&
                      part.start < activeWord.end &&
                      part.end > activeWord.start;

                  return (
                      <span
                          key={`${part.start}-${part.end}`}
                          className={`tracking-word${isActive ? " active" : ""}`}
                      >
                        {part.text}
                      </span>
                  );
                })}
              </div>
            </section>
        )}

        <section className="settings" aria-label="إعدادات الصوت">
          {cloudSpeechEnabled && (
              <div className="source-control" role="group" aria-label="مصدر الصوت">
                <button
                    className={speechSource === "device" ? "active" : ""}
                    type="button"
                    onClick={() => setSpeechSource("device")}
                >
                  أصوات الجهاز
                </button>
                <button
                    className={speechSource === "cloud" ? "active" : ""}
                    type="button"
                    onClick={() => setSpeechSource("cloud")}
                >
                  أصوات Azure
                </button>
              </div>
          )}

          {speechSource === "cloud" ? (
              <div className="field unified-voice-field">
                <label htmlFor="cloudVoice">الصوت السحابي الموحّد</label>
                <select
                    id="cloudVoice"
                    value={cloudVoice}
                    disabled={!cloudVoices.length}
                    onChange={(event) => setCloudVoice(event.target.value)}
                >
                  {!cloudVoices.length && <option value="">جاري تحميل الأصوات...</option>}
                  {cloudVoices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.displayName} — {voice.gender}
                      </option>
                  ))}
                </select>
                {cloudError && (
                    <p className="field-error" role="alert">
                      {cloudError}
                    </p>
                )}
              </div>
          ) : (
              <>
          <label className="voice-mode">
            <input
                type="checkbox"
                checked={useUnifiedVoice}
                onChange={(event) => setUseUnifiedVoice(event.target.checked)}
            />
            <span>استخدم نفس الصوت للعربية والإنجليزية</span>
          </label>

          {useUnifiedVoice ? (
              <div className="field unified-voice-field">
                <label htmlFor="unifiedVoice">الصوت الموحّد</label>
                <select
                    id="unifiedVoice"
                    value={unifiedVoiceUri}
                    disabled={!voices.length}
                    onChange={(event) => setUnifiedVoiceUri(event.target.value)}
                >
                  {!voices.length && <option value="">سيستخدم المتصفح الصوت المتاح</option>}
                  {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voiceLabel(voice)}
                      </option>
                  ))}
                </select>
              </div>
          ) : (
              <>
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
              </>
          )}
              </>
          )}

          <div className="field rate-field">
            <div className="range-heading">
              <label htmlFor="rate">السرعة</label>
              <output htmlFor="rate">{rate.toFixed(1)}×</output>
            </div>
            <input
                id="rate"
                type="range"
                min="0.5"
                max="4"
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
              disabled={
                status === "speaking" ||
                status === "loading" ||
                (speechSource === "device" && !supported)
              }
              onClick={() => startReading(text)}
          >
            <span className="button-icon" aria-hidden="true">▶</span>
            <span>قراءة النص كاملاً</span>
          </button>
          <button
              className="selection-button"
              type="button"
              disabled={
                !selectedText.trim() ||
                status === "speaking" ||
                status === "loading" ||
                (speechSource === "device" && !supported)
              }
              onClick={() => startReading(selectedText)}
          >
            <span className="button-icon" aria-hidden="true">▶</span>
            <span>قراءة المحدد</span>
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

        <p className="photo-credit">
          صورة الخلفية بواسطة{" "}
          <a href="https://unsplash.com/photos/sptlOGs9XGs" target="_blank" rel="noreferrer">
            QQ Z
          </a>
        </p>

      </main>
  );
}
