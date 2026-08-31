import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'src', 'client', 'public', 'screenshots');

// Narration scripts — kept concise to fit each video's duration
const narrations: Record<string, string> = {
  'scheduling': `Here's the Gantt chart view with interactive scheduling. You can see tasks laid out on a timeline, edit them inline, and adjust dependencies. The AI helps estimate durations and detect scheduling conflicts automatically.`,

  'monte-carlo': `This is our Monte Carlo simulation engine. Select a project and schedule, configure the number of iterations and confidence level, then run the simulation. It generates probability distributions for your project completion date, helping you make data-driven commitments to stakeholders.`,

  'risk-detection': `The RAID log gives you a complete view of risks, assumptions, issues, and decisions. AI continuously scans your project data to detect emerging risks and suggests mitigations. Each item is tracked with severity, status, and ownership.`,

  'meeting-intelligence': `Meeting Intelligence lets you upload transcripts from Teams, Zoom, or Otter. The AI analyzes the conversation, extracts action items, identifies key decisions, and generates a structured summary you can share with your team.`,

  'portfolio': `The Portfolio Dashboard shows all your projects at a glance. You can see health status, budget utilization, timeline progress, and risk levels across your entire portfolio. Filter and sort to focus on what needs attention.`,

  'nl-queries': `With natural language queries, just type a question in plain English. Ask things like "which tasks are overdue" or "show me the budget status." The AI understands your intent and returns the answer instantly, no complex filters needed.`,
};

async function generateSpeech(text: string, outputPath: string): Promise<void> {
  console.log(`  Generating speech for ${path.basename(outputPath)}...`);

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1-hd',
      input: text,
      voice: 'onyx',
      response_format: 'mp3',
      speed: 1.05,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS API error: ${response.status} ${await response.text()}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`  Audio saved: ${outputPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

function getVideoDuration(videoPath: string): number {
  const output = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`, { encoding: 'utf-8' });
  return parseFloat(output.trim());
}

function mergeAudioVideo(videoPath: string, audioPath: string, outputPath: string, videoDuration: number): void {
  // Pad or trim audio to match video duration, mix into video
  execSync(
    `ffmpeg -y -i "${videoPath}" -i "${audioPath}" ` +
    `-filter_complex "[1:a]apad,atrim=0:${videoDuration},afade=t=out:st=${videoDuration - 0.5}:d=0.5[a]" ` +
    `-map 0:v -map "[a]" -c:v copy -c:a libopus -b:a 64k -shortest "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  const tmpDir = path.join(SCREENSHOTS_DIR, '_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  for (const [name, text] of Object.entries(narrations)) {
    const videoPath = path.join(SCREENSHOTS_DIR, `${name}.webm`);
    if (!fs.existsSync(videoPath)) {
      console.log(`Skipping ${name} — video not found`);
      continue;
    }

    console.log(`\nProcessing: ${name}.webm`);

    const audioPath = path.join(tmpDir, `${name}.mp3`);
    const outputPath = path.join(tmpDir, `${name}-voiced.webm`);

    // 1. Generate TTS audio
    await generateSpeech(text, audioPath);

    // 2. Get video duration
    const duration = getVideoDuration(videoPath);
    console.log(`  Video duration: ${duration.toFixed(1)}s`);

    // 3. Merge audio into video
    console.log(`  Merging audio + video...`);
    mergeAudioVideo(videoPath, audioPath, outputPath, duration);

    // 4. Replace original
    fs.copyFileSync(videoPath, path.join(tmpDir, `${name}-original.webm`));
    fs.copyFileSync(outputPath, videoPath);
    console.log(`  Replaced ${name}.webm with voiced version`);
  }

  // Clean up tmp audio files (keep originals as backup)
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.endsWith('.mp3') || f.endsWith('-voiced.webm')) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  }

  console.log('\nDone! All videos now have voiceover narration.');
  console.log('Original backups are in screenshots/_tmp/');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
