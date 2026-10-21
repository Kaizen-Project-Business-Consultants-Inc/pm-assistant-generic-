import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/**
 * What to tell the person when voice fails (U56, 2026-10-20: the mic did nothing and said nothing in
 * Edge). The browser's speech service reports why; "aborted" is our own stop.
 */
export function voiceErrorMessage(code?: string): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it from the padlock in the address bar, then try again.';
    case 'audio-capture':
      return 'No microphone was found. Check one is connected and allowed for this browser.';
    case 'no-speech':
      return "I didn't hear anything. Tap Speak and try again.";
    case 'aborted':
      return null;
    default:
      return "Voice isn't working in this browser right now. Try Chrome, or type instead.";
  }
}

export function useVoice() {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef<((transcript: string) => void) | null>(null);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setIsSupported(!!Recognition);
    if (Recognition) {
      const recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        const last = event.results[event.results.length - 1];
        const transcript = last[0].transcript.trim();
        if (last.isFinal && transcript && onResultRef.current) {
          onResultRef.current(transcript);
          onResultRef.current = null;
        }
      };

      recognition.onend = () => setIsListening(false);
      recognition.onerror = (event) => {
        setIsListening(false);
        setError(voiceErrorMessage(event?.error));
      };

      recognitionRef.current = recognition;
      return () => {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      };
    }
  }, []);

  const startListening = useCallback((onResult: (transcript: string) => void) => {
    const rec = recognitionRef.current;
    if (!rec) return;
    onResultRef.current = onResult;
    setError(null);
    try {
      rec.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      onResultRef.current = null;
      setError(voiceErrorMessage());
    }
  }, []);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec && isListening) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
    onResultRef.current = null;
  }, [isListening]);

  const speak = useCallback((text: string) => {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }, []);

  return { isSupported, isListening, startListening, stopListening, speak, error };
}
