import { useState, useRef, useCallback, useEffect } from 'react';
import { toSpeechText } from '../utils/speechText';

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
  const listeningRef = useRef(false); // the state can be stale inside a speech callback
  const speakingRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

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

      recognition.onend = () => { listeningRef.current = false; setIsListening(false); };
      recognition.onerror = (event) => {
        listeningRef.current = false;
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
    if (!rec || listeningRef.current) return; // already listening: a second start() would throw and drop the answer
    onResultRef.current = onResult;
    setError(null);
    try {
      rec.start();
      listeningRef.current = true;
      setIsListening(true);
    } catch {
      listeningRef.current = false;
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
    listeningRef.current = false;
    setIsListening(false);
    onResultRef.current = null;
  }, [isListening]);

  // Silence the voice. The old utterance's onend is dropped first: cancel() fires it, and that must not open the mic.
  const cancelSpeech = useCallback(() => {
    if (speakingRef.current) speakingRef.current.onend = null;
    speakingRef.current = null;
    setIsSpeaking(false);
    window.speechSynthesis?.cancel();
  }, []);

  const speak = useCallback((text: string, onDone?: () => void) => {
    if (!text || !window.speechSynthesis) return;
    cancelSpeech();
    const spoken = toSpeechText(text);
    if (!spoken) return;
    const u = new SpeechSynthesisUtterance(spoken);
    u.rate = 0.95;
    u.onend = () => {
      if (speakingRef.current !== u) return;
      speakingRef.current = null;
      setIsSpeaking(false);
      onDone?.();
    };
    speakingRef.current = u; // also keeps the utterance alive (Chrome can drop long ones and never fire onend)
    setIsSpeaking(true);
    window.speechSynthesis.speak(u);
  }, [cancelSpeech]);

  return { isSupported, isListening, startListening, stopListening, speak, cancelSpeech, isSpeaking, error };
}
